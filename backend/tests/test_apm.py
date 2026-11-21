"""Offline APM, admin authorization, verified feedback, and non-destructive healing tests."""

import asyncio
import sqlite3
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import ingest
import main
import security
import apm.database as database_module
import apm.incidents as incident_module
import apm.middleware as middleware_module
import apm.routes as routes_module
import apm.runtime as runtime_module
from apm.cache import document_stats_cache
from apm.database import SQLitePool
from apm.gateway import LLMGateway
from apm.healing import SelfHealingService
from apm.incidents import IncidentTracker, record_dependency_failure
from apm.middleware import TelemetryMiddleware
from apm.schemas import ActionExecution, Resources
from apm.store import AdminStore
from apm.telemetry import TelemetryTracker
from session_store import SessionStore


class Clock:
    """Provides deterministic monotonic time without waiting for fifteen minutes."""

    def __init__(self) -> None:
        """Starts fake monotonic time at a known origin."""
        self.now = 0.0

    def __call__(self) -> float:
        """Returns the current simulated monotonic time."""
        return self.now


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Isolates users, pools, incidents, services, and sessions from the developer's database."""
    monkeypatch.setenv("TESTING", "true")
    monkeypatch.setenv("QUEUE_BACKEND", "inline")
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setattr(database_module, "_registry", {})
    store = security.SecurityStore(tmp_path / "security.sqlite3")
    store.upsert_user("usr_admin", "operator@example.test", "admin")
    store.upsert_user("usr_member", "member@example.test", "user")
    store.upsert_user("usr_other", "other@example.test", "user")
    monkeypatch.setattr(security, "security_store", store)
    monkeypatch.setattr(main, "security_store", store)
    monkeypatch.setattr(security, "_device_notes", {})
    limiter = security.RateLimiter()
    monkeypatch.setattr(security, "rate_limiter", limiter)
    monkeypatch.setattr(main, "rate_limiter", limiter)
    monkeypatch.setattr(routes_module, "rate_limiter", limiter)
    sessions = SessionStore(tmp_path / "sessions.sqlite3")
    monkeypatch.setattr(ingest, "session_store", sessions)
    monkeypatch.setattr(main, "session_store", sessions)
    tracker = IncidentTracker()
    monkeypatch.setattr(incident_module, "incident_tracker", tracker)
    monkeypatch.setattr(middleware_module, "incident_tracker", tracker)
    monkeypatch.setattr(routes_module, "incident_tracker", tracker)
    monkeypatch.setattr(runtime_module, "incident_tracker", tracker)
    monkeypatch.setattr(database_module, "incident_tracker", tracker)
    admin_store = AdminStore(tmp_path / "security.sqlite3")
    llm = LLMGateway(models=["primary", "fallback"], tracker=tracker)
    healing = SelfHealingService(admin_store, tracker=tracker, llm=llm)
    healing.enabled = False
    monkeypatch.setattr(runtime_module.apm, "store", admin_store)
    monkeypatch.setattr(runtime_module.apm, "healing", healing)

    # Mints real signed sessions; browser-supplied roles are never used for authorization.
    def headers(user_id="usr_admin", role="admin", expired=False):
        """Builds signed test claims that still pass through the actual authentication middleware."""
        token = security.auth_service.sign({"sub": user_id, "role": role, "exp": int(time.time()) + (-1 if expired else 3600)})
        return {"Authorization": f"Bearer {token}"}

    yield SimpleNamespace(store=store, admin=admin_store, tracker=tracker, healing=healing, llm=llm, sessions=sessions, headers=headers)
    for pool in database_module.pools():
        pool.close_idle()
    document_stats_cache.drain(all_entries=True)


def test_sliding_window_percentiles_and_expiry() -> None:
    """Computes exact nearest-rank percentiles and expires latency and rolling traffic on idle windows."""
    clock = Clock()
    tracker = TelemetryTracker(clock=clock)
    for value in range(1, 101):
        tracker.record_request(value, 200 if value <= 80 else 503)
    snapshot = tracker.getSnapshot()
    assert snapshot["latencyMs"]["p50"] == 50
    assert snapshot["latencyMs"]["p95"] == 95
    assert snapshot["latencyMs"]["p99"] == 99
    assert snapshot["http"]["statusCounts"]["2xx"] == 80
    assert snapshot["http"]["statusCounts"]["5xx"] == 20
    clock.now = 901
    expired = tracker.getSnapshot()
    assert expired["http"]["windowRequests"] == 0
    assert expired["http"]["totalRequests"] == 100
    assert expired["latencyMs"]["p99"] is None
    assert expired["http"]["requestsPerSecond"] == 0


def test_telemetry_caps_samples_without_losing_volume() -> None:
    """Exposes latency truncation while keeping independent request counters accurate."""
    tracker = TelemetryTracker(max_samples=3)
    for _ in range(10):
        tracker.request_started()
        tracker.record_request(12, 429, started=True)
    snapshot = tracker.get_snapshot()
    assert snapshot.latencyMs.samplesTruncated
    assert snapshot.latencyMs.sampleCount == 3
    assert snapshot.http.windowRequests == 10
    assert snapshot.http.statusCounts["4xx"] == 10
    assert snapshot.http.inFlight == 0
    tracker.query_started()
    tracker.record_query(15)
    tracker.query_started()
    tracker.record_query(25)
    assert tracker.get_snapshot().database.averageQueryLatencyMs == 20
    assert tracker.get_snapshot().database.activeQueries == 0


def test_native_resources_are_real_or_explicitly_unavailable() -> None:
    """Reports process identity and a real positive RSS without fabricating an untraced Python heap."""
    tracker = TelemetryTracker()
    sample = tracker.sample_resources(7.5)
    assert sample.processId > 0
    assert sample.rssBytes is None or sample.rssBytes > 0
    assert sample.eventLoopLagMs == 7.5
    assert sample.memoryLimitBytes > 0


def test_incident_ring_redacts_coalesces_and_retries_critical_writes(sandbox) -> None:
    """Persists critical resolution state without unbounded growth or credential leakage."""
    tracker = IncidentTracker(capacity=3)
    first = tracker.record("LLM_TIMEOUT", "critical", "/query?token=secret", "Authorization: Bearer super-secret api_key=another-secret", 504)
    duplicate = tracker.record("LLM_TIMEOUT", "critical", "/query", "provider timeout", 504)
    assert duplicate.id == first.id and duplicate.occurrences == 2
    assert "super-secret" not in duplicate.errorDetails and "another-secret" not in duplicate.errorDetails
    assert duplicate.endpoint == "/query"

    def unavailable(_batch):
        """Simulates an incident store outage without a network dependency."""
        raise sqlite3.OperationalError("offline")

    tracker.flush(unavailable)
    assert tracker.persistence_status()[:2] == (False, 1)
    tracker.flush(sandbox.admin.persist_incidents)
    assert tracker.persistence_status()[:2] == (True, 0)
    tracker.resolve(first.id, "Confirmed provider recovery", automatic=True)
    tracker.flush(sandbox.admin.persist_incidents)
    restored = sandbox.admin.load_incidents()[0]
    assert restored.autoMitigated and restored.resolvedAt
    for index in range(6):
        tracker.record(f"ERROR_{index}", "low", f"/safe-{index}", "safe diagnostic")
    assert len(tracker.list()) == 3


def test_critical_retry_queue_is_bounded_and_reports_overflow() -> None:
    """Makes durable-write loss visible if a database outage outlasts the bounded retry queue."""
    tracker = IncidentTracker(capacity=2)
    for index in range(4):
        tracker.record(f"CRITICAL_{index}", "critical", "/test", "safe")
    assert tracker.persistence_status() == (False, 2, 2)


def test_http_middleware_tracks_429_5xx_and_never_reads_bodies(monkeypatch) -> None:
    """Records handled and unhandled errors exactly once without collecting private payloads."""
    telemetry, incidents = TelemetryTracker(), IncidentTracker()
    monkeypatch.setattr(middleware_module, "telemetry_tracker", telemetry)
    monkeypatch.setattr(middleware_module, "incident_tracker", incidents)
    app = FastAPI()
    app.add_middleware(TelemetryMiddleware)

    @app.get("/fail/{code}")
    async def fail(code: int):
        """Provides controlled HTTP failure responses for middleware tests."""
        if code == 500:
            raise RuntimeError("secret must not reach incident details")
        raise HTTPException(code, "safe")

    with TestClient(app, raise_server_exceptions=False) as client:
        for code in (429, 503, 500):
            assert client.get(f"/fail/{code}?password=private").status_code == code
    assert telemetry.get_snapshot().http.totalRequests == 3
    assert telemetry.get_snapshot().http.inFlight == 0
    assert {item.category for item in incidents.list()} == {"RATE_LIMIT_429", "HTTP_SERVER_ERROR"}
    assert all(item.endpoint == "/fail/{code}" and "secret" not in item.errorDetails for item in incidents.list())


def test_third_party_timeout_is_recorded_even_when_swallowed(sandbox) -> None:
    """Captures transient non-LLM provider failures without retaining secret-bearing messages."""
    item = record_dependency_failure("pinecone", TimeoutError("api_key=private"), "/query")
    assert item.category == "THIRD_PARTY_TIMEOUT"
    assert "private" not in item.errorDetails
    assert record_dependency_failure("pinecone", ValueError("ordinary validation"), "/query") is None


def test_sqlite_pool_reset_preserves_leased_work_and_rollbacks(tmp_path) -> None:
    """A drain timeout cannot close a live transaction or commit failed work."""
    pool = SQLitePool(tmp_path / "pool.sqlite3", "test", capacity=1)
    with pool.connection() as conn:
        conn.execute("CREATE TABLE items(value INTEGER)")
        assert not pool.reset(timeout=0.01)
        assert conn.execute("SELECT 1").fetchone()[0] == 1
        with pytest.raises(sqlite3.OperationalError):
            with pool.connection(timeout=0.01):
                pass
    with pytest.raises(RuntimeError):
        with pool.connection() as conn:
            conn.execute("INSERT INTO items VALUES (42)")
            raise RuntimeError("rollback")
    assert pool.reset(timeout=0.1)
    with pool.connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0
    assert pool.snapshot().generation == 1
    assert pool.snapshot().active == 0
    pool.close_idle()


def test_pool_waits_for_graceful_drain_before_replacement(tmp_path) -> None:
    """Verifies a real concurrent reset waits for the lease rather than killing its connection."""
    pool = SQLitePool(tmp_path / "drain.sqlite3", "drain", capacity=1)
    ready, release = threading.Event(), threading.Event()

    def work():
        """Holds a live connection until the test releases the simulated in-flight query."""
        with pool.connection() as conn:
            ready.set()
            release.wait(2)
            assert conn.execute("SELECT 1").fetchone()[0] == 1

    worker = threading.Thread(target=work)
    worker.start()
    assert ready.wait(1)
    results = []
    resetter = threading.Thread(target=lambda: results.append(pool.reset(timeout=1)))
    resetter.start()
    time.sleep(0.03)
    assert pool.snapshot().status == "draining"
    release.set()
    worker.join(2)
    resetter.join(2)
    assert results == [True]
    assert pool.snapshot().active == 0
    pool.close_idle()


def test_gateway_uses_real_fallback_and_respects_half_open_backoff() -> None:
    """Exercises timeout capture, fallback success, and verified recovery after cooldown."""
    clock, tracker = Clock(), IncidentTracker()
    gateway = LLMGateway(["primary", "fallback"], tracker, clock)
    gateway.threshold = 1
    gateway.is_configured = lambda: True
    calls = []

    class Client:
        """Provides deterministic provider responses without any SDK network call."""

        def __init__(self, model):
            """Selects the primary failure or the fallback success behavior."""
            self.model_name = model

        def invoke(self, _messages):
            """Fails the primary and returns a genuine test fallback result."""
            calls.append(self.model_name)
            if self.model_name == "primary":
                raise TimeoutError("provider stalled")
            return "fallback answer"

    gateway.configure(lambda model: calls.append(f"probe:{model}"), lambda: False)
    result = gateway.invoke(Client("primary"), [], Client)
    assert result == "fallback answer"
    assert gateway.snapshot().route == "fallback"
    assert gateway.snapshot().verified
    assert tracker.list()[0].category == "LLM_TIMEOUT"
    assert gateway.reset_eligible().status == "deferred"
    assert not any(call.startswith("probe:") for call in calls)
    clock.now = 100
    assert gateway.reset_eligible().verified
    assert "probe:primary" in calls
    assert not any(item.failures for item in gateway.snapshot().breakers)


def test_only_one_half_open_probe_is_admitted() -> None:
    """Prevents an expired circuit backoff from admitting a recovery stampede."""
    clock = Clock()
    gateway = LLMGateway(["primary", "fallback"], clock=clock)
    gateway.threshold = 1
    gateway._failed("primary", TimeoutError())
    assert not gateway._acquire("primary")
    clock.now = 100
    assert gateway._acquire("primary")
    assert not gateway._acquire("primary")


def test_failed_healing_and_security_incidents_are_not_marked_repaired(sandbox, monkeypatch) -> None:
    """An adapter failure or unrelated successful probe never auto-resolves an incident."""
    monkeypatch.setattr(sandbox.healing, "diagnose", lambda: ({"database": True}, 10.0))
    incident = sandbox.tracker.record("DB_POOL_EXHAUSTION", "critical", "database", "exhausted")
    sandbox.healing.adapters["CONNECTION_POOL_RESET"] = lambda: ActionExecution(action="CONNECTION_POOL_RESET", status="failed", notes="Drain timed out")
    report = asyncio.run(sandbox.healing.execute(incident_id=incident.id))
    assert report.status == "failed" and not report.verifiedNominal
    assert report.latencySavingsMs is None
    assert sandbox.tracker.get(incident.id).resolvedAt is None
    auth = sandbox.tracker.record("AUTH_ANOMALY", "high", "/auth/login", "denied")
    limited = sandbox.tracker.record("RATE_LIMIT_429", "medium", "/query", "limited")
    for item in (auth, limited):
        result = asyncio.run(sandbox.healing.execute(incident_id=item.id))
        assert result.actionsExecuted == []
        assert sandbox.tracker.get(item.id).resolvedAt is None
    with pytest.raises(ValueError):
        asyncio.run(sandbox.healing.execute(["CONNECTION_POOL_RESET"], incident_id=auth.id))


def test_verified_remedy_resolves_with_a_real_report_and_cooldown(sandbox, monkeypatch) -> None:
    """Persists verified repairs while preventing immediate repeated mutations."""
    monkeypatch.setattr(sandbox.healing, "diagnose", lambda: ({"database": True}, 4.0))
    incident = sandbox.tracker.record("DB_POOL_EXHAUSTION", "critical", "database", "exhausted")
    sandbox.healing.adapters["CONNECTION_POOL_RESET"] = lambda: ActionExecution(action="CONNECTION_POOL_RESET", status="success", verified=True, notes="Verified")
    first = asyncio.run(sandbox.healing.execute(incident_id=incident.id))
    assert first.status == "success" and first.verifiedNominal
    assert first.latencySavingsMs == 0
    assert sandbox.tracker.get(incident.id).autoMitigated
    second = asyncio.run(sandbox.healing.execute(["CONNECTION_POOL_RESET"]))
    assert second.status == "cooldown"
    assert len(sandbox.admin.reports()) == 2
    assert sandbox.tracker.mitigation_stats()[0] == 1


def test_database_writer_lock_cannot_be_claimed_healthy(sandbox) -> None:
    """A SELECT-only false positive cannot hide WAL writer-lock exhaustion."""
    blocker = sqlite3.connect(sandbox.store.db_path)
    try:
        blocker.execute("BEGIN IMMEDIATE")
        with pytest.raises(sqlite3.OperationalError):
            sandbox.admin.pool.probe()
    finally:
        blocker.rollback()
        blocker.close()
    assert sandbox.admin.pool.probe() >= 0


def test_cascade_does_not_resolve_an_incident_based_only_on_offline_bank_existence(sandbox, monkeypatch) -> None:
    """Availability of some local documents is not proof a failed request recovered."""
    monkeypatch.setattr(sandbox.healing, "diagnose", lambda: ({"database": True, "gateway": False}, 4.0))
    sandbox.llm.configure(lambda _model: None, lambda: True)
    sandbox.llm._failed("primary", TimeoutError())
    incident = sandbox.tracker.record("LLM_TIMEOUT", "high", "gateway/groq", "timeout")
    result = asyncio.run(sandbox.healing.execute(["CIRCUIT_FALLBACK_CASCADE"], incident_id=incident.id))
    assert result.actionsExecuted[0].verified
    assert sandbox.llm.snapshot().route == "offline"
    assert not result.verifiedNominal
    assert sandbox.tracker.get(incident.id).resolvedAt is None


def test_autonomous_tick_and_concurrency_guard(sandbox, monkeypatch) -> None:
    """Autonomous repair needs no admin click and overlapping execution returns busy."""
    sandbox.healing.enabled = True
    monkeypatch.setattr(sandbox.healing, "diagnose", lambda: ({"database": True}, 1.0))
    sandbox.tracker.record("MEMORY_PRESSURE", "high", "runtime", "over budget")
    sandbox.healing.adapters["MEMORY_COMPACT_DRAIN"] = lambda: ActionExecution(action="MEMORY_COMPACT_DRAIN", status="success", verified=True, notes="Verified RSS recovery")

    async def run():
        """Exercises automatic execution and then a contended manual entry point."""
        await sandbox.healing.tick()
        assert sandbox.healing.audit[0].trigger == "automatic"
        async with sandbox.healing.lock:
            assert (await sandbox.healing.execute()).status == "busy"

    asyncio.run(run())
    assert sandbox.tracker.list()[0].autoMitigated


def test_thresholds_require_sustained_breaches(sandbox) -> None:
    """A single resource spike does not trigger an automatic incident."""
    sandbox.healing.telemetry = TelemetryTracker()
    sandbox.healing.telemetry.resources = Resources(processId=1, memoryLimitBytes=100, rssBytes=95, cpuPercent=95, eventLoopLagMs=300)
    sandbox.healing.detect_thresholds()
    sandbox.healing.detect_thresholds()
    assert sandbox.tracker.list() == []
    sandbox.healing.detect_thresholds()
    assert {item.category for item in sandbox.tracker.list()} == {"MEMORY_PRESSURE", "CPU_PRESSURE", "EVENT_LOOP_LAG"}


def test_cache_flush_preserves_document_bank_and_security_state(sandbox, monkeypatch) -> None:
    """Only disposable metadata can be flushed; live documents and security controls survive."""
    document_stats_cache["doc"] = {"page_count": 4}
    monkeypatch.setitem(ingest.LOCAL_DOC_CHUNKS, "keep", ["owned document"])
    security.rate_limiter.blocked_until["test-ip"] = (time.time() + 60, "security")
    result = sandbox.healing._flush_cache()
    assert result.verified
    assert len(document_stats_cache) == 0
    assert ingest.LOCAL_DOC_CHUNKS["keep"] == ["owned document"]
    assert "test-ip" in security.rate_limiter.blocked_until


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/admin/overview", None), ("GET", "/api/admin/telemetry", None),
    ("GET", "/api/admin/users", None), ("GET", "/api/admin/users/usr_member", None),
    ("GET", "/api/admin/incidents", None), ("POST", "/api/admin/incidents/missing/resolve", {"notes": "Verified recovery"}),
    ("POST", "/api/admin/self-healing/execute", {}),
    ("POST", "/api/admin/users/usr_member/suspension", {"suspended": True, "notes": "Policy violation"}),
])
def test_every_admin_route_requires_protect_and_admin(sandbox, method, path, body) -> None:
    """Rejects both anonymous callers and signed non-admin users on every command-center route."""
    with TestClient(main.app) as client:
        assert client.request(method, path, json=body).status_code == 401
        response = client.request(method, path, json=body, headers=sandbox.headers("usr_member", "user"))
        assert response.status_code == 403
        assert response.json()["success"] is False
        assert response.json()["data"] is None


def test_forged_expired_and_suspended_admin_sessions_fail_closed(sandbox) -> None:
    """Trusts stored roles and current suspension rather than stale or self-asserted claims."""
    with TestClient(main.app) as client:
        assert client.get("/api/admin/overview", headers=sandbox.headers("usr_member", "admin")).status_code == 403
        assert client.get("/api/admin/overview", headers=sandbox.headers(expired=True)).status_code == 401
        assert client.get("/api/admin/overview", headers={"Authorization": "Bearer forged.value"}).status_code == 401
        sandbox.store.block_user("usr_admin", "test suspension")
        assert client.get("/api/admin/overview", headers=sandbox.headers()).status_code == 403


def test_real_ratings_and_aggregates_exclude_unverified_and_unrated_data(sandbox) -> None:
    """Uses verified per-review averages and keeps unrated roster users null rather than 5.0."""
    assert sandbox.admin.overview()["averageRating"] == 0.0
    assert sandbox.admin.users(user_id="usr_member").users[0].averageRating is None
    for user, session, stars in [("usr_member", "s1", 1), ("usr_member", "s2", 5), ("usr_other", "s3", 3)]:
        sandbox.admin.record_answer(user, session)
        sandbox.admin.feedback(user, session, stars)
    sandbox.admin.record_answer("usr_other", "s4")
    sandbox.admin.feedback("usr_other", "s4", complete=True)
    with sandbox.admin.pool.connection() as conn:
        conn.execute("INSERT INTO session_reviews VALUES ('s4', 'usr_other', 5, 0, ?)", (time.time(),))
    assert sandbox.admin.overview()["reviewCount"] == 3
    assert sandbox.admin.overview()["averageRating"] == 3
    assert sandbox.admin.overview()["completedSessions"] == 4
    sandbox.admin.feedback("usr_member", "s1", 4)
    assert sandbox.admin.overview()["reviewCount"] == 3
    assert sandbox.admin.overview()["averageRating"] == 4
    member = sandbox.admin.users(user_id="usr_member").users[0]
    assert member.totalSessions == 2 and member.averageRating == 4.5
    assert member.averageDiagnosticScore is None and member.interviewCount is None
    assert sandbox.admin.users(user_id="usr_admin").users[0].averageRating is None


def test_search_pagination_and_safe_user_projection(sandbox) -> None:
    """Search is parameterized, pagination is bounded, and passwords never enter admin responses."""
    with TestClient(main.app) as client:
        headers = sandbox.headers()
        page = client.get("/api/admin/users?search=member&pageSize=1", headers=headers).json()["data"]
        assert page["total"] == 1 and page["users"][0]["email"] == "member@example.test"
        assert page["users"][0]["averageRating"] is None
        assert "password_hash" not in str(page)
        assert client.get("/api/admin/users", params={"search": "%' OR 1=1 --"}, headers=headers).json()["data"]["total"] == 0
        assert client.get("/api/admin/users?page=0", headers=headers).status_code == 422
        assert client.get("/api/admin/users?pageSize=1000", headers=headers).status_code == 422
        assert client.get("/api/admin/overview", headers=headers).json()["data"]["averageRating"] == 0.0


def test_suspension_is_immediate_and_admin_lockout_is_prevented(sandbox) -> None:
    """Existing user tokens stop working after suspension and resume only after an audited restore."""
    with TestClient(main.app) as client:
        headers = sandbox.headers()
        member = sandbox.headers("usr_member", "user")
        assert client.post("/api/admin/users/usr_admin/suspension", headers=headers, json={"suspended": True, "notes": "Do not lock owner out"}).status_code == 409
        suspended = client.post("/api/admin/users/usr_member/suspension", headers=headers, json={"suspended": True, "notes": "Verified policy incident"})
        assert suspended.status_code == 200 and suspended.json()["data"]["user"]["suspended"]
        assert client.get("/documents", headers=member).status_code == 403
        assert client.post("/api/admin/users/usr_member/suspension", headers=headers, json={"suspended": False, "notes": "Identity verified; restore"}).status_code == 200
        assert client.get("/documents", headers=member).status_code == 200
        assert client.post("/api/admin/users/usr_member/suspension", headers=headers, json={"suspended": "false", "notes": "Invalid boolean"}).status_code == 422


def test_feedback_is_owned_verified_bounded_and_optional(sandbox) -> None:
    """Rejects foreign sessions and fake verification flags while allowing completion without a rating."""
    sandbox.admin.record_answer("usr_member", "owned")
    with TestClient(main.app) as client:
        member, other = sandbox.headers("usr_member", "user"), sandbox.headers("usr_other", "user")
        assert client.post("/api/sessions/owned/review", headers=other, json={"stars": 5}).status_code == 404
        for stars in [0, 6, 5.0, "5", True, None]:
            assert client.post("/api/sessions/owned/review", headers=member, json={"stars": stars}).status_code == 422
        assert client.post("/api/sessions/owned/review", headers=member, json={"stars": 5, "verified": True}).status_code == 422
        completed = client.post("/api/sessions/owned/complete", headers=member).json()["data"]
        assert completed["completed"] and completed["stars"] is None and not completed["verified"]
        assert sandbox.admin.overview()["reviewCount"] == 0
        rated = client.post("/api/sessions/owned/review", headers=member, json={"stars": 2}).json()["data"]
        assert rated["stars"] == 2 and rated["verified"]
        assert sandbox.admin.overview()["averageRating"] == 2


def test_incident_false_filter_resolution_and_action_allowlist(sandbox) -> None:
    """Handles autoMitigated=false explicitly and requires a real manual resolution explanation."""
    first = sandbox.tracker.record("HTTP_SERVER_ERROR", "high", "/query", "failed", 500)
    second = sandbox.tracker.record("MEMORY_PRESSURE", "high", "runtime", "recovered")
    sandbox.tracker.resolve(second.id, "Verified memory recovery", automatic=True)
    with TestClient(main.app) as client:
        headers = sandbox.headers()
        incidents = client.get("/api/admin/incidents?autoMitigated=false", headers=headers).json()["data"]
        assert [item["id"] for item in incidents["incidents"]] == [first.id]
        assert client.post(f"/api/admin/incidents/{first.id}/resolve", headers=headers, json={"notes": "   "}).status_code == 422
        resolved = client.post(f"/api/admin/incidents/{first.id}/resolve", headers=headers, json={"notes": "Root cause fixed and endpoint rechecked"}).json()["data"]
        assert resolved["resolvedAt"] and not resolved["autoMitigated"]
        assert client.post("/api/admin/self-healing/execute", headers=headers, json={"actions": ["DELETE_DATABASE"]}).status_code == 422
        assert client.post("/api/admin/self-healing/execute", headers=headers, json={"command": "arbitrary shell command"}).status_code == 422


def test_query_creates_real_activity_and_cannot_reuse_another_users_session(sandbox, monkeypatch) -> None:
    """Connects actual query responses to durable session counts and server-enforced ownership."""
    sandbox.store.add_document({"doc_id": "doc_owned", "user_id": "usr_member", "filename": "notes.pdf", "file_size": 12, "chunk_count": 1, "content_hash": "hash", "created_at": int(time.time())})
    calls = []

    def answer(question, doc_ids, history, image):
        """Returns a valid offline query result while preserving the real API's auth and persistence."""
        calls.append(question)
        return {"success": True, "answer": "A grounded test response.", "sources": [], "doc_ids": doc_ids, "confidence": "high", "confidence_score": 0.9}

    monkeypatch.setattr(main, "answer_question", answer)
    monkeypatch.setattr(main, "verify_recaptcha_token", lambda *_args: True)
    with TestClient(main.app) as client:
        member = sandbox.headers("usr_member", "user")
        response = client.post("/query", headers=member, json={"question": "Explain the notes", "doc_ids": ["doc_owned"]})
        assert response.status_code == 200
        identifier = response.json()["session_id"]
        assert identifier and sandbox.admin.overview()["totalSessions"] == 1
        assert sandbox.admin.overview()["completedSessions"] == 0
        stolen = client.post("/query", headers=sandbox.headers("usr_other", "user"), json={"question": "Read their notes", "session_id": identifier})
        assert stolen.status_code == 404 and len(calls) == 1
        assert client.post(f"/api/sessions/{identifier}/complete", headers=member).status_code == 200
        second = client.post("/query", headers=member, json={"question": "Next question", "session_id": identifier}).json()
        assert second["session_id"] != identifier
        assert sandbox.admin.overview()["totalSessions"] == 2
        assert sandbox.admin.overview()["completedSessions"] == 1


def test_cors_accepts_bearer_auth_and_credentialed_admin_requests(sandbox) -> None:
    """Supports an explicit cross-origin Authorization header without wildcard credential origins."""
    with TestClient(main.app) as client:
        response = client.options("/api/admin/overview", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_corrupted_transient_metadata_is_detected_and_recomputed(sandbox, monkeypatch) -> None:
    """Turns an actual cache shape failure into a healable incident instead of using bad metadata."""
    import query

    monkeypatch.setattr(query, "incident_tracker", sandbox.tracker)
    monkeypatch.setitem(query.DOC_METADATA, "cache-doc", {"filename": "valid.pdf", "page_count": 3, "chunk_count": 7})
    document_stats_cache["cache-doc"] = {"page_count": "corrupt", "chunk_count": None}
    result = query.get_document_stats("cache-doc", "unused-index")
    assert result["page_count"] == 3 and result["chunk_count"] == 7
    assert sandbox.tracker.list()[0].category == "TRANSIENT_CACHE_CORRUPTION"


def test_malformed_history_and_unbounded_document_lists_are_rejected() -> None:
    """Rejects hostile history shapes as validation errors rather than crashing string operations."""
    from pydantic import ValidationError
    from models import QueryRequest
    from query import sanitize_history

    for history in [[{"role": {}, "content": "text"}], [{"role": "user", "content": None}], [{"role": "user", "content": "x" * 4001}]]:
        with pytest.raises(ValidationError):
            QueryRequest(question="Question", history=history)
    with pytest.raises(ValidationError):
        QueryRequest(question="Question", doc_ids=["doc"] * 6)
    assert sanitize_history([None, {"role": [], "content": "text"}]) == []


def test_prefork_pool_and_telemetry_state_are_process_local(tmp_path) -> None:
    """A child process must neither reuse an inherited connection nor advertise its parent's metrics."""
    import os

    pool = SQLitePool(tmp_path / "fork.sqlite3", "prefork")
    with pool.connection() as original:
        original.execute("CREATE TABLE durable(value INTEGER)")
        original.execute("INSERT INTO durable VALUES (1)")
    pool.process_id = -1  # Simulates the PID change without requiring Unix fork on Windows CI.
    with pool.connection() as fresh:
        assert fresh is not original
        assert fresh.execute("SELECT COUNT(*) FROM durable").fetchone()[0] == 1
    assert pool.process_id == os.getpid()
    assert pool.generation == 1
    pool.close_idle()
    tracker = TelemetryTracker()
    tracker.record_request(5, 200)
    parent_instance = tracker.instance
    tracker.process_id = -1
    child = tracker.get_snapshot()
    assert child.instanceId != parent_instance
    assert child.http.totalRequests == 0
    assert child.resources.processId == os.getpid()


def test_memory_drain_keeps_active_background_tasks(monkeypatch) -> None:
    """Cleanup discards only completed thread handles and cannot cancel in-flight ingestion."""
    import job_queue

    release = threading.Event()
    active = threading.Thread(target=lambda: release.wait(2))
    finished = threading.Thread(target=lambda: None)
    active.start()
    finished.start()
    finished.join(1)
    monkeypatch.setattr(job_queue, "_inline_jobs", {"active": active, "finished": finished})
    try:
        assert job_queue.drain_completed_jobs() == 1
        assert set(job_queue._inline_jobs) == {"active"}
        assert active.is_alive()
    finally:
        release.set()
        active.join(2)


def test_translated_server_errors_use_the_actual_outgoing_http_status(monkeypatch) -> None:
    """A global provider-error mapper must not turn the APM's 4xx counters into false 5xx incidents."""
    from starlette.responses import JSONResponse
    from apm.middleware import TelemetryFastAPI

    telemetry, incidents = TelemetryTracker(), IncidentTracker()
    monkeypatch.setattr(middleware_module, "telemetry_tracker", telemetry)
    monkeypatch.setattr(middleware_module, "incident_tracker", incidents)
    app = TelemetryFastAPI()

    @app.exception_handler(Exception)
    async def translate(_request, _error):
        """Simulates the application's existing upstream rate-limit error translation."""
        return JSONResponse({"success": False, "data": None, "error": "Provider quota"}, status_code=429)

    @app.get("/provider")
    async def failed_provider():
        """Raises before response headers so the global handler chooses the outgoing status."""
        raise RuntimeError("provider quota")

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/provider").status_code == 429
    snapshot = telemetry.get_snapshot()
    assert snapshot.http.statusCounts["4xx"] == 1 and snapshot.http.statusCounts["5xx"] == 0
    assert incidents.list()[0].category == "RATE_LIMIT_429"


def test_cancelled_requests_do_not_create_fake_server_error_incidents(monkeypatch) -> None:
    """Client cancellation releases the in-flight counter without manufacturing a server outage."""
    telemetry, incidents = TelemetryTracker(), IncidentTracker()
    monkeypatch.setattr(middleware_module, "telemetry_tracker", telemetry)
    monkeypatch.setattr(middleware_module, "incident_tracker", incidents)

    async def cancelled_app(_scope, _receive, _send):
        """Simulates an ASGI request cancelled during client disconnect."""
        raise asyncio.CancelledError()

    async def receive():
        """Supplies a minimal disconnect notification without a body."""
        return {"type": "http.disconnect"}

    async def send(_message):
        """Accepts any ASGI send message in the test harness."""
        return None

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(TelemetryMiddleware(cancelled_app)({"type": "http"}, receive, send))
    assert telemetry.get_snapshot().http.inFlight == 0
    assert telemetry.get_snapshot().http.statusCounts["4xx"] == 1
    assert incidents.list() == []
