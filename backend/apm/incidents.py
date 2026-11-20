"""Bounded incident tracking with coalescing, redaction, and retryable critical writes."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from datetime import datetime
from uuid import uuid4

from apm.common import redact, utc_now
from apm.schemas import Incident, Severity

SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


class IncidentTracker:
    """Keeps recent incidents in memory and queues critical updates for durable storage."""

    def __init__(self, capacity: int = 200, clock: Callable[[], float] = time.monotonic) -> None:
        """Caps both incident retention and the retry queue so outages cannot leak memory."""
        self.capacity = max(1, capacity)
        self.clock = clock
        self.lock = threading.RLock()
        self.buffer: deque[Incident] = deque(maxlen=self.capacity)
        self.pending: OrderedDict[str, Incident] = OrderedDict()
        self._dedup: OrderedDict[tuple[str, str], tuple[str, float]] = OrderedDict()
        self.persistence_healthy = True
        self.dropped_writes = 0

    def _queue_critical(self, incident: Incident) -> None:
        """Queues the newest version of a critical incident without duplicate writes."""
        if incident.severity != "critical":
            return
        self.pending[incident.id] = incident.model_copy(deep=True)
        self.pending.move_to_end(incident.id)
        while len(self.pending) > self.capacity:
            self.pending.popitem(last=False)
            self.dropped_writes += 1
            self.persistence_healthy = False

    def record(
        self, category: str, severity: Severity, endpoint: str, details: str,
        status_code: int | None = None,
    ) -> Incident:
        """Coalesces bursts by safe endpoint and category while preserving real occurrence counts."""
        now, stamp = self.clock(), utc_now()
        key = (redact(category, 80), redact(endpoint.split("?", 1)[0], 160))
        with self.lock:
            previous = self._dedup.get(key)
            existing = next((item for item in self.buffer if previous and item.id == previous[0] and not item.resolvedAt), None)
            if existing and previous and now - previous[1] < 60:
                existing.occurrences += 1
                existing.lastSeenAt = stamp
                if SEVERITY_ORDER[severity] > SEVERITY_ORDER[existing.severity]:
                    existing.severity = severity
                self._queue_critical(existing)
                return existing.model_copy(deep=True)
            incident = Incident(
                id=uuid4().hex, timestamp=stamp, lastSeenAt=stamp, category=key[0],
                severity=severity, endpoint=key[1], statusCode=status_code, errorDetails=redact(details),
            )
            self.buffer.append(incident)
            self._dedup[key] = (incident.id, now)
            self._dedup.move_to_end(key)
            while len(self._dedup) > self.capacity:
                self._dedup.popitem(last=False)
            self._queue_critical(incident)
            return incident.model_copy(deep=True)

    def get(self, incident_id: str) -> Incident | None:
        """Returns an isolated copy so clients cannot mutate the in-memory audit log."""
        with self.lock:
            item = next((item for item in self.buffer if item.id == incident_id), None)
            return item.model_copy(deep=True) if item else None

    def list(self, severity: Severity | None = None, auto_mitigated: bool | None = None, unresolved: bool | None = None) -> list[Incident]:
        """Filters newest-first incidents with explicit false handling for mitigation filters."""
        with self.lock:
            return [
                item.model_copy(deep=True) for item in reversed(self.buffer)
                if (severity is None or item.severity == severity)
                and (auto_mitigated is None or item.autoMitigated == auto_mitigated)
                and (unresolved is None or (item.resolvedAt is None) == unresolved)
            ]

    def resolve(self, incident_id: str, notes: str, *, automatic: bool = False) -> Incident | None:
        """Marks only a human-confirmed or independently verified mitigation as resolved."""
        with self.lock:
            incident = next((item for item in self.buffer if item.id == incident_id), None)
            if incident is None:
                return None
            if not incident.resolvedAt:
                incident.resolvedAt = utc_now()
                incident.autoMitigated = automatic
                incident.mitigationNotes = redact(notes)
                self._queue_critical(incident)
            return incident.model_copy(deep=True)

    def restore(self, incidents: list[Incident]) -> None:
        """Merges persisted critical history at startup without erasing fresh in-memory errors."""
        with self.lock:
            combined = {item.id: item for item in incidents}
            combined.update({item.id: item for item in self.buffer})
            ordered = sorted(combined.values(), key=lambda item: item.timestamp)[-self.capacity:]
            self.buffer = deque(ordered, maxlen=self.capacity)

    def flush(self, persist: Callable[[list[Incident]], None]) -> None:
        """Retries critical writes off the request path and preserves concurrent updates."""
        with self.lock:
            batch = list(self.pending.values())[:50]
        if not batch:
            return
        try:
            persist(batch)
        except Exception:
            # Do not create another incident about the failing incident database.
            with self.lock:
                self.persistence_healthy = False
            return
        with self.lock:
            for written in batch:
                if self.pending.get(written.id) == written:
                    self.pending.pop(written.id, None)
            self.persistence_healthy = True

    def persistence_status(self) -> tuple[bool, int, int]:
        """Reports persistence degradation instead of silently claiming critical records are durable."""
        with self.lock:
            return self.persistence_healthy, len(self.pending), self.dropped_writes

    def mitigation_stats(self) -> tuple[int, float | None]:
        """Calculates actual detection-to-resolution MTTR, never a synthetic target."""
        mitigated = [item for item in self.list() if item.autoMitigated and item.resolvedAt]
        durations = [
            max(0.0, (datetime.fromisoformat(item.resolvedAt) - datetime.fromisoformat(item.timestamp)).total_seconds() * 1000)
            for item in mitigated if item.resolvedAt
        ]
        return len(durations), round(sum(durations) / len(durations), 2) if durations else None


incident_tracker = IncidentTracker()


def record_dependency_failure(service: str, error: Exception, endpoint: str) -> Incident | None:
    """Captures third-party timeouts and outages even when a caller serves a graceful fallback."""
    description = f"{type(error).__name__} {error}".lower()
    status = getattr(error, "status_code", None)
    timeout = isinstance(error, TimeoutError) or "timeout" in description or "timed out" in description
    if not timeout and status not in {429, 500, 502, 503, 504} and not any(word in description for word in ("connection error", "connection refused", "service unavailable")):
        return None
    return incident_tracker.record(
        "THIRD_PARTY_TIMEOUT" if timeout else "DEPENDENCY_FAILURE", "high", endpoint,
        f"The {redact(service, 50)} dependency {'timed out' if timeout else 'failed'}. Provider bodies and credentials were not retained.",
        504 if timeout else 503,
    )
