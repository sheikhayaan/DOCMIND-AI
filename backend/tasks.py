"""Background ingestion task executed by a Celery worker or the inline dev runner.

The API only validates, malware-scans, and stages an upload. Everything that can
take longer than ~200 ms happens here: sanitization, extraction, chunking,
embedding, and vector indexing. Each transition is written to SQLite so
GET /documents/{doc_id}/status can report it from any process.
"""

from pathlib import Path

from celery.signals import worker_process_init

from celery_app import celery_app
from ingest import delete_doc, ingest_pdf
from job_store import job_store
from monitoring import capture_exception, capture_job_failure, capture_security_event
from pdf_sanitizer import PDFSanitizationError, sanitize_pdf
from query import warm_models
from security import antivirus_scanner, audit_logger, pdf_limiter, security_store
from security import AntivirusUnavailableError, MalwareDetectedError
from storage import document_store


def _advance(job_id: str, doc_id: str, stage: str) -> None:
    """Writes one pipeline stage to the job table and the document row."""
    job_store.set_stage(job_id, stage)
    pdf_limiter.update_ingest_status(doc_id, stage)


def _fail(job_id: str, doc_id: str, message: str, stage: str) -> None:
    """Marks a job and its document failed, releasing the upload slot."""
    job_store.set_failed(job_id, message)
    if security_store.document_is_active(doc_id):
        pdf_limiter.mark_failed(doc_id)
    capture_job_failure(job_id, stage)


def process_pdf_job(
    job_id: str,
    doc_id: str,
    staging_name: str,
    user_id: str,
    filename: str,
) -> None:
    """Sanitizes, scans, and fully indexes one encrypted PDF upload."""
    current_stage = "queued"
    temp_path: Path | None = None
    try:
        if not security_store.document_is_active(doc_id):
            job_store.set_cancelled(job_id)
            document_store.purge(staging_name)
            return

        current_stage = "extracting"
        _advance(job_id, doc_id, current_stage)
        temp_path = document_store.decrypt_to_temp(staging_name)
        sanitized = sanitize_pdf(temp_path.read_bytes())
        # Scan again after sanitization: the API already scanned the original,
        # and this catches anything introduced or exposed by rebuilding the PDF.
        antivirus_scanner.scan_bytes(sanitized)
        temp_path.write_bytes(sanitized)

        def on_stage(stage: str) -> None:
            """Forwards ingest stage changes to the durable status record."""
            nonlocal current_stage
            current_stage = stage
            _advance(job_id, doc_id, stage)

        chunk_count = ingest_pdf(
            str(temp_path),
            doc_id,
            on_stage=on_stage,
            cache_locally=False,
            filename=filename,
        )

        if not security_store.document_is_active(doc_id):
            delete_doc(doc_id)
            job_store.set_cancelled(job_id)
            return

        pdf_limiter.mark_ready(doc_id, chunk_count)
        job_store.set_ready(job_id)
        audit_logger.log(
            "pdf_ready",
            user_id,
            "worker",
            {"doc_id": doc_id, "job_id": job_id, "chunk_count": chunk_count},
        )
    except MalwareDetectedError:
        audit_logger.log(
            "malware_detected",
            user_id,
            "worker",
            {"doc_id": doc_id, "job_id": job_id, "stage": current_stage},
            "critical",
        )
        capture_security_event("malware_detected", "critical")
        _fail(job_id, doc_id, "File failed security verification.", current_stage)
    except (PDFSanitizationError, AntivirusUnavailableError):
        _fail(job_id, doc_id, "File failed security verification.", current_stage)
    except Exception as exc:
        capture_exception(exc)
        _fail(job_id, doc_id, "Document processing failed.", current_stage)
    finally:
        document_store.purge_temp(temp_path)
        document_store.purge(staging_name)


def process_pdf_job_inline(
    job_id: str,
    doc_id: str,
    staging_name: str,
    user_id: str,
    filename: str,
) -> None:
    """Runs the task in the API process when Redis is intentionally absent."""
    process_pdf_job(job_id, doc_id, staging_name, user_id, filename)


@celery_app.task(bind=True, name="tasks.process_pdf_job", max_retries=3, acks_late=True)
def process_pdf_job_task(
    self,
    job_id: str,
    doc_id: str,
    staging_name: str,
    user_id: str,
    filename: str,
) -> None:
    """Runs one ingestion task, retrying unexpected failures with backoff."""
    try:
        process_pdf_job(job_id, doc_id, staging_name, user_id, filename)
    except Exception as exc:
        capture_exception(exc)
        if self.request.retries >= self.max_retries:
            raise
        job_store.reset_for_retry(job_id)
        pdf_limiter.update_ingest_status(doc_id, "queued")
        raise self.retry(exc=exc, countdown=min(60, 2 ** self.request.retries))


@worker_process_init.connect
def warm_worker_models(**_kwargs) -> None:
    """Preloads the embedding model in each worker process before the first job."""
    warm_models()
