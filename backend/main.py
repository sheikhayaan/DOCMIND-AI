from dotenv import load_dotenv

load_dotenv()

import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from storage import DocumentStorageError, document_store, encryption_ready

from ingest import DOC_METADATA, create_session, delete_doc
from session_store import session_store
from job_queue import QueueUnavailableError, cancel_job, enqueue_pdf_job, queue_is_healthy
from job_store import job_store
from models import (
    AuthSessionRequest,
    AuthSessionResponse,
    EmailAuthRequest,
    ErrorResponse,
    GoogleAuthRequest,
    IngestionStatusResponse,
    QueryRequest,
    QueryResponse,
    SessionRequest,
    SessionResponse,
    UploadResponse,
    VitalsRequest,
)
from monitoring import capture_exception
from query import answer_question, warm_models
from security import (
    ADMIN_EMAIL,
    INJECTION_BLOCK_SECONDS,
    QUESTION_LIMIT_PER_USER,
    SecurityHeadersMiddleware,
    WEB_VITALS,
    AntivirusUnavailableError,
    MalwareDetectedError,
    antivirus_scanner,
    audit_logger,
    auth_service,
    get_admin_user,
    get_current_user_id,
    injection_scanner,
    limit_user_concurrency,
    note_request_device,
    pdf_limiter,
    rate_limiter,
    read_pdf_upload,
    sanitize_identifier,
    sanitize_question,
    security_store,
    verify_recaptcha_token,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Fails fast when production starts without encrypted-storage capability."""
    if os.getenv("ENVIRONMENT", "development").lower() == "production" and not encryption_ready():
        raise RuntimeError("DOCUMENT_ENCRYPTION_KEY is required in production")
    # Load the embedding model (and pick a working Groq model) in the background
    # so the first upload and the first question do not pay the cold-start cost.
    threading.Thread(target=warm_models, name="model-warmup", daemon=True).start()
    yield


app = FastAPI(title="RAG Chatbot API", version="1.0.0", lifespan=lifespan)

allowed_origins = [
    "https://docmind.ai",
    "https://www.docmind.ai",
    "https://docmind-ai.vercel.app",
]
production_origin = os.getenv("FRONTEND_URL") or os.getenv("VERCEL_URL")
if production_origin:
    if not production_origin.startswith(("http://", "https://")):
        production_origin = f"https://{production_origin}"
    allowed_origins.append(production_origin)
if os.getenv("ENVIRONMENT", "development").lower() == "development":
    allowed_origins.extend(
        [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ]
    )

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(allowed_origins)),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Session-ID", "X-Recaptcha-Token"],
    expose_headers=[
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-DocMind-Request-ID",
        "X-DocMind-PDF-Remaining",
    ],
    max_age=86400,
)


# Logs each request method, path, and response status code to the console.
@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-DocMind-Request-ID"] = request.headers.get("X-Request-ID") or str(uuid4())
    print(f"{request.method} {request.url.path} {response.status_code}")
    return response


# Converts unhandled server errors into the standard error response model.
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    print(f"{request.method} {request.url.path} 500")
    capture_exception(exc)
    error_response = ErrorResponse(error="Internal server error")
    return JSONResponse(status_code=500, content=error_response.model_dump())


# Converts handled HTTP errors into the standard error response model.
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    error_response = ErrorResponse(error=str(exc.detail))
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response.model_dump(),
        headers=exc.headers,
    )


# Converts request validation errors into the standard error response model.
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    error_response = ErrorResponse(error="Request validation failed")
    return JSONResponse(status_code=422, content=error_response.model_dump())


# Reports basic API health and version information.
@app.get("/health")
async def health() -> dict[str, object]:
    """Reports API liveness plus whether the ingestion queue is reachable."""
    return {
        "success": True,
        "data": {"status": "ok", "version": "1.0.0", "queue_healthy": queue_is_healthy()},
        "error": None,
    }


# One shape for every endpoint that reports PDF slots, so the tiered allowance
# and its explanation cannot drift between upload, list, and delete responses.
def pdf_slot_payload(slot_status: dict[str, Any]) -> dict[str, Any]:
    """Converts a PDFLimiter status into the wire format the frontend reads."""
    return {
        "used": slot_status["current_count"],
        "limit": slot_status["limit"],
        "remaining": slot_status["remaining_slots"],
        "can_upload": slot_status["can_upload"],
        "signed_in": slot_status["signed_in"],
        "signed_in_limit": slot_status["signed_in_limit"],
        "message": slot_status["message"],
    }


# Issues a signed backend session for public users or the configured admin.
@app.post("/auth/session", response_model=AuthSessionResponse)
async def create_auth_session(request: Request, request_body: AuthSessionRequest) -> AuthSessionResponse:
    client_ip = rate_limiter.get_client_ip(request)
    await rate_limiter.check(request, "auth")
    try:
        session = auth_service.create_session(request_body.email, request_body.admin_token)
    except HTTPException:
        if (request_body.email or "").strip().lower() == ADMIN_EMAIL:
            # Time-boxed: a permanent ban here (duration 0 persists to SQLite)
            # would lock the real admin out of their own deployment for good
            # after a single mistyped token.
            await rate_limiter.block_ip(client_ip, INJECTION_BLOCK_SECONDS, "bad_admin_login")
        raise
    audit_logger.log("session_created", session["user_id"], client_ip, {"role": session["role"]})
    note_request_device(request, session["user_id"])
    return AuthSessionResponse(success=True, data=session, error=None)


# Registers a new email/password account and returns a signed session.
@app.post("/auth/signup", response_model=AuthSessionResponse)
async def create_email_account(request: Request, request_body: EmailAuthRequest) -> AuthSessionResponse:
    await rate_limiter.check(request, "auth")
    client_ip = rate_limiter.get_client_ip(request)
    session = auth_service.create_email_account(request_body.email, request_body.password)
    audit_logger.log("account_created", session["user_id"], client_ip, {"role": session["role"]})
    note_request_device(request, session["user_id"])
    return AuthSessionResponse(success=True, data=session, error=None)


# Verifies email/password credentials and returns a signed session.
@app.post("/auth/login", response_model=AuthSessionResponse)
async def login_with_email(request: Request, request_body: EmailAuthRequest) -> AuthSessionResponse:
    await rate_limiter.check(request, "auth")
    client_ip = rate_limiter.get_client_ip(request)
    try:
        session = auth_service.login_with_password(request_body.email, request_body.password)
    except HTTPException:
        audit_logger.log("login_failed", None, client_ip, {"email_supplied": True}, "warning")
        raise
    audit_logger.log("login_succeeded", session["user_id"], client_ip, {"role": session["role"]})
    note_request_device(request, session["user_id"])
    return AuthSessionResponse(success=True, data=session, error=None)


# Exchanges a verified Google ID token for the same signed backend session.
@app.post("/auth/google", response_model=AuthSessionResponse)
async def create_google_auth_session(request: Request, request_body: GoogleAuthRequest) -> AuthSessionResponse:
    await rate_limiter.check(request, "auth")
    client_ip = rate_limiter.get_client_ip(request)
    session = auth_service.create_google_session(request_body.credential)
    audit_logger.log("google_login", session["user_id"], client_ip, {"role": session["role"]})
    note_request_device(request, session["user_id"])
    return AuthSessionResponse(success=True, data=session, error=None)


# Validates, scans, stages, and enqueues a PDF; ingestion itself runs in a worker.
@app.post("/upload", response_model=UploadResponse, status_code=202)
async def upload_pdf(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
) -> UploadResponse:
    user_id = get_current_user_id(request)
    client_ip = rate_limiter.get_client_ip(request)
    limit_status = await rate_limiter.check(request, "upload")
    slot_status = pdf_limiter.can_upload(user_id)
    question_status = pdf_limiter.can_ask(user_id)
    response.headers["X-DocMind-PDF-Remaining"] = str(slot_status["remaining_slots"])
    response.headers.update(
        {
            "X-RateLimit-Limit": str(limit_status["limit"]),
            "X-RateLimit-Remaining": str(limit_status["remaining"]),
            "X-RateLimit-Reset": str(limit_status["reset"]),
        }
    )
    if not slot_status["can_upload"]:
        raise HTTPException(status_code=409, detail=str(slot_status["message"]))
    if not await run_in_threadpool(
        verify_recaptcha_token, request.headers.get("X-Recaptcha-Token"), "upload", client_ip
    ):
        await rate_limiter.block_ip(client_ip, INJECTION_BLOCK_SECONDS, "recaptcha_failed")
        raise HTTPException(status_code=403, detail="Bot verification failed")

    doc_id = str(uuid4())
    job_id = str(uuid4())
    validation = await read_pdf_upload(file)
    safe_filename = str(validation["safe_filename"])
    file_bytes = bytes(validation["content"])
    staging_name: str | None = None

    try:
        try:
            await run_in_threadpool(antivirus_scanner.scan_bytes, file_bytes)
        except MalwareDetectedError:
            audit_logger.log(
                "malware_detected",
                user_id,
                client_ip,
                {"filename": safe_filename, "file_size": validation["file_size"]},
                "critical",
            )
            raise HTTPException(status_code=400, detail="File failed security verification.")
        except AntivirusUnavailableError:
            audit_logger.log(
                "upload_scan_failed",
                user_id,
                client_ip,
                {"filename": safe_filename},
                "high",
            )
            raise HTTPException(status_code=400, detail="File failed security verification.")

        pdf_limiter.reserve_document(
            user_id=user_id,
            doc_id=doc_id,
            filename=safe_filename,
            file_size=int(validation["file_size"]),
            content_hash=str(validation["content_hash"]),
            job_id=job_id,
        )
        try:
            staging_name = await run_in_threadpool(document_store.stage, file_bytes)
        except DocumentStorageError as exc:
            pdf_limiter.mark_failed(doc_id)
            raise HTTPException(status_code=500, detail="Unable to store document") from exc
        try:
            await run_in_threadpool(
                enqueue_pdf_job,
                doc_id,
                user_id,
                staging_name,
                safe_filename,
                job_id,
            )
        except QueueUnavailableError as exc:
            pdf_limiter.mark_failed(doc_id)
            raise HTTPException(
                status_code=503,
                detail="Upload queue is unavailable. Please retry shortly.",
            ) from exc

        audit_logger.log(
            "pdf_upload_queued",
            user_id,
            client_ip,
            {
                "doc_id": doc_id,
                "job_id": job_id,
                "filename": safe_filename,
                "file_size": validation["file_size"],
            },
        )
    finally:
        await file.close()

    slot_status = pdf_limiter.can_upload(user_id)
    response.headers["X-DocMind-PDF-Remaining"] = str(slot_status["remaining_slots"])
    return UploadResponse(
        success=True,
        data={
            "document": {
                "doc_id": doc_id,
                "filename": safe_filename,
                "chunk_count": 0,
                "file_size": validation["file_size"],
                "status": "queued",
                "job_id": job_id,
            },
            "pdf_slots": pdf_slot_payload(slot_status),
        },
        error=None,
        doc_id=doc_id,
        filename=safe_filename,
        chunk_count=0,
        message="PDF upload accepted for processing",
        job_id=job_id,
        status="queued",
        pdf_slots=pdf_slot_payload(slot_status),
        question_slots={
            "used": question_status["used"],
            "limit": QUESTION_LIMIT_PER_USER,
            "remaining": question_status["remaining"],
            "can_ask": question_status["can_ask"],
        },
    )


# Reports durable ingestion progress for one owned document.
@app.get("/documents/{doc_id}/status", response_model=IngestionStatusResponse)
async def document_ingestion_status(doc_id: str, request: Request) -> IngestionStatusResponse:
    user_id = get_current_user_id(request)
    await rate_limiter.check(request, "general")
    clean_doc_id = sanitize_identifier(doc_id, "doc_id")
    pdf_limiter.verify_access(user_id, [clean_doc_id])
    document = pdf_limiter.get_document(user_id, clean_doc_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    job = job_store.get_latest_for_doc(clean_doc_id)
    document_status = str(document.get("ingest_status") or "ready")
    status = "ready" if document_status == "ready" else str((job or {}).get("status") or document_status)
    stage = str((job or {}).get("stage") or status)
    progress_by_stage = {
        "queued": 10,
        "extracting": 30,
        "chunking": 50,
        "embedding": 70,
        "indexing": 90,
        "ready": 100,
        "failed": 100,
        "cancelled": 100,
    }
    return IngestionStatusResponse(
        success=True,
        data={
            "doc_id": clean_doc_id,
            "filename": document.get("filename"),
            "job_id": document.get("job_id"),
            "status": status,
            "stage": stage,
            "progress": progress_by_stage.get(status, 10),
            "chunk_count": int(document.get("chunk_count") or 0),
            "error": (job or {}).get("error") if status == "failed" else None,
        },
        error=None,
    )


# Creates an in-memory session for querying up to five uploaded documents.
@app.post("/session", response_model=SessionResponse)
async def create_document_session(request_body: SessionRequest, request: Request) -> SessionResponse:
    user_id = get_current_user_id(request)
    await rate_limiter.check(request, "general")
    doc_ids = [sanitize_identifier(doc_id, "doc_id") for doc_id in request_body.doc_ids if doc_id.strip()]
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids are required")
    if len(doc_ids) > 5:
        raise HTTPException(status_code=400, detail="A session can include at most 5 documents")
    pdf_limiter.verify_access(user_id, doc_ids)

    session_id = create_session(doc_ids, user_id)
    document_rows = [pdf_limiter.get_document(user_id, doc_id) or {} for doc_id in doc_ids]
    filenames = [str(row.get("filename") or doc_id) for row, doc_id in zip(document_rows, doc_ids)]
    total_chunks = sum(int(row.get("chunk_count") or 0) for row in document_rows)

    return SessionResponse(
        data={
            "session_id": session_id,
            "doc_ids": doc_ids,
            "filenames": filenames,
            "total_chunks": total_chunks,
        },
        error=None,
        session_id=session_id,
        doc_ids=doc_ids,
        filenames=filenames,
        total_chunks=total_chunks,
    )


# Answers a question for an uploaded document using the retrieval pipeline.
@app.post("/query", response_model=QueryResponse)
async def query_document(request_body: QueryRequest, request: Request) -> QueryResponse:
    user_id = get_current_user_id(request)
    client_ip = rate_limiter.get_client_ip(request)
    await rate_limiter.check(request, "chat")
    if not await run_in_threadpool(
        verify_recaptcha_token, request.headers.get("X-Recaptcha-Token"), "query", client_ip
    ):
        audit_logger.log("recaptcha_failed", user_id, client_ip, {"action": "query"}, "warning")
        raise HTTPException(status_code=403, detail="Bot verification failed")
    question_status = pdf_limiter.can_ask(user_id)
    if not question_status["can_ask"]:
        audit_logger.log("question_limit_reached", user_id, client_ip, {"limit": QUESTION_LIMIT_PER_USER}, "warning")
        raise HTTPException(status_code=429, detail="Question limit reached")
    question = sanitize_question(request_body.question)
    scan_result = injection_scanner.scan(question)
    if not scan_result["safe"]:
        action = scan_result["action"]
        audit_logger.log(
            "injection_detected",
            user_id,
            client_ip,
            {
                "score": scan_result["score"],
                "patterns": scan_result["triggered_patterns"],
                "action": action,
            },
            "high",
        )
        # Escalate in proportion to the score instead of applying the maximum
        # penalty to every hit. A borderline match is refused and logged; only a
        # sustained, multi-signal attack costs the caller their account. The ban
        # is time-boxed because a permanent one (duration <= 0) is written to
        # SQLite and would outlive a restart -- on a shared or NAT'd IP that
        # locks out every innocent user behind it, with no way back.
        if action == "block_and_ban":
            security_store.block_user(user_id, "prompt_injection")
            await rate_limiter.block_ip(client_ip, INJECTION_BLOCK_SECONDS, "injection_attempt")
        raise HTTPException(status_code=400, detail="Request could not be processed")

    doc_ids = [sanitize_identifier(doc_id, "doc_id") for doc_id in request_body.doc_ids if doc_id.strip()]
    if request_body.doc_id and request_body.doc_id.strip():
        doc_ids.append(sanitize_identifier(request_body.doc_id, "doc_id"))
    if request_body.session_id:
        session_id = sanitize_identifier(request_body.session_id, "session_id")
        doc_ids.extend(session_store.get(session_id))

    doc_ids = list(dict.fromkeys(doc_ids))
    if not question or not doc_ids:
        raise HTTPException(status_code=400, detail="question and doc_ids are required")
    pdf_limiter.verify_access(user_id, doc_ids)
    for doc_id in doc_ids:
        document = pdf_limiter.get_document(user_id, doc_id)
        if document and document.get("ingest_status") != "ready":
            raise HTTPException(status_code=409, detail="Document is still processing")

    async for _ in limit_user_concurrency(user_id):
        result = await run_in_threadpool(answer_question, question, doc_ids, request_body.history)
    pdf_limiter.mark_question(user_id, doc_ids)
    audit_logger.log("question_asked", user_id, client_ip, {"doc_ids": doc_ids, "message_length": len(question)})
    result["session_id"] = request_body.session_id
    result["error"] = None
    result["data"] = {
        "answer": result.get("answer"),
        "sources": result.get("sources", []),
        "doc_id": result.get("doc_id"),
        "doc_ids": result.get("doc_ids", []),
        "session_id": request_body.session_id,
        "confidence": result.get("confidence"),
            "confidence_score": result.get("confidence_score"),
            "answer_source": result.get("answer_source"),
            "question_slots": pdf_limiter.can_ask(user_id),
        }
    return QueryResponse(**result)


# Lists PDF slot usage and documents for the current user.
@app.get("/documents")
async def list_documents(request: Request) -> dict[str, object]:
    user_id = get_current_user_id(request)
    slot_status = pdf_limiter.can_upload(user_id)
    question_status = pdf_limiter.can_ask(user_id)
    return {
        "success": True,
        "data": {
            "documents": pdf_limiter.list_pdfs(user_id),
            "pdf_slots": pdf_slot_payload(slot_status),
            "question_slots": question_status,
        },
        "error": None,
    }


# Deletes a document namespace and frees one PDF slot for the current user.
@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, request: Request) -> dict[str, object]:
    user_id = get_current_user_id(request)
    client_ip = rate_limiter.get_client_ip(request)
    clean_doc_id = sanitize_identifier(doc_id, "doc_id")
    await rate_limiter.check(request, "general")
    pdf_limiter.verify_access(user_id, [clean_doc_id])
    document = pdf_limiter.delete_pdf(user_id, clean_doc_id)
    job = job_store.get_latest_for_doc(clean_doc_id)
    if job:
        await run_in_threadpool(cancel_job, str(job["job_id"]))
    await run_in_threadpool(delete_doc, clean_doc_id)
    DOC_METADATA.pop(clean_doc_id, None)
    session_store.remove_doc(clean_doc_id)
    slot_status = pdf_limiter.can_upload(user_id)
    audit_logger.log(
        "pdf_deleted",
        user_id,
        client_ip,
        {"doc_id": clean_doc_id, "filename": document.get("filename")},
    )
    return {
        "success": True,
        "data": {
            "deleted_doc_id": clean_doc_id,
            "pdf_slots": pdf_slot_payload(slot_status),
        },
        "error": None,
    }


# Records browser Core Web Vitals samples for operational monitoring.
@app.post("/vitals")
async def record_vital(request: Request, vital: VitalsRequest) -> dict[str, object]:
    get_current_user_id(request)
    await rate_limiter.check(request, "vitals")
    record = vital.model_dump()
    record["created_at"] = int(time.time())
    WEB_VITALS.append(record)
    security_store.log_vital(record)
    return {"success": True, "data": {"received": True}, "error": None}


# Returns admin-only platform usage, audit, document, and vitals analytics.
@app.get("/admin/metrics")
async def admin_metrics(request: Request) -> dict[str, object]:
    admin_user = get_admin_user(request)
    client_ip = rate_limiter.get_client_ip(request)
    await rate_limiter.check(request, "general")
    audit_logger.log("admin_metrics_viewed", admin_user["sub"], client_ip, {})
    return {"success": True, "data": security_store.admin_snapshot(), "error": None}
