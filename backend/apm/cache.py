"""Bounded disposable caches; document banks, auth limits, and durable jobs are excluded."""

import threading
import time
from collections import OrderedDict
from collections.abc import Iterator, MutableMapping
from typing import Generic, TypeVar

V = TypeVar("V")


class TransientCache(MutableMapping[str, V], Generic[V]):
    """Provides a thread-safe TTL/LRU cache for recomputable metadata only."""

    def __init__(self, capacity: int = 512, ttl: float = 900) -> None:
        """Bounds both cache cardinality and stale entry lifetime."""
        self.capacity, self.ttl = capacity, ttl
        self.lock = threading.RLock()
        self.entries: OrderedDict[str, tuple[float, V]] = OrderedDict()

    def __getitem__(self, key: str) -> V:
        """Returns only unexpired values and updates their LRU position."""
        with self.lock:
            expiry, value = self.entries[key]
            if expiry <= time.monotonic():
                del self.entries[key]
                raise KeyError(key)
            self.entries.move_to_end(key)
            return value

    def __setitem__(self, key: str, value: V) -> None:
        """Evicts the least-recently-used metadata when the configured cap is reached."""
        with self.lock:
            self.entries[key] = (time.monotonic() + self.ttl, value)
            self.entries.move_to_end(key)
            while len(self.entries) > self.capacity:
                self.entries.popitem(last=False)

    def __delitem__(self, key: str) -> None:
        """Removes one disposable cache key without touching its source document."""
        with self.lock:
            del self.entries[key]

    def __iter__(self) -> Iterator[str]:
        """Iterates a stable key snapshot under concurrent requests."""
        with self.lock:
            return iter(list(self.entries))

    def __len__(self) -> int:
        """Reports retained entries without scanning private document data."""
        with self.lock:
            return len(self.entries)

    def drain(self, *, all_entries: bool = False) -> int:
        """Deletes expired or all recomputable entries and reports the actual count."""
        now = time.monotonic()
        with self.lock:
            keys = [key for key, (expiry, _) in self.entries.items() if all_entries or expiry <= now]
            for key in keys:
                del self.entries[key]
            return len(keys)


# Only this cache is healable; the local document bank remains available for failover.
document_stats_cache: TransientCache[dict] = TransientCache()
