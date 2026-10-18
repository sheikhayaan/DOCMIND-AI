"""Sentry observability for the API, ingestion workers, and security events.

The module is deliberately fail-open: if SENTRY_DSN is unset or the SDK is not
installed, every helper is a no-op so local development and tests never require
an external service. PII is scrubbed before events leave the process.
"""

import os
from typing import Any

try:
    import sentry_sdk
except ImportError:  # pragma: no cover - dependency is declared in requirements
    sentry_sdk = None  # type: ignore[assignment]

SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
RELEASE = os.getenv("SENTRY_RELEASE", "docmind-backend@1.0.0")
# Sensitive keys are removed recursively; documents and prompts are never sent.
_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "email",
    "filename",
    "file_name",
    "password",
    "question",
    "answer",
    "content",
    "text",
    "token",
    "access_token",
    "recaptcha_token",
    "ip_address",
    "credential",
}


def _scrub(value: Any, depth: int = 0) -> Any:
    """Recursively removes sensitive keys and truncates deeply nested values."""
    if depth > 6:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            key: ("[redacted]" if str(key).lower() in _SENSITIVE_KEYS else _scrub(item, depth + 1))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(item, depth + 1) for item in value[:50]]
    if isinstance(value, str) and len(value) > 500:
        return f"{value[:500]}...[truncated]"
    return value


def _before_send(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """Scrubs request bodies, breadcrumbs, and extra data before transmission."""
    event["request"] = _scrub(event.get("request", {}))
    event["extra"] = _scrub(event.get("extra", {}))
    event["breadcrumbs"] = _scrub(event.get("breadcrumbs", {}))
    event.pop("user", None)
    return event


if SENTRY_DSN and sentry_sdk is not None:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=ENVIRONMENT,
        release=RELEASE,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        send_default_pii=False,
        before_send=_before_send,
    )


def capture_exception(error: BaseException) -> None:
    """Reports one exception to Sentry when configured."""
    if not SENTRY_DSN or sentry_sdk is None:
        return
    sentry_sdk.capture_exception(error)


def capture_message(message: str, level: str = "error") -> None:
    """Reports one non-exception message to Sentry when configured."""
    if not SENTRY_DSN or sentry_sdk is None:
        return
    sentry_sdk.capture_message(message, level=level)


def capture_security_event(event_type: str, severity: str = "warning") -> None:
    """Reports a named security signal without attaching user content or PII."""
    if not SENTRY_DSN or sentry_sdk is None:
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("security_event", event_type)
        scope.set_tag("severity", severity)
        scope.set_level(severity)
        sentry_sdk.capture_message(f"security_event:{event_type}", level=severity)


def capture_job_failure(job_id: str, stage: str) -> None:
    """Reports a failed ingestion job with only its opaque id and stage."""
    if not SENTRY_DSN or sentry_sdk is None:
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("ingestion_job", job_id)
        scope.set_tag("stage", stage)
        sentry_sdk.capture_message("ingestion_job_failed", level="error")
