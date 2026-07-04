from dotenv import load_dotenv

load_dotenv()

import os
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ingest import DOC_METADATA, SESSIONS, create_session, ingest_pdf
from models import (
    ErrorResponse,
    QueryRequest,
    QueryResponse,
    SessionRequest,
    SessionResponse,
    UploadResponse,
)
from query import answer_question


app = FastAPI(title="RAG Chatbot API", version="1.0.0")

production_origin = os.getenv("FRONTEND_URL") or os.getenv("VERCEL_URL")
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://ayaandevloper408-docmind-ai-backend.hf.space",
]
if production_origin:
    if not production_origin.startswith(("http://", "https://")):
        production_origin = f"https://{production_origin}"
    allowed_origins.append(production_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Logs each request method, path, and response status code to the console.
@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    print(f"{request.method} {request.url.path} {response.status_code}")
    return response


# Converts unhandled server errors into the standard error response model.
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    print(f"{request.method} {request.url.path} 500")
    error_response = ErrorResponse(error=str(exc))
    return JSONResponse(status_code=500, content=error_response.model_dump())


# Converts handled HTTP errors into the standard error response model.
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    error_response = ErrorResponse(error=str(exc.detail))
    return JSONResponse(status_code=exc.status_code, content=error_response.model_dump())


# Reports basic API health and version information.
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "1.0.0"}


# Uploads a PDF, stores its chunks in Pinecone, and returns document metadata.
@app.post("/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)) -> UploadResponse:
    filename = file.filename or ""
    if file.content_type != "application/pdf" and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    doc_id = str(uuid4())
    temp_dir = Path(tempfile.gettempdir())
    temp_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = Path(filename).name or f"{doc_id}.pdf"
    file_path = temp_dir / f"{doc_id}-{safe_filename}"

    try:
        file_bytes = await file.read()
        file_path.write_bytes(file_bytes)
        chunk_count = await run_in_threadpool(ingest_pdf, str(file_path), doc_id)
        DOC_METADATA[doc_id]["filename"] = filename
    finally:
        if file_path.exists():
            file_path.unlink()
        await file.close()

    return UploadResponse(
        success=True,
        doc_id=doc_id,
        filename=filename,
        chunk_count=chunk_count,
        message="PDF uploaded and ingested successfully",
    )


# Creates an in-memory session for querying up to five uploaded documents.
@app.post("/session", response_model=SessionResponse)
async def create_document_session(request: SessionRequest) -> SessionResponse:
    doc_ids = [doc_id.strip() for doc_id in request.doc_ids if doc_id.strip()]
    if not doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids are required")
    if len(doc_ids) > 5:
        raise HTTPException(status_code=400, detail="A session can include at most 5 documents")

    session_id = create_session(doc_ids)
    filenames = [
        DOC_METADATA.get(doc_id, {}).get("filename", doc_id)
        for doc_id in doc_ids
    ]
    total_chunks = sum(
        int(DOC_METADATA.get(doc_id, {}).get("chunk_count", 0))
        for doc_id in doc_ids
    )

    return SessionResponse(
        session_id=session_id,
        doc_ids=doc_ids,
        filenames=filenames,
        total_chunks=total_chunks,
    )


# Answers a question for an uploaded document using the retrieval pipeline.
@app.post("/query", response_model=QueryResponse)
async def query_document(request: QueryRequest) -> QueryResponse:
    question = request.question.strip()
    doc_ids = [doc_id.strip() for doc_id in request.doc_ids if doc_id.strip()]
    if request.doc_id and request.doc_id.strip():
        doc_ids.append(request.doc_id.strip())
    if request.session_id:
        doc_ids.extend(SESSIONS.get(request.session_id, []))

    doc_ids = list(dict.fromkeys(doc_ids))
    if not question or not doc_ids:
        raise HTTPException(status_code=400, detail="question and doc_ids are required")

    result = await run_in_threadpool(answer_question, question, doc_ids, request.history)
    result["session_id"] = request.session_id
    return QueryResponse(**result)
