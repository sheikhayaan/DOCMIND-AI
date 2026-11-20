"""Native resource sampling without an external agent or additional packages."""

import ctypes
import os
import time
import tracemalloc
from pathlib import Path

from apm.common import setting, utc_now
from apm.schemas import Resources


class ResourceSampler:
    """Samples real process CPU/RSS and optional Python heap allocations."""

    def __init__(self) -> None:
        """Initializes CPU deltas without inventing a first-sample utilization."""
        self._wall = time.monotonic()
        self._cpu = time.process_time()
        self._system: tuple[int, int] | None = None
        self.limit = int(setting("APM_MEMORY_LIMIT_MB", 1024, 64, 1048576) * 1024 * 1024)

    def _native_memory(self) -> int | None:
        """Reads current resident bytes on Windows or Linux, not peak RSS."""
        try:
            if os.name == "nt":
                from ctypes import wintypes

                class MemoryCounters(ctypes.Structure):
                    """Matches Windows PROCESS_MEMORY_COUNTERS_EX layout."""

                    _fields_ = [
                        ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                        ("PrivateUsage", ctypes.c_size_t),
                    ]

                counters = MemoryCounters()
                counters.cb = ctypes.sizeof(counters)
                kernel = ctypes.windll.kernel32
                kernel.GetCurrentProcess.restype = wintypes.HANDLE
                get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
                get_memory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
                if get_memory(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
                    return int(counters.WorkingSetSize)
                return None
            resident_pages = int(Path("/proc/self/statm").read_text().split()[1])
            return resident_pages * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError, IndexError, AttributeError):
            return None

    def _system_cpu(self) -> float | None:
        """Calculates host CPU utilization from cumulative kernel counters."""
        try:
            if os.name == "nt":
                idle, kernel, user = ctypes.c_ulonglong(), ctypes.c_ulonglong(), ctypes.c_ulonglong()
                if not ctypes.windll.kernel32.GetSystemTimes(
                    ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
                ):
                    return None
                current = (int(kernel.value + user.value), int(idle.value))
            else:
                fields = Path("/proc/stat").read_text().splitlines()[0].split()[1:9]
                ticks = [int(value) for value in fields]
                current = (sum(ticks), ticks[3] + ticks[4])
            previous, self._system = self._system, current
            if previous is None or current[0] <= previous[0]:
                return None
            return round(max(0.0, min(100.0, 100 * (1 - (current[1] - previous[1]) / (current[0] - previous[0])))), 2)
        except (OSError, ValueError, IndexError, AttributeError):
            return None

    def sample(self, lag_ms: float | None = None) -> Resources:
        """Returns a timestamped sample and leaves unsupported measurements null."""
        wall, cpu = time.monotonic(), time.process_time()
        elapsed = wall - self._wall
        percent = 100 * (cpu - self._cpu) / elapsed / max(1, os.cpu_count() or 1) if elapsed > 0 else None
        self._wall, self._cpu = wall, cpu
        heap = tracemalloc.get_traced_memory() if tracemalloc.is_tracing() else (None, None)
        return Resources(
            processId=os.getpid(), cpuPercent=round(min(100.0, max(0.0, percent)), 2) if percent is not None else None,
            systemCpuPercent=self._system_cpu(), rssBytes=self._native_memory(),
            heapUsedBytes=heap[0], heapPeakBytes=heap[1], memoryLimitBytes=self.limit,
            eventLoopLagMs=round(max(0, lag_ms), 2) if lag_ms is not None else None, sampledAt=utc_now(),
        )
