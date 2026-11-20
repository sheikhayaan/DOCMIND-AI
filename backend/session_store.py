"""Durable query-session storage so multi-worker deployments agree on doc sets.

A session is only a short-lived mapping from an opaque id to the documents the
user explicitly selected. Persisting it in SQLite removes the last piece of
per-process query state that broke under Gunicorn/Celery workers.
"""

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from threading import Lock
from contextlib import AbstractContextManager

from fastapi import HTTPException
from apm.database import get_pool


class SessionStore:
    """Persists multi-document query sessions across API processes."""

    def __init__(self, db_path: Path | None = None) -> None:
        data_dir = Path(os.getenv("DOCMIND_DATA_DIR", str(Path(__file__).resolve().parent / ".data")))
        self.db_path = db_path or Path(os.getenv("SESSIONS_DB_PATH", str(data_dir / "sessions.sqlite3")))
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()
        self._init_db()

    def _connect(self) -> AbstractContextManager[sqlite3.Connection]:
        """Leases an instrumented WAL connection and returns it after use."""
        return get_pool(self.db_path, "sessions").connection(rows=False)

    def _init_db(self) -> None:
        """Creates the sessions table used by every API worker."""
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS query_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    doc_ids TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """
            )

    def create(self, doc_ids: list[str], user_id: str = "") -> str:
        """Stores a new session and returns its opaque id."""
        session_id = str(uuid.uuid4())
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute("DELETE FROM query_sessions WHERE created_at < ?", (now - 7 * 86400,))
            conn.execute(
                "INSERT INTO query_sessions (session_id, user_id, doc_ids, created_at) VALUES (?, ?, ?, ?)",
                (session_id, user_id, json.dumps(doc_ids), now),
            )
        return session_id

    def get(self, session_id: str, user_id: str | None = None) -> list[str]:
        """Returns live documents and enforces session ownership when a caller is supplied."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                "SELECT doc_ids, user_id, created_at FROM query_sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if not row or (user_id is not None and (row[1] != user_id or row[2] < time.time() - 7 * 86400)):
            if user_id is not None:
                raise HTTPException(status_code=404, detail="Session not found")
            return []
        try:
            value = json.loads(row[0])
        except (TypeError, ValueError):
            return []
        return [str(item) for item in value] if isinstance(value, list) else []

    def remove_doc(self, doc_id: str) -> None:
        """Removes a deleted document from every stored session."""
        with self.lock, self._connect() as conn:
            rows = conn.execute("SELECT session_id, doc_ids FROM query_sessions").fetchall()
            for session_id, doc_ids in rows:
                try:
                    current = json.loads(doc_ids)
                except (TypeError, ValueError):
                    continue
                if not isinstance(current, list) or doc_id not in current:
                    continue
                remaining = [item for item in current if item != doc_id]
                if remaining:
                    conn.execute(
                        "UPDATE query_sessions SET doc_ids = ? WHERE session_id = ?",
                        (json.dumps(remaining), session_id),
                    )
                else:
                    conn.execute("DELETE FROM query_sessions WHERE session_id = ?", (session_id,))


session_store = SessionStore()
