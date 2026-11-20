"""Small real SQLite connection pools with graceful draining and SQL instrumentation."""

import os
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, TypeVar

from apm.common import setting
from apm.incidents import incident_tracker
from apm.schemas import PoolStatus
from apm.telemetry import telemetry_tracker

R = TypeVar("R")


class TrackedCursor(sqlite3.Cursor):
    """Measures statement execution without collecting SQL text or parameters."""

    def _run(self, operation: Callable[..., R], *args: object, **kwargs: object) -> R:
        """Balances active-query counts even when SQLite raises an exception."""
        conn = self.connection
        if not getattr(conn, "observe", True):
            return operation(*args, **kwargs)
        start = time.perf_counter()
        telemetry_tracker.query_started()
        try:
            return operation(*args, **kwargs)
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                incident_tracker.record("DB_POOL_EXHAUSTION", "critical", "database", "SQLite could not acquire a database lock within its busy timeout.")
            raise
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            telemetry_tracker.record_query(elapsed)
            if elapsed > 2000:
                incident_tracker.record("DB_SLOW_QUERY", "high", "database", f"A SQL operation took {elapsed:.0f} ms; SQL and parameters were not collected.")

    def execute(self, *args: object, **kwargs: object) -> "TrackedCursor":
        """Times one parameterized SQL statement."""
        return self._run(super().execute, *args, **kwargs)

    def executemany(self, *args: object, **kwargs: object) -> "TrackedCursor":
        """Times a batch of parameterized SQL statements."""
        return self._run(super().executemany, *args, **kwargs)

    def executescript(self, *args: object, **kwargs: object) -> "TrackedCursor":
        """Times schema initialization without persisting the schema text in APM."""
        return self._run(super().executescript, *args, **kwargs)


class TrackedConnection(sqlite3.Connection):
    """Routes connection convenience methods through measured cursors."""

    observe = True

    def cursor(self, factory: type[sqlite3.Cursor] = TrackedCursor) -> sqlite3.Cursor:
        """Makes explicit cursors observable as well as connection.execute calls."""
        return super().cursor(factory)

    def execute(self, *args: object, **kwargs: object) -> sqlite3.Cursor:
        """Uses the same instrumentation for connection-level SQL execution."""
        return self.cursor().execute(*args, **kwargs)

    def executemany(self, *args: object, **kwargs: object) -> sqlite3.Cursor:
        """Uses a measured cursor for batched inserts and updates."""
        return self.cursor().executemany(*args, **kwargs)

    def executescript(self, *args: object, **kwargs: object) -> sqlite3.Cursor:
        """Uses a measured cursor for migrations and index creation."""
        return self.cursor().executescript(*args, **kwargs)


class SQLitePool:
    """Bounds connections and never force-closes a leased transaction during healing."""

    def __init__(self, path: Path, name: str, capacity: int = 4) -> None:
        """Creates an initially lazy pool for one durable database file."""
        self.path, self.name, self.capacity = path, name, max(1, capacity)
        self.process_id = os.getpid()
        self.condition = threading.Condition()
        self.idle: list[TrackedConnection] = []
        self.active = self.waiting = self.generation = 0
        self.draining = self.unavailable = False

    def _ensure_process(self) -> None:
        """Discards inherited idle connections and locks after Gunicorn/Celery prefork."""
        if self.process_id == os.getpid():
            return
        inherited = self.idle
        self.idle = []
        self.condition = threading.Condition()
        self.active = self.waiting = 0
        self.draining = self.unavailable = False
        self.generation += 1
        self.process_id = os.getpid()
        for conn in inherited:
            try:
                conn.close()
            except sqlite3.Error:
                pass

    def _new(self) -> TrackedConnection:
        """Opens a WAL connection with the application's existing busy timeout semantics."""
        conn = sqlite3.connect(self.path, timeout=5, check_same_thread=False, factory=TrackedConnection)
        try:
            sqlite3.Connection.execute(conn, "PRAGMA journal_mode=WAL")
            sqlite3.Connection.execute(conn, "PRAGMA busy_timeout=5000")
            sqlite3.Connection.execute(conn, "PRAGMA foreign_keys=ON")
            return conn
        except Exception:
            conn.close()
            raise

    @contextmanager
    def connection(self, *, rows: bool = True, observe: bool = True, timeout: float = 5) -> Iterator[TrackedConnection]:
        """Acquires a bounded lease and commits or rolls back before returning it to the pool."""
        self._ensure_process()
        deadline = time.monotonic() + timeout
        conn: TrackedConnection | None = None
        with self.condition:
            self.waiting += 1
            try:
                while self.draining or (not self.idle and self.active >= self.capacity):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        incident_tracker.record("DB_POOL_EXHAUSTION", "critical", "database", f"The {self.name} pool exhausted its connection wait budget.")
                        raise sqlite3.OperationalError("Database pool acquisition timed out")
                    self.condition.wait(remaining)
                try:
                    conn = self.idle.pop() if self.idle else self._new()
                except sqlite3.Error:
                    self.unavailable = True
                    incident_tracker.record("DB_POOL_EXHAUSTION", "critical", "database", f"The {self.name} pool could not establish a connection.")
                    raise
                self.active += 1
            finally:
                self.waiting -= 1
        conn.row_factory = sqlite3.Row if rows else None
        conn.observe = observe
        reusable = True
        try:
            yield conn
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except sqlite3.Error:
                reusable = False
            raise
        finally:
            with self.condition:
                self.active -= 1
                if reusable:
                    self.idle.append(conn)
                else:
                    conn.close()
                self.condition.notify_all()

    def snapshot(self) -> PoolStatus:
        """Reads pool counters without acquiring or testing a database connection."""
        self._ensure_process()
        with self.condition:
            state = "draining" if self.draining else "unavailable" if self.unavailable else "exhausted" if self.waiting and self.active >= self.capacity else "healthy"
            return PoolStatus(name=self.name, capacity=self.capacity, active=self.active, idle=len(self.idle), waiting=self.waiting, generation=self.generation, status=state)

    def probe(self) -> float:
        """Measures a real SELECT 1 readiness probe, including acquisition time."""
        start = time.perf_counter()
        with self.connection(observe=False, timeout=1) as conn:
            # A SELECT alone misses WAL writer-lock exhaustion. Acquire and
            # immediately roll back a write transaction without modifying data.
            conn.execute("PRAGMA busy_timeout=1000")
            try:
                conn.execute("BEGIN IMMEDIATE")
                if conn.execute("SELECT 1").fetchone()[0] != 1:
                    raise sqlite3.OperationalError("Database probe failed")
                conn.rollback()
            finally:
                conn.execute("PRAGMA busy_timeout=5000")
        with self.condition:
            self.unavailable = False
        return (time.perf_counter() - start) * 1000

    def reset(self, timeout: float = 2) -> bool:
        """Drains in-flight leases, verifies a replacement, and leaves active work intact on timeout."""
        self._ensure_process()
        deadline = time.monotonic() + timeout
        with self.condition:
            if self.draining:
                return False
            self.draining = True
            try:
                while self.active:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return False
                    self.condition.wait(remaining)
                replacement = self._new()
                try:
                    if sqlite3.Connection.execute(replacement, "SELECT 1").fetchone()[0] != 1:
                        raise sqlite3.OperationalError("Database replacement probe failed")
                except Exception:
                    replacement.close()
                    raise
                for conn in self.idle:
                    conn.close()
                self.idle = [replacement]
                self.generation += 1
                self.unavailable = False
                return True
            except sqlite3.Error:
                self.unavailable = True
                return False
            finally:
                self.draining = False
                self.condition.notify_all()

    def close_idle(self) -> None:
        """Closes only idle connections during shutdown, never leased transactions."""
        self._ensure_process()
        with self.condition:
            for conn in self.idle:
                conn.close()
            self.idle.clear()


_registry: dict[str, SQLitePool] = {}
_registry_lock = threading.Lock()
_registry_pid = os.getpid()


def _ensure_registry_process() -> None:
    """Replaces a possibly inherited registry mutex before any child-process acquisition."""
    global _registry_lock, _registry_pid
    if _registry_pid != os.getpid():
        _registry_lock = threading.Lock()
        _registry_pid = os.getpid()


def get_pool(path: Path, name: str = "security") -> SQLitePool:
    """Shares a bounded pool for each database file within this API worker."""
    _ensure_registry_process()
    key = str(path.resolve())
    with _registry_lock:
        if key not in _registry:
            _registry[key] = SQLitePool(path, name, int(setting("APM_DB_POOL_SIZE", 4, 1, 32)))
        return _registry[key]


def pools() -> list[SQLitePool]:
    """Returns a stable list without holding the registry lock during pool operations."""
    _ensure_registry_process()
    with _registry_lock:
        return list(_registry.values())


def pool_snapshots() -> list[PoolStatus]:
    """Exposes all operational pools to the telemetry snapshot."""
    return [pool.snapshot() for pool in pools()]
