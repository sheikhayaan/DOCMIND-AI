"""ASGI request telemetry, including failed and streamed responses, without body capture."""

import asyncio
import time

from fastapi import FastAPI
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from apm.incidents import incident_tracker
from apm.telemetry import telemetry_tracker


class TelemetryMiddleware:
    """Measures full response lifetime and records safe low-cardinality HTTP incidents."""

    def __init__(self, app: ASGIApp) -> None:
        """Wraps an ASGI application without buffering uploads or streaming bodies."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Counts every completed or failed HTTP request exactly once in a finally block."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started, status = time.perf_counter(), 500
        telemetry_tracker.request_started()

        async def track_send(message: Message) -> None:
            """Observes status headers and forwards messages without inspecting their content."""
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, track_send)
        except asyncio.CancelledError:
            # Client cancellation is not an application 5xx incident.
            status = 499
            raise
        finally:
            telemetry_tracker.record_request((time.perf_counter() - started) * 1000, status, started=True)
            endpoint = getattr(scope.get("route"), "path", "/unmatched")
            if status == 429:
                incident_tracker.record("RATE_LIMIT_429", "medium", endpoint, "Request throttled. Abuse-prevention limits are never cleared by self-healing.", status)
            elif status >= 500:
                incident_tracker.record("HTTP_SERVER_ERROR", "high", endpoint, "Request failed with a server error; inspect application diagnostics. Request payloads were not retained.", status)
            elif status in {401, 403} and endpoint.startswith(("/auth/", "/admin/", "/api/admin/")):
                incident_tracker.record("AUTH_ANOMALY", "medium", endpoint, "Authentication or administrator authorization was rejected.", status)


class TelemetryFastAPI(FastAPI):
    """Places telemetry outside error translation so it sees the status actually sent to clients."""

    def build_middleware_stack(self) -> ASGIApp:
        """Wraps the completed FastAPI stack, including its global exception response handler."""
        return TelemetryMiddleware(super().build_middleware_stack())
