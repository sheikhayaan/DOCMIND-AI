"""Authenticated admin and session-feedback routes with consistent typed envelopes."""

import asyncio
import os
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from apm.common import redact
from apm.incidents import incident_tracker
from apm.runtime import apm
from apm.schemas import (
    Alert, Envelope, HealingReport, HealingRequest, Incident, IncidentPage, Overview,
    ResolutionRequest, ReviewRequest, SessionFeedback, Severity, SuspensionRequest,
    TelemetrySnapshot, UserDetail, UserPage,
)
from apm.telemetry import telemetry_tracker
from security import audit_logger, get_admin_user, get_current_user, rate_limiter, sanitize_identifier


async def protect(request: Request) -> dict[str, Any]:
    """Verifies the signed bearer token and checks persisted suspension on every endpoint."""
    return await asyncio.to_thread(get_current_user, request)


async def require_admin(request: Request, user: Annotated[dict[str, Any], Depends(protect)]) -> dict[str, Any]:
    """Requires the current stored admin role after authentication, never a client-supplied role."""
    if user.get("role") != "admin":
        # Preserve the existing unauthorized-access audit and proportional probe controls.
        await asyncio.to_thread(get_admin_user, request)
        raise HTTPException(status_code=403, detail="Admin access denied")
    await rate_limiter.check(request, "admin_read")
    return user


Admin = Annotated[dict[str, Any], Depends(require_admin)]
User = Annotated[dict[str, Any], Depends(protect)]
admin_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])
feedback_router = APIRouter(prefix="/api/sessions", tags=["feedback"], dependencies=[Depends(protect)])


@admin_router.get("/overview", response_model=Envelope[Overview])
async def overview() -> Envelope[Overview]:
    """Combines durable usage and verified ratings with current operational alerts."""
    data = await asyncio.to_thread(apm.store.overview)
    incidents = incident_tracker.list(unresolved=True)
    telemetry = await asyncio.to_thread(telemetry_tracker.get_snapshot)
    alerts = [Alert(severity=item.severity, message=f"{item.category}: {item.errorDetails}") for item in incidents[:8]]
    if telemetry.gateway and not telemetry.gateway.configured:
        alerts.append(Alert(severity="high", message="LLM provider credentials are not configured."))
    elif telemetry.gateway and not telemetry.gateway.verified:
        alerts.append(Alert(severity="medium", message="Gateway health has not been recently verified; no nominal state is assumed."))
    healthy, pending, dropped = incident_tracker.persistence_status()
    if not healthy or dropped:
        alerts.append(Alert(severity="critical", message=f"Critical audit persistence is degraded ({pending} pending writes, {dropped} overflowed writes)."))
    if not apm.healing.enabled:
        alerts.append(Alert(severity="medium", message="Autonomous healing is disabled by the operator; manual diagnostics remain available."))
    count, mttr = incident_tracker.mitigation_stats()
    return Envelope(data=Overview(**data, activeIncidents=len(incidents), systemAlerts=alerts, autoHealingEnabled=apm.healing.enabled, autoMitigatedCount=count, measuredMttrMs=mttr))


@admin_router.get("/telemetry", response_model=Envelope[TelemetrySnapshot])
async def telemetry() -> Envelope[TelemetrySnapshot]:
    """Returns the current worker's bounded fifteen-minute telemetry window."""
    return Envelope(data=await asyncio.to_thread(telemetry_tracker.get_snapshot))


@admin_router.get("/users", response_model=Envelope[UserPage])
async def users(
    search: str = Query(default="", max_length=100), role: Literal["user", "admin"] | None = None,
    status: Literal["active", "suspended"] | None = None, rated: Literal["rated", "unrated"] | None = None,
    page: int = Query(default=1, ge=1, le=1000000), page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
) -> Envelope[UserPage]:
    """Searches real users with bounded pagination and nullable diagnostic and rating values."""
    return Envelope(data=await asyncio.to_thread(apm.store.users, search.strip(), role, status, rated, page, page_size))


@admin_router.get("/users/{user_id}", response_model=Envelope[UserDetail])
async def user_detail(user_id: str) -> Envelope[UserDetail]:
    """Inspects safe account metadata and recent session activity without returning credentials."""
    return Envelope(data=await asyncio.to_thread(apm.store.user_detail, sanitize_identifier(user_id, "user_id")))


@admin_router.post("/users/{user_id}/suspension", response_model=Envelope[UserDetail])
async def suspend_user(user_id: str, body: SuspensionRequest, request: Request, admin: Admin) -> Envelope[UserDetail]:
    """Audits suspension changes and prevents self-lockout or suspension of any admin."""
    await rate_limiter.check(request, "admin_write")
    result = await asyncio.to_thread(apm.store.suspend, sanitize_identifier(user_id, "user_id"), body.suspended, body.notes, admin["sub"], rate_limiter.get_client_ip(request))
    return Envelope(data=result)


@admin_router.get("/incidents", response_model=Envelope[IncidentPage])
async def incidents(
    severity: Severity | None = None, auto_mitigated: bool | None = Query(default=None, alias="autoMitigated"),
    unresolved: bool | None = None, page: int = Query(default=1, ge=1, le=1000000),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
) -> Envelope[IncidentPage]:
    """Filters incident and repair history while exposing any persistence degradation."""
    rows = incident_tracker.list(severity, auto_mitigated, unresolved)
    reports = await asyncio.to_thread(apm.store.reports)
    with apm.healing.audit_lock:
        merged = {item.id: item for item in [*reports, *apm.healing.audit]}
    healthy, pending, dropped = incident_tracker.persistence_status()
    return Envelope(data=IncidentPage(
        incidents=rows[(page - 1) * page_size:page * page_size], total=len(rows), page=page, pageSize=page_size,
        auditTrail=sorted(merged.values(), key=lambda item: item.startedAt, reverse=True)[:30],
        persistenceHealthy=healthy, pendingCriticalWrites=pending, droppedCriticalWrites=dropped,
    ))


@admin_router.post("/incidents/{incident_id}/resolve", response_model=Envelope[Incident])
async def resolve_incident(incident_id: str, body: ResolutionRequest, request: Request, admin: Admin) -> Envelope[Incident]:
    """Records a human resolution separately from verified autonomous mitigation."""
    await rate_limiter.check(request, "admin_write")
    identifier = sanitize_identifier(incident_id, "incident_id")
    if incident_tracker.get(identifier) is None:
        raise HTTPException(status_code=404, detail="Incident not found in the retained log")
    await asyncio.to_thread(audit_logger.log, "admin_incident_resolved", admin["sub"], rate_limiter.get_client_ip(request), {"incidentId": identifier, "notes": redact(body.notes)})
    incident = incident_tracker.resolve(identifier, body.notes)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident expired from the retained log")
    await asyncio.to_thread(incident_tracker.flush, apm.store.persist_incidents)
    return Envelope(data=incident)


@admin_router.post("/self-healing/execute", response_model=Envelope[HealingReport])
async def execute_healing(request: Request, admin: Admin, body: HealingRequest | None = None) -> Envelope[HealingReport]:
    """Runs only allowlisted, cooldown-protected remedies and returns their measured outcomes."""
    await rate_limiter.check(request, "admin_write")
    body = body or HealingRequest()
    try:
        result = await apm.healing.execute(body.actions, incident_id=body.incidentId, actor=admin["sub"])
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Envelope(data=result)


@admin_router.get("/learning", response_model=Envelope[dict[str, Any]])
async def get_learning_telemetry(request: Request, admin: Admin) -> Envelope[dict[str, Any]]:
    """Reads persistent self-learning memory, active AI engines, and adaptive parameters."""
    await rate_limiter.check(request, "admin_read")
    from learning import learning_store
    active_engine = "Google Gemini (gemini-2.5-flash)" if os.getenv("GEMINI_API_KEY") else "Groq (qwen/qwen3.8-27b)"
    stats = await asyncio.to_thread(learning_store.get_stats, active_engine)
    return Envelope(data=stats.model_dump())


@admin_router.post("/learning/consolidate", response_model=Envelope[dict[str, Any]])
async def run_learning_consolidation(request: Request, admin: Admin) -> Envelope[dict[str, Any]]:
    """Executes an autonomous self-learning consolidation cycle to calibrate prompt and retrieval weights."""
    await rate_limiter.check(request, "admin_write")
    from learning import learning_store
    active_engine = "gemini-2.5-flash" if os.getenv("GEMINI_API_KEY") else "qwen/qwen3.8-27b"
    result = await asyncio.to_thread(learning_store.consolidate_learning, active_engine)
    return Envelope(data=result.model_dump())


@feedback_router.get("/{session_id}/feedback", response_model=Envelope[SessionFeedback])
async def get_feedback(session_id: str, request: Request, user: User) -> Envelope[SessionFeedback]:
    """Reads only the authenticated user's existing session review."""
    await rate_limiter.check(request, "general")
    return Envelope(data=await asyncio.to_thread(apm.store.feedback, user["sub"], sanitize_identifier(session_id, "session_id")))


@feedback_router.post("/{session_id}/review", response_model=Envelope[SessionFeedback])
async def review_session(session_id: str, body: ReviewRequest, request: Request, user: User) -> Envelope[SessionFeedback]:
    """Writes a verified one-per-session rating after checking real answered-session ownership."""
    await rate_limiter.check(request, "general")
    return Envelope(data=await asyncio.to_thread(apm.store.feedback, user["sub"], sanitize_identifier(session_id, "session_id"), body.stars))


@feedback_router.post("/{session_id}/complete", response_model=Envelope[SessionFeedback])
async def complete_session(session_id: str, request: Request, user: User) -> Envelope[SessionFeedback]:
    """Completes a session without manufacturing a rating when feedback is skipped."""
    await rate_limiter.check(request, "general")
    result = await asyncio.to_thread(apm.store.feedback, user["sub"], sanitize_identifier(session_id, "session_id"), complete=True)
    return Envelope(data=result)
