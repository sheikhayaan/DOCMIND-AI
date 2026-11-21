"""Queue integration for PDF ingestion.

Production uses Celery backed by Redis so uploads return in milliseconds and any
number of workers can process PDFs independently. Development falls back to a
daemon thread when QUEUE_BACKEND=inline, which keeps local setup dependency-free
while still returning HTTP 202 with a pollable job id.
"""

import os
import threading
import uuid
from typing import Any

from job_store import job_store
from monitoring import capture_exception
from storage import document_store
from apm.common import setting
from apm.incidents import incident_tracker

_inline_jobs: dict[str, threading.Thread] = {}
_inline_lock = threading.Lock()


def drain_completed_jobs() -> int:
    """Releases finished inline task handles without cancelling queued or active work."""
    with _inline_lock:
        finished = [key for key, thread in _inline_jobs.items() if not thread.is_alive()]
        for key in finished:
            del _inline_jobs[key]
        return len(finished)


class QueueUnavailableError(RuntimeError):
    """Raised when the ingestion queue cannot accept a job."""


def queue_backend() -> str:
    """Returns the configured queue backend (celery or inline)."""
    return os.getenv("QUEUE_BACKEND", "inline").strip().lower()


def _redis_connection() -> Any:
    """Creates a short-timeout Redis client for health checks."""
    import redis

    url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    return redis.Redis.from_url(url, socket_timeout=3, socket_connect_timeout=3)


def _celery_app() -> Any:
    """Returns the configured Celery application for task dispatch."""
    from celery_app import celery_app

    return celery_app


def enqueue_pdf_job(
    doc_id: str,
    user_id: str,
    staging_name: str,
    filename: str,
    job_id: str | None = None,
) -> str:
    """Creates a durable job row and enqueues the worker task, returning its id."""
    identifier = job_id or str(uuid.uuid4())
    job_store.create_job(identifier, doc_id, user_id, staging_name)
    try:
        if queue_backend() == "celery":
            _celery_app().send_task(
                "tasks.process_pdf_job",
                args=(identifier, doc_id, staging_name, user_id, filename),
                task_id=identifier,
                queue=os.getenv("INGESTION_QUEUE_NAME", "docmind"),
                expires=int(os.getenv("INGESTION_JOB_TIMEOUT_SECONDS", "900")),
            )
        else:
            from tasks import process_pdf_job

            drain_completed_jobs()
            with _inline_lock:
                limit = int(setting("INGESTION_INLINE_MAX_WORKERS", 16, 1, 64))
                if len(_inline_jobs) >= limit:
                    raise QueueUnavailableError("Inline ingestion capacity reached")
                thread = threading.Thread(
                    target=process_pdf_job,
                    args=(identifier, doc_id, staging_name, user_id, filename),
                    name=f"ingest-{identifier[:8]}",
                    daemon=True,
                )
                _inline_jobs[identifier] = thread
                try:
                    thread.start()
                except Exception:
                    _inline_jobs.pop(identifier, None)
                    raise
    except Exception as exc:
        incident_tracker.record("QUEUE_UNAVAILABLE", "high", "/upload", "Ingestion queue could not accept work; active and durable tasks were not discarded.", 503)
        capture_exception(exc)
        job_store.set_failed(identifier, "Ingestion queue unavailable.")
        document_store.purge(staging_name)
        raise QueueUnavailableError("Ingestion queue unavailable") from exc
    return identifier


def cancel_job(job_id: str) -> None:
    """Cancels a queued/dependent job when its document is deleted."""
    job = job_store.get_job(job_id)
    if not job:
        return
    if queue_backend() == "celery" and job.get("status") == "queued":
        try:
            _celery_app().control.revoke(job_id, terminate=False)
        except Exception as exc:
            capture_exception(exc)
    document_store.purge(job.get("staging_name"))
    job_store.set_cancelled(job_id)


def queue_is_healthy() -> bool:
    """Reports whether the configured queue backend is reachable."""
    if queue_backend() != "celery":
        return True
    try:
        with _redis_connection() as connection:
            connection.ping()
        return True
    except Exception:
        return False
