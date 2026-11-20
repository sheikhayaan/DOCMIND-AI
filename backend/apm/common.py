"""Small shared helpers for bounded configuration and safe operational metadata."""

import math
import os
import re
from datetime import datetime, timezone


def utc_now() -> str:
    """Returns an unambiguous millisecond UTC timestamp for API payloads."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def epoch_iso(value: float) -> str:
    """Formats a stored epoch timestamp in the same UTC wire format."""
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def setting(name: str, default: float, minimum: float, maximum: float) -> float:
    """Bounds optional environment settings so malformed configuration cannot break APM."""
    try:
        value = float(os.getenv(name, str(default)))
        return max(minimum, min(maximum, value)) if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def redact(value: str, limit: int = 500) -> str:
    """Scrubs common credentials and URL query strings from operational notes."""
    text = " ".join(str(value or "").replace("\x00", "").split())
    text = re.sub(r"(?i)\bBearer\s+\S+", "Bearer [redacted]", text)
    text = re.sub(
        r"(?i)([\"']?(?:api[_-]?key|token|password|authorization|secret)[\"']?\s*[:=]\s*)[\"']?[^\s,;}]+",
        r"\1[redacted]", text,
    )
    text = re.sub(r"\b(?:gsk_|sk-)[a-zA-Z0-9_-]+", "[redacted]", text)
    text = re.sub(r"(https?://[^\s?]+)\?\S+", r"\1?[redacted]", text)
    return text[:limit]
