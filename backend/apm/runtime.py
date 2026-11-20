"""Application-lifespan ownership for telemetry sampling, audit persistence, and healing."""

import asyncio
import os
import tracemalloc
from pathlib import Path

from apm.database import pools
from apm.healing import SelfHealingService
from apm.incidents import incident_tracker
from apm.store import AdminStore
from apm.telemetry import telemetry_tracker


class APMRuntime:
    """Runs independent monitoring loops so remediation never blocks resource sampling."""

    def __init__(self, path: Path) -> None:
        """Creates durable storage and services without starting background work at import time."""
        self.store = AdminStore(path)
        self.healing = SelfHealingService(self.store)
        self.stopping = asyncio.Event()
        self.tasks: list[asyncio.Task] = []
        self.owns_heap_trace = False

    async def start(self) -> None:
        """Restores critical incidents and starts exactly one set of loops per worker lifespan."""
        if self.tasks:
            return
        self.stopping = asyncio.Event()
        if os.getenv("APM_TRACE_HEAP", "false").lower() == "true" and not tracemalloc.is_tracing():
            tracemalloc.start(1)
            self.owns_heap_trace = True
        try:
            incident_tracker.restore(await asyncio.to_thread(self.store.load_incidents))
        except Exception:
            incident_tracker.record("AUDIT_PERSISTENCE_FAILURE", "critical", "startup", "Critical incident history could not be loaded; check database availability.")
        await asyncio.to_thread(telemetry_tracker.sample_resources)
        self.tasks = [
            asyncio.create_task(self._sample_loop(), name="apm-resources"),
            asyncio.create_task(self._persist_loop(), name="apm-audit"),
            asyncio.create_task(self._heal_loop(), name="apm-self-healing"),
        ]

    async def _pause(self, seconds: float) -> None:
        """Sleeps interruptibly so shutdown does not wait for the polling interval."""
        try:
            await asyncio.wait_for(self.stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def _sample_loop(self) -> None:
        """Measures actual event-loop delay rather than a fabricated health percentage."""
        loop = asyncio.get_running_loop()
        while not self.stopping.is_set():
            expected = loop.time() + 1
            await self._pause(1)
            if self.stopping.is_set():
                break
            lag = max(0, loop.time() - expected) * 1000
            try:
                await asyncio.to_thread(telemetry_tracker.sample_resources, lag)
                self.healing.detect_thresholds()
            except Exception:
                incident_tracker.record("TELEMETRY_UNAVAILABLE", "high", "runtime", "Native resource sampling failed; unsupported sensors are not reported as healthy.")

    async def _persist_loop(self) -> None:
        """Persists critical incidents independently of traffic and repair execution."""
        while not self.stopping.is_set():
            await asyncio.to_thread(incident_tracker.flush, self.store.persist_incidents)
            await asyncio.to_thread(self.healing.flush_reports)
            await self._pause(1)

    async def _heal_loop(self) -> None:
        """Checks incident-triggered remedies every five seconds with per-action cooldowns."""
        while not self.stopping.is_set():
            await self._pause(5)
            if self.stopping.is_set():
                break
            try:
                await self.healing.tick()
            except Exception:
                incident_tracker.record("SELF_HEALING_FAILURE", "critical", "self-healing", "Automatic diagnostics failed; manual investigation is required.")

    async def stop(self) -> None:
        """Finishes bounded in-flight repairs, flushes audit, and closes only idle DB connections."""
        self.stopping.set()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
            self.tasks.clear()
        await asyncio.to_thread(incident_tracker.flush, self.store.persist_incidents)
        await asyncio.to_thread(self.healing.flush_reports)
        for pool in pools():
            pool.close_idle()
        if self.owns_heap_trace:
            tracemalloc.stop()
            self.owns_heap_trace = False


# SecurityStore creates users before this additive operational schema is loaded.
from security import SECURITY_DB_PATH  # noqa: E402

apm = APMRuntime(SECURITY_DB_PATH)
