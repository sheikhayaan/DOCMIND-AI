"""Durable ingestion job tracking shared by the API and Celery workers.

Redis tracks the queue itself, but a small SQLite table is the source of truth
for the user-facing status endpoint: it survives restarts, is readable from any
worker process, and records the exact pipeline stage the UI can display.
"""

import os
import sqlite3
import time
from pathlib import Path
from threading import Lock
from typing import Any

TERMINAL_STATES = {"ready", "failed", "cancelled"}
STAGES = ("queued", "extracting", "chunking", "embedding", "indexing", "ready")


class IngestionJobStore:
    """Stores one row per ingestion job with an atomic stage transition."""

    def __init__(self, db_path: Path | None = None) -> None:
        data_dir = Path(os.getenv("DOCMIND_DATA_DIR", str(Path(__file__).resolve().parent / ".data")))
        self.db_path = db_path or Path(os.getenv("JOBS_DB_PATH", str(data_dir / "jobs.sqlite3")))
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        """Opens a WAL-mode SQLite connection with a busy timeout for workers."""
        conn = sqlite3.connect(self.db_path, timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self) -> None:
        """Creates the jobs table and its lookup indexes."""
        with self.lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS ingestion_jobs (
                    job_id TEXT PRIMARY KEY,
                    doc_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT NOT NULL DEFAULT 'queued',
                    error TEXT,
                    staging_name TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_jobs_doc_updated
                ON ingestion_jobs(doc_id, updated_at DESC);
                """
            )

    def create_job(self, job_id: str, doc_id: str, user_id: str, staging_name: str) -> None:
        """Creates a queued job before the task is handed to Redis."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO ingestion_jobs
                (job_id, doc_id, user_id, status, stage, staging_name, attempts, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', 'queued', ?, 0, ?, ?)
                """,
                (job_id, doc_id, user_id, staging_name, now, now),
            )

    def set_stage(self, job_id: str, stage: str) -> None:
        """Advances a job to a non-terminal pipeline stage."""
        if stage not in STAGES or stage in TERMINAL_STATES:
            return
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE ingestion_jobs
                SET status = ?, stage = ?, attempts = attempts + 1, updated_at = ?
                WHERE job_id = ? AND status NOT IN ('ready', 'failed', 'cancelled')
                """,
                (stage, stage, now, job_id),
            )

    def set_ready(self, job_id: str) -> None:
        """Marks a job complete after vectors and the document row are durable."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'ready', stage = 'ready', error = NULL, updated_at = ?
                WHERE job_id = ?
                """,
                (now, job_id),
            )

    def set_failed(self, job_id: str, error: str) -> None:
        """Marks a job failed with a short, non-sensitive error message."""
        now = int(time.time())
        safe_error = " ".join((error or "Ingestion failed").split())[:300]
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'failed', error = ?, updated_at = ?
                WHERE job_id = ? AND status != 'ready'
                """,
                (safe_error, now, job_id),
            )

    def reset_for_retry(self, job_id: str) -> None:
        """Returns a failed job to queued before a Celery backoff retry."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'queued', stage = 'queued', error = NULL, updated_at = ?
                WHERE job_id = ? AND status = 'failed'
                """,
                (now, job_id),
            )

    def set_cancelled(self, job_id: str) -> None:
        """Marks a job cancelled after its document was deleted."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE ingestion_jobs SET status = 'cancelled', updated_at = ? WHERE job_id = ?",
                (now, job_id),
            )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Returns one job row by id."""
        with self.lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM ingestion_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return dict(row) if row else None

    def get_latest_for_doc(self, doc_id: str) -> dict[str, Any] | None:
        """Returns the newest job for a document."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM ingestion_jobs WHERE doc_id = ? ORDER BY updated_at DESC LIMIT 1",
                (doc_id,),
            ).fetchone()
            return dict(row) if row else None


job_store = IngestionJobStore()
