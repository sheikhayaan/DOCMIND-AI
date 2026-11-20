"""Verified, allowlisted self-healing with cooldowns and no destructive task purging."""

import asyncio
import gc
import os
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from datetime import datetime, timezone
from uuid import uuid4

from apm.cache import document_stats_cache
from apm.common import setting, utc_now
from apm.database import pools
from apm.gateway import LLMGateway, gateway
from apm.incidents import IncidentTracker, incident_tracker
from apm.schemas import Action, ActionExecution, HealingReport, Incident
from apm.store import AdminStore
from apm.telemetry import TelemetryTracker, telemetry_tracker

# Rate limits, auth anomalies, slow SQL, and generic HTTP failures are deliberately
# not "fixed" by clearing security state or declaring an unrelated pool healthy.
REMEDIES: dict[str, list[Action]] = {
    "DB_POOL_EXHAUSTION": ["CONNECTION_POOL_RESET"],
    "TRANSIENT_CACHE_CORRUPTION": ["TRANSIENT_CACHE_FLUSH"],
    "MEMORY_PRESSURE": ["MEMORY_COMPACT_DRAIN"],
    "LLM_TIMEOUT": ["CIRCUIT_FALLBACK_CASCADE", "CIRCUIT_BREAKER_RESET"],
    "LLM_UPSTREAM_FAILURE": ["CIRCUIT_FALLBACK_CASCADE", "CIRCUIT_BREAKER_RESET"],
    "LLM_RATE_LIMIT": ["CIRCUIT_FALLBACK_CASCADE", "CIRCUIT_BREAKER_RESET"],
}


class SelfHealingService:
    """Executes real adapters and resolves only incidents covered by a verified remedy."""

    def __init__(self, store: AdminStore, tracker: IncidentTracker = incident_tracker, telemetry: TelemetryTracker = telemetry_tracker, llm: LLMGateway = gateway) -> None:
        """Initializes process-local mutual exclusion, retention limits, and action cooldowns."""
        self.store, self.tracker, self.telemetry, self.gateway = store, tracker, telemetry, llm
        self.lock = asyncio.Lock()
        self.audit_lock = threading.Lock()
        self.audit: deque[HealingReport] = deque(maxlen=100)
        self.pending_reports: OrderedDict[str, HealingReport] = OrderedDict()
        self.last_executed: dict[Action, float] = {}
        self.cooldown = setting("APM_HEALING_COOLDOWN_SECONDS", 60, 1, 3600)
        self.enabled = os.getenv("APM_AUTO_HEALING_ENABLED", "true").lower() not in {"0", "false", "no"}
        self.adapters: dict[Action, Callable[[], ActionExecution]] = {
            "CONNECTION_POOL_RESET": self._reset_pools,
            "TRANSIENT_CACHE_FLUSH": self._flush_cache,
            "CIRCUIT_BREAKER_RESET": self.gateway.reset_eligible,
            "MEMORY_COMPACT_DRAIN": self._compact_memory,
            "CIRCUIT_FALLBACK_CASCADE": self.gateway.cascade,
        }
        self.breaches: dict[str, int] = {}

    def _reset_pools(self) -> ActionExecution:
        """Gracefully replaces idle pools and tests write acquisition without interrupting live queries."""
        active_pools = pools()
        if not active_pools:
            return ActionExecution(action="CONNECTION_POOL_RESET", status="skipped", notes="No database pool is registered.")
        results = [pool.reset(timeout=2) for pool in active_pools]
        verified = all(results)
        if verified:
            try:
                for pool in active_pools:
                    pool.probe()
            except Exception:
                verified = False
        return ActionExecution(
            action="CONNECTION_POOL_RESET", status="success" if verified else "failed", verified=verified,
            notes=f"Re-established and probed {sum(results)}/{len(results)} pools; no active transaction was force-closed.",
        )

    def _flush_cache(self) -> ActionExecution:
        """Flushes only recomputable metadata while preserving documents and abuse-prevention state."""
        cleared = document_stats_cache.drain(all_entries=True)
        return ActionExecution(
            action="TRANSIENT_CACHE_FLUSH", status="success" if cleared else "skipped", verified=cleared > 0 and len(document_stats_cache) == 0,
            notes=f"Cleared {cleared} transient metadata keys. Document banks, authentication, and rate limits are untouched.",
        )

    def _compact_memory(self) -> ActionExecution:
        """Collects unreachable Python objects and releases only finished background task handles."""
        from job_queue import drain_completed_jobs

        expired = document_stats_cache.drain()
        finished = drain_completed_jobs()
        collected = gc.collect()
        resources = self.telemetry.sample_resources(self.telemetry.resources.eventLoopLagMs)
        healthy = resources.rssBytes is not None and resources.rssBytes < resources.memoryLimitBytes * 0.9
        return ActionExecution(
            action="MEMORY_COMPACT_DRAIN", status="success" if healthy else "failed", verified=healthy,
            notes=f"Collected {collected} unreachable objects, {expired} expired keys, and {finished} finished task handles. Active/queued tasks were preserved; RSS {'is below' if healthy else 'has not verified recovery below'} its budget.",
        )

    def diagnose(self) -> tuple[dict[str, bool | None], float | None]:
        """Probes current infrastructure and leaves unsupported resource checks unknown."""
        from job_queue import queue_is_healthy

        database_ok = True
        latency = 0.0
        registered = pools()
        for pool in registered:
            try:
                latency += pool.probe()
            except Exception:
                database_ok = False
        resources = self.telemetry.resources
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(resources.sampledAt or "")).total_seconds()
            resources_fresh = 0 <= age <= 10
        except (TypeError, ValueError):
            resources_fresh = False
        llm = self.gateway.snapshot()
        checks: dict[str, bool | None] = {
            "resourcesFresh": resources_fresh,
            "database": database_ok if registered else None,
            "queue": queue_is_healthy(),
            "gateway": llm.configured and llm.verified and not any(item.failures for item in llm.breakers),
            "memory": resources.rssBytes < resources.memoryLimitBytes * 0.9 if resources.rssBytes is not None else None,
            "cpu": resources.cpuPercent < 90 if resources.cpuPercent is not None else None,
            "eventLoop": resources.eventLoopLagMs < 250 if resources.eventLoopLagMs is not None else None,
        }
        return checks, latency if database_ok and registered else None

    def selected_actions(self, incidents: list[Incident]) -> list[Action]:
        """Chooses only supported remedies for actual unresolved conditions."""
        selected: list[Action] = []
        for item in incidents:
            if not item.resolvedAt:
                selected.extend(REMEDIES.get(item.category, []))
        state = self.gateway.snapshot()
        if any(item.failures and item.retryAfterSeconds <= 0 for item in state.breakers):
            selected.append("CIRCUIT_BREAKER_RESET")
        return list(dict.fromkeys(selected))

    def detect_thresholds(self) -> None:
        """Requires three consecutive samples before alerting on CPU, RSS, or loop lag."""
        resources = self.telemetry.resources
        conditions = {
            "MEMORY_PRESSURE": resources.rssBytes is not None and resources.rssBytes >= resources.memoryLimitBytes * 0.9,
            "CPU_PRESSURE": resources.cpuPercent is not None and resources.cpuPercent >= 90,
            "EVENT_LOOP_LAG": resources.eventLoopLagMs is not None and resources.eventLoopLagMs >= 250,
        }
        for category, breached in conditions.items():
            self.breaches[category] = self.breaches.get(category, 0) + 1 if breached else 0
            if self.breaches[category] >= 3:
                self.tracker.record(category, "high", "runtime", "Resource threshold exceeded for three consecutive samples. Consult live telemetry for current measurements.")

    async def execute(self, actions: list[Action] | None = None, *, incident_id: str | None = None, actor: str = "autonomous-engine", automatic: bool = False) -> HealingReport:
        """Serializes allowlisted actions and bases resolution and reports on verified postconditions."""
        started = time.perf_counter()
        report = HealingReport(id=uuid4().hex, status="noop", trigger="automatic" if automatic else "manual", actor=actor, startedAt=utc_now(), incidentId=incident_id)
        if self.lock.locked():
            report.status = "busy"
            return report
        async with self.lock:
            target = self.tracker.get(incident_id) if incident_id else None
            incidents = [target] if target else self.tracker.list(unresolved=True)
            if incident_id and target is None:
                raise LookupError("Incident not found in the retained log")
            if target and target.resolvedAt:
                return report
            selected = list(dict.fromkeys(actions or (REMEDIES.get(target.category, []) if target else self.selected_actions(incidents))))
            if any(action not in self.adapters for action in selected):
                raise ValueError("Unsupported healing action")
            if target and any(action not in REMEDIES.get(target.category, []) for action in selected):
                raise ValueError("This action does not remedy the selected incident category")
            # No await occurs between testing the lock and acquiring it, so a
            # second request gets a busy report instead of queuing another repair.
            checks_before, latency_before = await asyncio.to_thread(self.diagnose)
            for action in selected:
                elapsed = time.monotonic() - self.last_executed.get(action, float("-inf"))
                if elapsed < self.cooldown:
                    report.actionsExecuted.append(ActionExecution(action=action, status="deferred", notes=f"Action cooldown: retry in {self.cooldown - elapsed:.0f} seconds."))
                    continue
                self.last_executed[action] = time.monotonic()
                action_start = time.perf_counter()
                try:
                    result = await asyncio.to_thread(self.adapters[action])
                except Exception:
                    result = ActionExecution(action=action, status="failed", notes="Remediation adapter failed; no recovery was claimed. Inspect server diagnostics.")
                result.durationMs = round((time.perf_counter() - action_start) * 1000, 2)
                report.actionsExecuted.append(result)
            report.checks, latency_after = await asyncio.to_thread(self.diagnose) if selected else (checks_before, latency_before)
            verified_actions = {item.action for item in report.actionsExecuted if item.status == "success" and item.verified}
            for incident in incidents:
                remedies = REMEDIES.get(incident.category, [])
                matched = verified_actions.intersection(remedies)
                if not matched:
                    continue
                # Offline availability is per document, not proof that this
                # incident's request recovered; leave it open for investigation.
                if "CIRCUIT_FALLBACK_CASCADE" in matched and not self.gateway.snapshot().verified:
                    matched.remove("CIRCUIT_FALLBACK_CASCADE")
                if matched:
                    self.tracker.resolve(incident.id, f"Autonomous self-healing ({report.trigger} trigger): {', '.join(sorted(matched))} passed verification.", automatic=True)
            report.checks["criticalIncidents"] = not any(item.severity == "critical" for item in self.tracker.list(unresolved=True))
            report.verifiedNominal = bool(report.checks) and all(value is True for value in report.checks.values())
            if "CONNECTION_POOL_RESET" in verified_actions and latency_before is not None and latency_after is not None:
                report.latencySavingsMs = round(max(0, latency_before - latency_after), 3)
                report.latencySavingsBasis = "Measured reduction in identical database readiness probes, not HTTP P95 or guaranteed future savings"
            if verified_actions:
                report.status = "partial" if any(item.status == "failed" for item in report.actionsExecuted) else "success"
            elif any(item.status == "failed" for item in report.actionsExecuted):
                report.status = "failed"
            elif report.actionsExecuted and all(item.status == "deferred" for item in report.actionsExecuted):
                report.status = "cooldown"
            report.durationMs = round((time.perf_counter() - started) * 1000, 2)
            with self.audit_lock:
                self.audit.appendleft(report.model_copy(deep=True))
                self.pending_reports[report.id] = report.model_copy(deep=True)
                if len(self.pending_reports) > 100:
                    self.pending_reports.popitem(last=False)
                    self.tracker.record("AUDIT_PERSISTENCE_FAILURE", "critical", "self-healing", "The bounded repair audit retry queue overflowed; inspect durable audit storage.")
            await asyncio.to_thread(self.flush_reports)
            return report

    def flush_reports(self) -> None:
        """Retries durable healing audit writes while retaining failed writes in bounded memory."""
        with self.audit_lock:
            batch = list(self.pending_reports.values())[:10]
        for report in batch:
            try:
                self.store.persist_report(report)
            except Exception:
                self.tracker.record("AUDIT_PERSISTENCE_FAILURE", "critical", "self-healing", "Repair audit persistence is unavailable; reports remain in a bounded retry queue.")
                return
            with self.audit_lock:
                self.pending_reports.pop(report.id, None)

    async def tick(self) -> None:
        """Triggers eligible remedies autonomously while respecting the kill switch and cooldowns."""
        if not self.enabled or self.lock.locked():
            return
        selected = self.selected_actions(self.tracker.list(unresolved=True))
        eligible = [action for action in selected if time.monotonic() - self.last_executed.get(action, float("-inf")) >= self.cooldown]
        if eligible:
            await self.execute(eligible, automatic=True)
