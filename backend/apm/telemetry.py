"""Thread-safe sliding-window APM; SQL and HTTP instrumentation never store payloads."""

import math
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import uuid4

from apm.common import utc_now
from apm.resources import ResourceSampler
from apm.schemas import DatabaseMetrics, HttpMetrics, Percentiles, Resources, TelemetrySnapshot

STATUS_GROUPS = ("2xx", "3xx", "4xx", "5xx", "other")


@dataclass
class RequestBucket:
    """Preserves exact rolling counts independently of the capped latency buffer."""

    second: int
    counts: dict[str, int] = field(default_factory=lambda: dict.fromkeys(STATUS_GROUPS, 0))


class TelemetryTracker:
    """Keeps bounded latency samples and exact one-second request-count buckets."""

    def __init__(self, window_seconds: int = 900, max_samples: int = 100000, clock: Callable[[], float] = time.monotonic) -> None:
        """Allows deterministic clocks in tests and caps all in-memory sample collections."""
        self.window = max(1, window_seconds)
        self.max_samples = max(1, max_samples)
        self.clock = clock
        self.started = clock()
        self.process_id = os.getpid()
        self.instance = f"{self.process_id}-{uuid4().hex[:8]}"
        self.lock = threading.RLock()
        self.sample_lock = threading.Lock()
        self.requests: deque[tuple[float, float]] = deque(maxlen=self.max_samples)
        self.queries: deque[tuple[float, float]] = deque(maxlen=self.max_samples)
        self.buckets: deque[RequestBucket] = deque(maxlen=self.window + 1)
        self.total_status = dict.fromkeys(STATUS_GROUPS, 0)
        self.total_requests = self.total_queries = self.active_requests = self.active_queries = 0
        self.request_drop_at = self.query_drop_at = float("-inf")
        self.sampler = ResourceSampler()
        self.resources = Resources(processId=os.getpid(), memoryLimitBytes=self.sampler.limit)

    def _ensure_process(self) -> None:
        """Starts fresh counters, locks, and instance identity if the app was preloaded before a fork."""
        if self.process_id != os.getpid():
            self.__init__(self.window, self.max_samples, self.clock)

    def _expire(self, now: float) -> None:
        """Prunes expired samples even when no new requests arrive."""
        cutoff = now - self.window
        while self.requests and self.requests[0][0] <= cutoff:
            self.requests.popleft()
        while self.queries and self.queries[0][0] <= cutoff:
            self.queries.popleft()
        # Bucket precision is one second; completed seconds at the boundary expire.
        while self.buckets and self.buckets[0].second <= math.floor(cutoff):
            self.buckets.popleft()

    def request_started(self) -> None:
        """Counts an in-flight request before calling the application."""
        self._ensure_process()
        with self.lock:
            self.active_requests += 1

    def record_request(self, latency_ms: float, status: int, *, started: bool = False) -> None:
        """Adds a completed request without retaining paths, headers, or body data."""
        self._ensure_process()
        now = self.clock()
        group = f"{status // 100}xx" if 200 <= status < 600 else "other"
        with self.lock:
            self._expire(now)
            if len(self.requests) == self.max_samples:
                self.request_drop_at = now
            self.requests.append((now, max(0.0, latency_ms) if math.isfinite(latency_ms) else 0.0))
            second = math.floor(now)
            if not self.buckets or self.buckets[-1].second != second:
                self.buckets.append(RequestBucket(second))
            self.buckets[-1].counts[group] += 1
            self.total_status[group] += 1
            self.total_requests += 1
            if started:
                self.active_requests = max(0, self.active_requests - 1)

    def query_started(self) -> None:
        """Counts SQL work across all instrumented connections in this worker."""
        self._ensure_process()
        with self.lock:
            self.active_queries += 1

    def record_query(self, latency_ms: float) -> None:
        """Records SQL execution latency after both successful and failed statements."""
        self._ensure_process()
        now = self.clock()
        with self.lock:
            self._expire(now)
            if len(self.queries) == self.max_samples:
                self.query_drop_at = now
            self.queries.append((now, max(0.0, latency_ms)))
            self.total_queries += 1
            self.active_queries = max(0, self.active_queries - 1)

    def sample_resources(self, lag_ms: float | None = None) -> Resources:
        """Refreshes native process measurements outside the hot request path."""
        self._ensure_process()
        with self.sample_lock:
            resources = self.sampler.sample(lag_ms)
        with self.lock:
            self.resources = resources
        return resources

    def get_snapshot(self) -> TelemetrySnapshot:
        """Returns consistent JSON-ready metrics without querying a database or provider."""
        from apm.database import pool_snapshots
        from apm.gateway import gateway

        self._ensure_process()
        now = self.clock()
        with self.lock:
            self._expire(now)
            latencies = [item[1] for item in self.requests]
            queries = [item[1] for item in self.queries]
            counts = {group: sum(bucket.counts[group] for bucket in self.buckets) for group in STATUS_GROUPS}
            elapsed = min(self.window, max(1.0, now - self.started))
            http = HttpMetrics(
                totalRequests=self.total_requests, windowRequests=sum(counts.values()),
                requestsPerSecond=round(sum(counts.values()) / elapsed, 3), inFlight=self.active_requests,
                statusCounts=counts, totalStatusCounts=dict(self.total_status),
            )
            database = DatabaseMetrics(
                activeQueries=self.active_queries, totalQueries=self.total_queries, windowQueries=len(queries),
                averageQueryLatencyMs=round(sum(queries) / len(queries), 3) if queries else None,
                samplesTruncated=self.query_drop_at > now - self.window,
            )
            resources = self.resources.model_copy(deep=True)
            truncated = self.request_drop_at > now - self.window
        latencies.sort()
        percentiles = Percentiles(sampleCount=len(latencies), samplesTruncated=truncated)
        if latencies:
            for name, quantile in (("p50", 0.50), ("p95", 0.95), ("p99", 0.99)):
                setattr(percentiles, name, round(latencies[math.ceil(quantile * len(latencies)) - 1], 3))
        database.pools = pool_snapshots()
        return TelemetrySnapshot(
            timestamp=utc_now(), instanceId=self.instance, windowSeconds=self.window,
            windowElapsedSeconds=round(elapsed, 3), resources=resources, http=http,
            latencyMs=percentiles, database=database, gateway=gateway.snapshot(),
        )

    def getSnapshot(self) -> dict[str, object]:
        """Exposes the requested JSON snapshot contract to non-Pydantic callers."""
        return self.get_snapshot().model_dump(mode="json")


telemetry_tracker = TelemetryTracker()
