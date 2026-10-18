import asyncio
import base64
import hashlib
import ipaddress
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import struct
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any, AsyncGenerator

from fastapi import HTTPException, Request, UploadFile
from starlette.middleware.base import BaseHTTPMiddleware

from monitoring import capture_security_event


# PDF allowance is tiered: browsing anonymously is enough to try the product,
# and attaching a verified email doubles it. The allowance is read from the
# stored user row rather than the request, so every call site agrees on one
# number without threading the caller's identity through the limiter.
PDF_LIMIT_GUEST = 2
PDF_LIMIT_SIGNED_IN = 4
# Retained as the guest floor so anything reading this constant (audit script,
# docs, tests) still sees the allowance that applies without an account.
PDF_LIMIT_PER_USER = PDF_LIMIT_GUEST
QUESTION_LIMIT_PER_USER = 0  # 0 = unlimited questions per user
# How long a confirmed prompt-injection attempt costs the caller. Deliberately
# finite: block_ip() persists any duration <= 0 to SQLite, so a permanent ban
# would survive restarts and take out everyone sharing the attacker's NAT.
INJECTION_BLOCK_SECONDS = 3600
MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024
MAX_CHAT_CHARS = 4000
# ClamAV scanning is mandatory in production. Development can explicitly opt out
# with CLAMAV_REQUIRED=false, but the default remains fail-closed.
CLAMAV_HOST = os.getenv("CLAMAV_HOST", "").strip()
CLAMAV_PORT = int(os.getenv("CLAMAV_PORT", "3310"))
CLAMAV_TIMEOUT_SECONDS = float(os.getenv("CLAMAV_TIMEOUT_SECONDS", "15"))
CLAMAV_REQUIRED = os.getenv("CLAMAV_REQUIRED", "true").strip().lower() not in {"0", "false", "no"}
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "").strip()
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
# Email/password accounts. scrypt at n=2^14 costs ~16MB and ~50ms per hash, which
# is slow enough to make offline cracking expensive without stalling a login.
PASSWORD_MIN_LENGTH = 8
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")
ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
PDF_MAGIC = b"%PDF-"
DATA_DIR = Path(os.getenv("DOCMIND_DATA_DIR", str(Path(__file__).resolve().parent / ".data")))
SECURITY_DB_PATH = Path(os.getenv("SECURITY_DB_PATH", str(DATA_DIR / "security.sqlite3")))
RAW_AUTH_SECRET = os.getenv("AUTH_SECRET") or os.getenv("JWT_SECRET")
if os.getenv("ENVIRONMENT", "development").lower() == "production" and not RAW_AUTH_SECRET:
    raise RuntimeError("AUTH_SECRET is required in production")
AUTH_SECRET = RAW_AUTH_SECRET or secrets.token_urlsafe(48)
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ADMIN_ACCESS_TOKEN = os.getenv("ADMIN_ACCESS_TOKEN", "")
if os.getenv("ENVIRONMENT", "development").lower() == "production" and not ADMIN_ACCESS_TOKEN:
    raise RuntimeError("ADMIN_ACCESS_TOKEN is required in production")
# Optional Google Sign-In. When unset, /auth/google returns 503 and the frontend
# button stays hidden — anonymous sessions keep working unchanged.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
SECURITY_EVENTS: deque[dict[str, Any]] = deque(maxlen=1000)
WEB_VITALS: deque[dict[str, Any]] = deque(maxlen=5000)


def get_request_ip(request: Request) -> str:
    """Returns the client IP, trusting only the configured number of proxy hops."""
    try:
        hops = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "0")))
    except ValueError:
        hops = 0
    if hops:
        forwarded = request.headers.get("X-Forwarded-For", "")
        candidates: list[str] = []
        for raw in forwarded.split(","):
            try:
                candidates.append(str(ipaddress.ip_address(raw.strip())))
            except ValueError:
                continue
        # Count from the right: the nearest proxy is the only hop an attacker
        # cannot forge. A client-supplied prefix on the left is ignored.
        if len(candidates) >= hops:
            return candidates[-hops]
    return request.client.host if request.client else "unknown"


# Device rows are written on the request path, so the same visitor is only
# persisted once per window instead of on every call. Bounded so a flood of
# distinct addresses cannot grow it without limit.
DEVICE_NOTE_WINDOW_SECONDS = 120
DEVICE_NOTE_CACHE_LIMIT = 5000
_device_notes: dict[str, float] = {}


def note_request_device(request: Request, user_id: str) -> None:
    """Records the address and browser behind a request, at most once per window.

    A browser cannot report its MAC address to a server, so this stores the
    client IP and user agent -- the identifying pair a deployment actually has.
    """
    if not user_id:
        return
    ip_address = get_request_ip(request)
    user_agent = (request.headers.get("User-Agent") or "")[:250]
    key = f"{user_id}|{ip_address}|{user_agent}"
    now = time.time()
    if now - _device_notes.get(key, 0.0) < DEVICE_NOTE_WINDOW_SECONDS:
        return
    if len(_device_notes) > DEVICE_NOTE_CACHE_LIMIT:
        _device_notes.clear()
    _device_notes[key] = now
    try:
        security_store.record_device(user_id, ip_address, user_agent)
    except sqlite3.Error:
        # Telemetry must never break the request it is describing.
        pass


class SecurityStore:
    """Persists users, document ownership, usage, audit logs, and blocks."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.lock = Lock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        """Opens a SQLite connection configured for row dictionaries."""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Creates required security tables and indexes."""
        with self.lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    email TEXT,
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL,
                    question_count INTEGER NOT NULL DEFAULT 0,
                    is_blocked INTEGER NOT NULL DEFAULT 0,
                    block_reason TEXT,
                    password_hash TEXT
                );

                CREATE TABLE IF NOT EXISTS documents (
                    doc_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    chunk_count INTEGER NOT NULL,
                    content_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_accessed_at INTEGER,
                    question_count INTEGER NOT NULL DEFAULT 0,
                    is_deleted INTEGER NOT NULL DEFAULT 0,
                    ingest_status TEXT NOT NULL DEFAULT 'ready',
                    job_id TEXT
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    user_id TEXT,
                    ip_address TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    details TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS web_vitals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    metric_name TEXT NOT NULL,
                    metric_value REAL NOT NULL,
                    rating TEXT NOT NULL,
                    page TEXT NOT NULL,
                    device TEXT NOT NULL,
                    connection_type TEXT,
                    created_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS blocked_ips (
                    ip_address TEXT PRIMARY KEY,
                    reason TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                -- One row per (identity, network address, browser). A visitor's
                -- MAC address is not available to a web server -- it is link-layer
                -- data that never leaves their local network -- so the IP plus the
                -- user agent is the closest identifier a deployment can record.
                CREATE TABLE IF NOT EXISTS user_devices (
                    user_id TEXT NOT NULL,
                    ip_address TEXT NOT NULL,
                    user_agent TEXT NOT NULL DEFAULT '',
                    first_seen_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL,
                    hits INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (user_id, ip_address, user_agent)
                );

                CREATE INDEX IF NOT EXISTS idx_documents_user_active
                ON documents(user_id, is_deleted, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_created
                ON audit_events(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_vitals_metric_created
                ON web_vitals(metric_name, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_user_devices_seen
                ON user_devices(last_seen_at DESC);
                """
            )
            # CREATE TABLE IF NOT EXISTS is a no-op on a database that predates
            # password accounts, so add the column separately for existing files.
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
            if "password_hash" not in columns:
                conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
            document_columns = {row["name"] for row in conn.execute("PRAGMA table_info(documents)")}
            if "ingest_status" not in document_columns:
                conn.execute("ALTER TABLE documents ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'ready'")
            if "job_id" not in document_columns:
                conn.execute("ALTER TABLE documents ADD COLUMN job_id TEXT")
            try:
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email "
                    "ON users(email) WHERE email IS NOT NULL"
                )
            except sqlite3.IntegrityError:
                # A legacy database with duplicate emails must not block startup.
                # user_id is derived from the email, so duplicates are not expected.
                print("Warning: users.email has duplicates; unique index skipped")

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        """Returns a user row by email, or None when no account exists."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
            ).fetchone()
        return dict(row) if row else None

    def set_password_hash(self, user_id: str, password_hash: str) -> None:
        """Stores a password hash for an existing user record."""
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE user_id = ?",
                (password_hash, user_id),
            )

    def clear_password_hash(self, user_id: str) -> None:
        """Removes a password login after a stronger identity proof supersedes it."""
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = NULL WHERE user_id = ?", (user_id,)
            )

    def upsert_user(self, user_id: str, email: str | None, role: str) -> None:
        """Creates or refreshes a user record."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO users (user_id, email, role, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = COALESCE(excluded.email, users.email),
                    role = excluded.role,
                    last_seen_at = excluded.last_seen_at
                """,
                (user_id, email, role, now, now),
            )

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        """Returns one user record by id."""
        with self.lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def block_user(self, user_id: str, reason: str) -> None:
        """Permanently blocks a user id."""
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE users SET is_blocked = 1, block_reason = ? WHERE user_id = ?",
                (reason, user_id),
            )

    def record_device(self, user_id: str, ip_address: str, user_agent: str) -> None:
        """Records that an identity was seen from one address and browser."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_devices
                (user_id, ip_address, user_agent, first_seen_at, last_seen_at, hits)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id, ip_address, user_agent) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at,
                    hits = user_devices.hits + 1
                """,
                (user_id, ip_address, user_agent[:250], now, now),
            )

    def block_ip(self, ip_address: str, reason: str) -> None:
        """Permanently blocks an IP address."""
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO blocked_ips (ip_address, reason, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(ip_address) DO UPDATE SET reason = excluded.reason
                """,
                (ip_address, reason, int(time.time())),
            )

    def is_ip_blocked(self, ip_address: str) -> bool:
        """Returns whether an IP address is permanently blocked."""
        with self.lock, self._connect() as conn:
            row = conn.execute("SELECT 1 FROM blocked_ips WHERE ip_address = ?", (ip_address,)).fetchone()
            return bool(row)

    def add_document(self, document: dict[str, Any]) -> None:
        """Persists a document ownership record."""
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO documents
                (doc_id, user_id, filename, file_size, chunk_count, content_hash, created_at, ingest_status, job_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document["doc_id"],
                    document["user_id"],
                    document["filename"],
                    document["file_size"],
                    document.get("chunk_count", 0),
                    document["content_hash"],
                    document["created_at"],
                    document.get("ingest_status", "ready"),
                    document.get("job_id"),
                ),
            )

    def reserve_document(self, document: dict[str, Any], limit: int) -> None:
        """Atomically checks the slot cap and duplicate hash before inserting a queued row."""
        with self.lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                slot = conn.execute(
                    """
                    SELECT COUNT(*) AS count FROM documents
                    WHERE user_id = ? AND is_deleted = 0 AND ingest_status != 'failed'
                    """,
                    (document["user_id"],),
                ).fetchone()
                if int(slot["count"]) >= limit:
                    raise HTTPException(status_code=409, detail="PDF slot limit reached")
                duplicate = conn.execute(
                    """
                    SELECT 1 FROM documents
                    WHERE user_id = ? AND content_hash = ? AND is_deleted = 0 AND ingest_status != 'failed'
                    """,
                    (document["user_id"], document["content_hash"]),
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=409, detail="This PDF has already been uploaded")
                conn.execute(
                    """
                    INSERT INTO documents
                    (doc_id, user_id, filename, file_size, chunk_count, content_hash, created_at, ingest_status, job_id)
                    VALUES (?, ?, ?, ?, 0, ?, ?, 'queued', ?)
                    """,
                    (
                        document["doc_id"],
                        document["user_id"],
                        document["filename"],
                        document["file_size"],
                        document["content_hash"],
                        document["created_at"],
                        document.get("job_id"),
                    ),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def mark_document_ready(self, doc_id: str, chunk_count: int) -> None:
        """Marks a queued document as fully indexed and records its chunk count."""
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE documents SET ingest_status = 'ready', chunk_count = ? WHERE doc_id = ?",
                (chunk_count, doc_id),
            )

    def mark_document_failed(self, doc_id: str) -> None:
        """Marks a document failed so it does not consume one of the user's slots."""
        with self.lock, self._connect() as conn:
            conn.execute("UPDATE documents SET ingest_status = 'failed' WHERE doc_id = ?", (doc_id,))

    def update_document_status(self, doc_id: str, status: str) -> None:
        """Writes the current ingestion stage to the durable document row."""
        with self.lock, self._connect() as conn:
            conn.execute("UPDATE documents SET ingest_status = ? WHERE doc_id = ?", (status, doc_id))

    def document_is_active(self, doc_id: str) -> bool:
        """Returns whether a document row still exists and has not been deleted."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM documents WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
            ).fetchone()
            return bool(row)

    def get_document_by_id(self, doc_id: str) -> dict[str, Any] | None:
        """Returns one document row regardless of owner, for worker bookkeeping."""
        with self.lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            return dict(row) if row else None

    def active_document_count(self, user_id: str) -> int:
        """Counts active PDFs owned by a user, excluding failed ingestion rows."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS count FROM documents
                WHERE user_id = ? AND is_deleted = 0 AND ingest_status != 'failed'
                """,
                (user_id,),
            ).fetchone()
            return int(row["count"])

    def has_duplicate_document(self, user_id: str, content_hash: str) -> bool:
        """Checks whether active user documents already contain a content hash."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM documents
                WHERE user_id = ? AND content_hash = ? AND is_deleted = 0 AND ingest_status != 'failed'
                """,
                (user_id, content_hash),
            ).fetchone()
            return bool(row)

    def get_document(self, user_id: str, doc_id: str) -> dict[str, Any] | None:
        """Returns an active document owned by a user."""
        with self.lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM documents
                WHERE user_id = ? AND doc_id = ? AND is_deleted = 0
                """,
                (user_id, doc_id),
            ).fetchone()
            return dict(row) if row else None

    def list_documents(self, user_id: str) -> list[dict[str, Any]]:
        """Lists active documents for a user."""
        with self.lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT doc_id, filename, file_size, chunk_count, created_at,
                       last_accessed_at, question_count, ingest_status, job_id
                FROM documents
                WHERE user_id = ? AND is_deleted = 0
                ORDER BY created_at DESC
                """,
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def mark_document_deleted(self, user_id: str, doc_id: str) -> dict[str, Any]:
        """Soft-deletes one active user document."""
        document = self.get_document(user_id, doc_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE documents SET is_deleted = 1 WHERE user_id = ? AND doc_id = ?",
                (user_id, doc_id),
            )
        return document

    def increment_questions(self, user_id: str, doc_ids: list[str]) -> None:
        """Increments user and document question counters."""
        now = int(time.time())
        with self.lock, self._connect() as conn:
            conn.execute(
                "UPDATE users SET question_count = question_count + 1, last_seen_at = ? WHERE user_id = ?",
                (now, user_id),
            )
            for doc_id in doc_ids:
                conn.execute(
                    """
                    UPDATE documents
                    SET question_count = question_count + 1, last_accessed_at = ?
                    WHERE user_id = ? AND doc_id = ? AND is_deleted = 0
                    """,
                    (now, user_id, doc_id),
                )

    def log_audit(self, event: dict[str, Any]) -> None:
        """Persists one audit event."""
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_events (event_type, user_id, ip_address, severity, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    event["event_type"],
                    event.get("user_id"),
                    event["ip_address"],
                    event["severity"],
                    json.dumps(event.get("details", {}), default=str),
                    event["created_at"],
                ),
            )

    def log_vital(self, vital: dict[str, Any]) -> None:
        """Persists one browser vital sample."""
        with self.lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO web_vitals
                (metric_name, metric_value, rating, page, device, connection_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    vital["name"],
                    vital["value"],
                    vital["rating"],
                    vital.get("page", "/"),
                    vital.get("device", "desktop"),
                    vital.get("connection"),
                    vital["created_at"],
                ),
            )

    def admin_snapshot(self) -> dict[str, Any]:
        """Returns aggregate admin analytics and recent user activity."""
        with self.lock, self._connect() as conn:
            totals = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM users) AS users,
                  (SELECT COUNT(*) FROM users WHERE is_blocked = 1) AS blocked_users,
                  (SELECT COUNT(*) FROM blocked_ips) AS blocked_ips,
                  (SELECT COUNT(*) FROM documents WHERE is_deleted = 0) AS active_documents,
                  (SELECT COUNT(*) FROM documents) AS all_documents,
                  (SELECT COALESCE(SUM(question_count), 0) FROM users) AS total_questions,
                  (SELECT COUNT(DISTINCT ip_address) FROM user_devices) AS distinct_ips,
                  (SELECT COUNT(*) FROM users WHERE email IS NULL) AS guest_users
                """
            ).fetchone()
            # last_ip falls back to the audit log so identities recorded before
            # device tracking existed still show an address instead of a blank.
            users = conn.execute(
                """
                SELECT u.user_id, u.email, u.role, u.created_at, u.last_seen_at,
                       u.question_count, u.is_blocked, u.block_reason,
                       COUNT(d.doc_id) AS active_documents,
                       COALESCE(
                         (SELECT dv.ip_address FROM user_devices dv
                          WHERE dv.user_id = u.user_id
                          ORDER BY dv.last_seen_at DESC LIMIT 1),
                         (SELECT ae.ip_address FROM audit_events ae
                          WHERE ae.user_id = u.user_id
                          ORDER BY ae.created_at DESC LIMIT 1)
                       ) AS last_ip,
                       (SELECT dv.user_agent FROM user_devices dv
                        WHERE dv.user_id = u.user_id
                        ORDER BY dv.last_seen_at DESC LIMIT 1) AS last_user_agent,
                       (SELECT COUNT(DISTINCT dv.ip_address) FROM user_devices dv
                        WHERE dv.user_id = u.user_id) AS ip_count
                FROM users u
                LEFT JOIN documents d ON d.user_id = u.user_id AND d.is_deleted = 0
                GROUP BY u.user_id
                ORDER BY u.last_seen_at DESC
                LIMIT 100
                """
            ).fetchall()
            devices = conn.execute(
                """
                SELECT dv.user_id, dv.ip_address, dv.user_agent, dv.first_seen_at,
                       dv.last_seen_at, dv.hits, u.email,
                       CASE WHEN u.email IS NULL THEN 1 ELSE 0 END AS is_guest,
                       (SELECT COUNT(*) FROM blocked_ips b
                        WHERE b.ip_address = dv.ip_address) AS is_blocked_ip
                FROM user_devices dv
                LEFT JOIN users u ON u.user_id = dv.user_id
                ORDER BY dv.last_seen_at DESC
                LIMIT 100
                """
            ).fetchall()
            events = conn.execute(
                """
                SELECT event_type, user_id, ip_address, severity, details, created_at
                FROM audit_events
                ORDER BY created_at DESC
                LIMIT 200
                """
            ).fetchall()
            vitals = conn.execute(
                """
                SELECT metric_name, COUNT(*) AS samples, AVG(metric_value) AS average_value,
                       MAX(metric_value) AS worst_value
                FROM web_vitals
                GROUP BY metric_name
                ORDER BY metric_name
                """
            ).fetchall()
        return {
            "totals": dict(totals),
            "users": [dict(row) for row in users],
            "devices": [dict(row) for row in devices],
            "audit_events": [{**dict(row), "details": json.loads(row["details"])} for row in events],
            "web_vitals": [dict(row) for row in vitals],
            "limits": {
                "pdfs_per_guest": PDF_LIMIT_GUEST,
                "pdfs_per_account": PDF_LIMIT_SIGNED_IN,
                "pdfs_per_user": PDF_LIMIT_PER_USER,  # kept for existing consumers
                "questions_per_user": QUESTION_LIMIT_PER_USER,
            },
        }


@dataclass
class FixedWindowLimit:
    """Stores one in-memory fixed-window rate limit rule."""

    window_seconds: int
    max_requests: int
    block_seconds: int = 0
    burst_window_seconds: int | None = None
    burst_max_requests: int | None = None


@dataclass
class CounterState:
    """Tracks count and reset time for one client limit bucket."""

    count: int = 0
    reset_at: float = field(default_factory=time.time)


# These tiers exist ONLY to stop scripted abuse. They must never re-impose a
# product quota: per-user PDF slots and question counts are the business rules
# and live in PDFLimiter. Windows are short and per-IP, so a throttled human
# recovers in under a minute instead of being locked out for a day.
RATE_LIMITS: dict[str, FixedWindowLimit] = {
    # Anonymous sessions are minted on first visit and shared IPs are common
    # (offices, schools, mobile carriers behind NAT), so this must not be a
    # per-day cap. Still slow enough to make admin-token brute force useless.
    "auth": FixedWindowLimit(window_seconds=3600, max_requests=40, block_seconds=900),
    # PDFLimiter.can_upload enforces the real 2-slot rule. This only stops
    # upload flooding, and stays loose enough that delete-then-reupload works.
    "upload": FixedWindowLimit(window_seconds=3600, max_requests=20),
    # Questions are unlimited per user (QUESTION_LIMIT_PER_USER = 0). A short
    # per-minute window plus a small burst guard keeps that promise while still
    # blocking automated hammering. No block_seconds: never IP-ban for asking.
    "chat": FixedWindowLimit(
        window_seconds=60,
        max_requests=20,
        burst_window_seconds=10,
        burst_max_requests=6,
    ),
    "general": FixedWindowLimit(window_seconds=60, max_requests=100),
    "vitals": FixedWindowLimit(window_seconds=60, max_requests=120),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds defensive browser and cache headers to every API response."""

    async def dispatch(self, request: Request, call_next):
        nonce = secrets.token_urlsafe(16)
        request.state.csp_nonce = nonce
        response = await call_next(request)

        allowed_connect = " ".join(
            part for part in re.split(r"[,\s]+", os.getenv("CSP_CONNECT_SRC", "https://api.docmind.ai")) if part
        )
        headers = {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
            "Server": "DocMind",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "; ".join(
                [
                    "default-src 'self'",
                    f"script-src 'self' 'nonce-{nonce}'",
                    f"style-src 'self' 'nonce-{nonce}' fonts.googleapis.com",
                    "font-src 'self' fonts.gstatic.com",
                    "img-src 'self' data: blob:",
                    f"connect-src 'self' {allowed_connect}",
                    "worker-src 'self' blob:",
                    "frame-ancestors 'none'",
                    "base-uri 'self'",
                    "form-action 'self'",
                    "upgrade-insecure-requests",
                ]
            ),
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
            "Expires": "0",
        }

        for header, value in headers.items():
            response.headers[header] = value
        if "X-Powered-By" in response.headers:
            del response.headers["X-Powered-By"]
        return response


class RateLimiter:
    """Enforces per-IP fixed-window and burst request limits."""

    def __init__(self) -> None:
        self.counters: dict[str, CounterState] = {}
        self.blocked_until: dict[str, tuple[float, str]] = {}

    def get_client_ip(self, request: Request) -> str:
        """Returns the first valid forwarded client IP, falling back to the socket peer."""
        return get_request_ip(request)

    def _increment(self, key: str, window_seconds: int) -> tuple[int, int]:
        """Increments one counter and returns its count plus seconds until reset."""
        now = time.time()
        state = self.counters.get(key)
        if state is None or now >= state.reset_at:
            state = CounterState(count=0, reset_at=now + window_seconds)
            self.counters[key] = state
        state.count += 1
        return state.count, max(1, int(state.reset_at - now))

    async def block_ip(self, ip_address: str, duration: int, reason: str) -> None:
        """Blocks an IP address for the requested duration and records an audit event."""
        self.blocked_until[ip_address] = (time.time() + duration, reason)
        if duration <= 0:
            security_store.block_ip(ip_address, reason)
        audit_logger.log("ip_blocked", None, ip_address, {"reason": reason, "duration": duration}, "high")

    async def check(self, request: Request, tier: str) -> dict[str, int]:
        """Checks a request against the selected tier and raises on violation."""
        config = RATE_LIMITS.get(tier, RATE_LIMITS["general"])
        ip_address = self.get_client_ip(request)
        if security_store.is_ip_blocked(ip_address):
            raise HTTPException(status_code=403, detail="Access denied")
        blocked = self.blocked_until.get(ip_address)
        if blocked and time.time() < blocked[0]:
            raise HTTPException(status_code=403, detail="Access denied")

        count, ttl = self._increment(f"rl:{tier}:{ip_address}", config.window_seconds)
        if config.burst_window_seconds and config.burst_max_requests:
            burst_count, burst_ttl = self._increment(
                f"rl:burst:{tier}:{ip_address}",
                config.burst_window_seconds,
            )
            if burst_count > config.burst_max_requests:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests",
                    headers=self.headers(config.max_requests, 0, burst_ttl),
                )

        remaining = max(0, config.max_requests - count)
        if count > config.max_requests:
            if config.block_seconds:
                await self.block_ip(ip_address, config.block_seconds, f"rate_limit_exceeded:{tier}")
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded",
                headers=self.headers(config.max_requests, 0, ttl),
            )

        return {"limit": config.max_requests, "remaining": remaining, "reset": int(time.time()) + ttl}

    def headers(self, limit: int, remaining: int, ttl: int) -> dict[str, str]:
        """Builds standard rate-limit response headers."""
        return {
            "Retry-After": str(ttl),
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(time.time()) + ttl),
        }


class PromptInjectionScanner:
    """Scores user text for common prompt-injection attempts."""

    patterns: tuple[tuple[str, int, str], ...] = (
        (r"ignore\s+(all\s+)?(previous\s+|prior\s+|above\s+|earlier\s+)?instructions", 5, "instruction_override"),
        (r"forget\s+(everything|previous|all)", 5, "memory_wipe"),
        (r"you\s+are\s+now\s+(?!a\s+helpful)", 4, "persona_hijack"),
        # Jailbreak vocabulary on its own is NOT an attack: "Dan" is an ordinary
        # name and "developer mode" / "jailbreak" are ordinary subjects in a
        # technical PDF ("How do I enable developer mode on the device?"). Scored
        # below the block threshold so a bare mention is logged, never punished.
        (r"\b(jailbreak(ing|s|ed)?|dan\s+mode|developer\s+mode|god\s+mode)\b", 3, "jailbreak_vocab"),
        # The actual attack aims the persona at the assistant in second person,
        # rather than asking about something the document describes.
        (
            r"\b(you\s+are|act\s+as|behave\s+like|pretend\s+to\s+be|roleplay\s+as)\b"
            r"[^.?!]{0,24}\b(dan\b|jailbroken|jailbreak\s+mode|developer\s+mode|god\s+mode)",
            5,
            "jailbreak_activation",
        ),
        (r"reveal\s+(your\s+)?(system\s+)?prompt", 4, "extraction"),
        (r"<\|system\|>|\[INST\]|<<SYS>>", 8, "token_smuggling"),
        (r"pretend\s+(you\s+have\s+no|there\s+are\s+no)", 6, "restriction_bypass"),
        (r"print\s+(your\s+)?instructions", 4, "extraction"),
    )

    def scan(self, text: str) -> dict[str, Any]:
        """Returns safety score, triggered pattern labels, and recommended action."""
        total_score = 0
        triggered: list[str] = []
        for pattern, score, label in self.patterns:
            if re.search(pattern, text, re.IGNORECASE):
                total_score += score
                triggered.append(label)
        return {
            "safe": total_score < 5,
            "score": total_score,
            "triggered_patterns": triggered,
            "action": self.determine_action(total_score),
        }

    def determine_action(self, score: int) -> str:
        """Maps an injection score to an enforcement action."""
        if score >= 10:
            return "block_and_ban"
        if score >= 7:
            return "block_and_log"
        if score >= 5:
            return "block"
        if score >= 3:
            return "warn_and_log"
        return "allow"


class PDFUploadValidator:
    """Validates PDF bytes, size, magic bytes, and safe display filename."""

    def validate_file(self, file_content: bytes, filename: str) -> dict[str, Any]:
        """Validates an upload and returns normalized metadata or validation errors."""
        errors: list[str] = []
        if len(file_content) > MAX_PDF_SIZE_BYTES:
            errors.append("File exceeds maximum size of 10MB")
        if not file_content.startswith(PDF_MAGIC):
            errors.append("File does not appear to be a valid PDF")

        safe_filename = re.sub(r"[^a-zA-Z0-9._-]", "_", Path(filename).name or "document.pdf")[:255]
        if not safe_filename.lower().endswith(".pdf"):
            errors.append("Only PDF files are allowed")

        if errors:
            return {"valid": False, "errors": errors}
        return {
            "valid": True,
            "safe_filename": safe_filename,
            "file_size": len(file_content),
            "content_hash": hashlib.sha256(file_content).hexdigest(),
            "mime_type": "application/pdf",
        }


class MalwareDetectedError(ValueError):
    """Raised when ClamAV reports a known threat in an upload."""


class AntivirusUnavailableError(RuntimeError):
    """Raised when the antivirus scanner cannot complete a verdict."""


class ClamAVScanner:
    """Streams bytes to clamd over a unix/TCP socket and fails closed on errors."""

    def __init__(self, host: str | None = None, port: int | None = None) -> None:
        self.host = (host if host is not None else os.getenv("CLAMAV_HOST", "")).strip()
        self.port = port if port is not None else int(os.getenv("CLAMAV_PORT", "3310"))
        self.timeout = float(os.getenv("CLAMAV_TIMEOUT_SECONDS", "15"))
        self.required = os.getenv("CLAMAV_REQUIRED", "true").strip().lower() not in {"0", "false", "no"}

    def _connect(self) -> socket.socket:
        """Opens the configured scanner socket, treating a unix path as a socket file."""
        if self.host.startswith("/"):
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect(self.host)
            return sock
        return socket.create_connection((self.host, self.port), timeout=self.timeout)

    def scan_bytes(self, content: bytes) -> None:
        """Scans bytes in INSTREAM mode, raising on a threat or scanner failure."""
        if not self.host:
            if self.required and os.getenv("ENVIRONMENT", "development").lower() == "production":
                raise AntivirusUnavailableError("Antivirus scanner is not configured")
            print("Warning: CLAMAV_HOST is unset; malware scanning is disabled in development")
            return
        sock: socket.socket | None = None
        try:
            sock = self._connect()
            sock.sendall(b"zINSTREAM\0")
            for offset in range(0, len(content), 64 * 1024):
                chunk = content[offset:offset + 64 * 1024]
                sock.sendall(struct.pack(">I", len(chunk)) + chunk)
            sock.sendall(struct.pack(">I", 0))
            response = b""
            while not response.endswith(b"\0") and len(response) < 4096:
                piece = sock.recv(1024)
                if not piece:
                    break
                response += piece
        except (OSError, socket.timeout) as exc:
            raise AntivirusUnavailableError("Antivirus scanner is unavailable") from exc
        finally:
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
        verdict = response.decode("utf-8", errors="replace").strip("\0 \r\n")
        if verdict.endswith("FOUND") or " FOUND" in verdict:
            raise MalwareDetectedError("Malware detected")
        if "OK" not in verdict:
            raise AntivirusUnavailableError("Antivirus scanner returned an invalid verdict")


antivirus_scanner = ClamAVScanner()


def verify_recaptcha_token(token: str | None, action: str, remote_ip: str | None = None) -> bool:
    """Verifies a reCAPTCHA v3 token and enforces the per-action score threshold."""
    secret = os.getenv("RECAPTCHA_SECRET_KEY", "").strip()
    if not secret:
        # Local development and CI do not have Google credentials. Production
        # must set the secret, otherwise bot defense would silently disappear.
        return os.getenv("ENVIRONMENT", "development").lower() != "production"
    if not token:
        return False
    payload = urllib.parse.urlencode(
        {"secret": secret, "response": token, "remoteip": remote_ip or ""}
    ).encode()
    try:
        with urllib.request.urlopen(RECAPTCHA_VERIFY_URL, data=payload, timeout=5) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False
    if not result.get("success"):
        return False
    if result.get("action") and result.get("action") != action:
        return False
    threshold = 0.7 if action in {"upload", "query"} else 0.5
    try:
        return float(result.get("score", 0.0)) >= threshold
    except (TypeError, ValueError):
        return False


class SecureTempStorage:
    """Creates user-scoped temporary PDF paths that cannot escape the base folder."""

    def __init__(self, base_path: str | None = None) -> None:
        self.base_path = Path(base_path or tempfile.gettempdir(), "docmind-uploads").resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)

    def get_user_dir(self, user_id: str) -> Path:
        """Returns a sanitized per-user directory under the storage root."""
        safe_user_id = "".join(ch for ch in user_id if ch.isalnum() or ch in {"-", "_"}) or "anonymous"
        user_dir = (self.base_path / safe_user_id).resolve()
        if not str(user_dir).startswith(str(self.base_path)):
            raise ValueError("Path traversal detected")
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir

    def generate_safe_path(self, user_id: str) -> Path:
        """Generates a random PDF path inside the user's temporary directory."""
        path = (self.get_user_dir(user_id) / f"{uuid.uuid4().hex}.pdf").resolve()
        if not str(path).startswith(str(self.base_path)):
            raise ValueError("Path traversal detected")
        return path


class AuthService:
    """Issues and verifies tamper-proof backend user session tokens."""

    # Unauthorized admin hits are counted per IP so a single stray click on the
    # admin URL costs a 403, not an account. Only a repeated, deliberate probe
    # earns a block, and a time-boxed one: security_store.block_ip writes to
    # SQLite permanently, which would outlive a restart and strand the
    # legitimate owner (and anyone sharing their NAT) with no way back in.
    ADMIN_PROBE_LIMIT = 5
    ADMIN_PROBE_WINDOW_SECONDS = 900
    ADMIN_PROBE_BLOCK_SECONDS = 3600

    def __init__(self) -> None:
        self._admin_probes: dict[str, list[float]] = {}

    def sign(self, payload: dict[str, Any]) -> str:
        """Signs a compact JSON payload with HMAC-SHA256."""
        body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
        signature = hmac.new(AUTH_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        signed = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        return f"{body}.{signed}"

    def verify(self, token: str) -> dict[str, Any]:
        """Verifies a signed session token and returns its payload."""
        try:
            body, signature = token.split(".", 1)
            expected = base64.urlsafe_b64encode(
                hmac.new(AUTH_SECRET.encode(), body.encode(), hashlib.sha256).digest()
            ).decode().rstrip("=")
            if not hmac.compare_digest(signature, expected):
                raise ValueError("bad signature")
            padded = body + ("=" * (-len(body) % 4))
            payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
            if int(payload.get("exp", 0)) < int(time.time()):
                raise ValueError("expired")
            return payload
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid session") from exc

    def create_session(self, email: str | None = None, admin_token: str | None = None) -> dict[str, Any]:
        """Creates a signed anonymous session, or an admin session with a valid token.

        An arbitrary email is deliberately NOT honoured here: user_id is derived from
        the email, so trusting an unverified one would let any caller mint a token for
        somebody else's account and read their documents. Verified identity comes only
        from Google (create_google_session) or a password (login_with_password).
        """
        clean_email = email.strip().lower() if email else None
        role = "user"
        if ADMIN_EMAIL and clean_email == ADMIN_EMAIL:
            if not ADMIN_ACCESS_TOKEN or not admin_token or not hmac.compare_digest(admin_token, ADMIN_ACCESS_TOKEN):
                raise HTTPException(status_code=403, detail="Admin access denied")
            role = "admin"
        else:
            clean_email = None
        user_seed = clean_email or secrets.token_urlsafe(24)
        user_id = "usr_" + hashlib.sha256(user_seed.encode()).hexdigest()[:32]
        payload = {
            "sub": user_id,
            "email": clean_email,
            "role": role,
            "iat": int(time.time()),
            "exp": int(time.time()) + 60 * 60 * 24 * 30,
            "jti": secrets.token_urlsafe(18),
        }
        security_store.upsert_user(user_id, clean_email, role)
        return {
            "user_id": user_id,
            "email": clean_email,
            "role": role,
            "access_token": self.sign(payload),
        }

    def _session_for_email(self, clean_email: str, role: str = "user") -> dict[str, Any]:
        """Issues a signed session for an already-verified email address."""
        user_id = "usr_" + hashlib.sha256(clean_email.encode()).hexdigest()[:32]
        payload = {
            "sub": user_id,
            "email": clean_email,
            "role": role,
            "iat": int(time.time()),
            "exp": int(time.time()) + 60 * 60 * 24 * 30,
            "jti": secrets.token_urlsafe(18),
        }
        security_store.upsert_user(user_id, clean_email, role)
        return {
            "user_id": user_id,
            "email": clean_email,
            "role": role,
            "access_token": self.sign(payload),
        }

    def hash_password(self, password: str) -> str:
        """Hashes a password with scrypt and a per-user random salt."""
        salt = secrets.token_bytes(16)
        digest = hashlib.scrypt(
            password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32
        )
        return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"

    def verify_password(self, password: str, stored: str | None) -> bool:
        """Constant-time check of a password against a stored scrypt hash."""
        if not stored:
            return False
        try:
            scheme, n, r, p, salt_hex, digest_hex = stored.split("$")
            if scheme != "scrypt":
                return False
            expected = bytes.fromhex(digest_hex)
            candidate = hashlib.scrypt(
                password.encode(),
                salt=bytes.fromhex(salt_hex),
                n=int(n),
                r=int(r),
                p=int(p),
                dklen=len(expected),
            )
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(candidate, expected)

    def create_email_account(self, email: str, password: str) -> dict[str, Any]:
        """Registers a new email/password account and returns a signed session."""
        clean_email = (email or "").strip().lower()
        if not EMAIL_PATTERN.match(clean_email):
            raise HTTPException(status_code=422, detail="Enter a valid email address")
        if len(password or "") < PASSWORD_MIN_LENGTH:
            raise HTTPException(
                status_code=422,
                detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters",
            )
        if ADMIN_EMAIL and clean_email == ADMIN_EMAIL:
            raise HTTPException(status_code=403, detail="This address cannot be registered")

        # A row already exists for this email only if a verified Google sign-in
        # created it. Letting a stranger attach a password would hand them that
        # account's documents, since user_id is derived from the email.
        if security_store.get_user_by_email(clean_email):
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Sign in instead.",
            )

        session = self._session_for_email(clean_email)
        security_store.set_password_hash(session["user_id"], self.hash_password(password))
        return session

    def login_with_password(self, email: str, password: str) -> dict[str, Any]:
        """Verifies email/password credentials and returns a signed session."""
        clean_email = (email or "").strip().lower()
        user = security_store.get_user_by_email(clean_email)
        # One generic message for "no such account" and "wrong password" so the
        # endpoint cannot be used to enumerate which emails are registered.
        if not user or not self.verify_password(password or "", user.get("password_hash")):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        if user.get("is_blocked"):
            raise HTTPException(status_code=403, detail="This account is blocked")
        return self._session_for_email(clean_email, user.get("role") or "user")

    def create_google_session(self, credential: str) -> dict[str, Any]:
        """Verifies a Google ID token and issues a signed session for the verified email.

        The user_id is derived from the verified email exactly like create_session, so a
        Google user gets a stable identity and their documents/questions persist across
        devices. Google sign-in never grants admin — admin still requires ADMIN_ACCESS_TOKEN.
        """
        if not GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=503, detail="Google sign-in is not configured")
        if not credential or not isinstance(credential, str):
            raise HTTPException(status_code=400, detail="Missing Google credential")
        try:
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token as google_id_token
        except ImportError as exc:  # dependency missing at runtime
            raise HTTPException(status_code=503, detail="Google sign-in is not available") from exc
        try:
            # Verifies the JWT signature, that aud == GOOGLE_CLIENT_ID, and that it is unexpired.
            claims = google_id_token.verify_oauth2_token(
                credential,
                google_requests.Request(),
                GOOGLE_CLIENT_ID,
                clock_skew_in_seconds=10,
            )
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid Google credential") from exc
        if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise HTTPException(status_code=401, detail="Invalid Google token issuer")
        if not claims.get("email") or not claims.get("email_verified"):
            raise HTTPException(status_code=401, detail="Google account email is not verified")
        clean_email = str(claims["email"]).strip().lower()
        role = "user"
        user_id = "usr_" + hashlib.sha256(clean_email.encode()).hexdigest()[:32]
        payload = {
            "sub": user_id,
            "email": clean_email,
            "role": role,
            "provider": "google",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60 * 60 * 24 * 30,
            "jti": secrets.token_urlsafe(18),
        }
        security_store.upsert_user(user_id, clean_email, role)
        # A verified Google email proves ownership. If someone pre-registered
        # this address with a password, that password must not survive, or the
        # stranger who chose it could keep signing into the owner's account.
        security_store.clear_password_hash(user_id)
        return {
            "user_id": user_id,
            "email": clean_email,
            "role": role,
            "access_token": self.sign(payload),
        }

    def current_user(self, request: Request) -> dict[str, Any]:
        """Returns the verified current user or rejects the request."""
        authorization = request.headers.get("Authorization", "")
        ip_address = get_request_ip(request)
        if security_store.is_ip_blocked(ip_address):
            raise HTTPException(status_code=403, detail="Access denied")
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Authentication required")
        try:
            payload = self.verify(authorization.removeprefix("Bearer ").strip())
        except HTTPException:
            raise
        user = security_store.get_user(payload["sub"])
        if not user or user.get("is_blocked"):
            raise HTTPException(status_code=403, detail="Access denied")
        note_request_device(request, str(payload.get("sub", "")))
        return payload

    def require_admin(self, request: Request) -> dict[str, Any]:
        """Returns the current admin user or rejects the request."""
        user = self.current_user(request)
        if not ADMIN_EMAIL or user.get("role") != "admin" or user.get("email") != ADMIN_EMAIL:
            ip_address = get_request_ip(request)
            now = time.time()
            recent = [
                stamp
                for stamp in self._admin_probes.get(ip_address, [])
                if now - stamp < self.ADMIN_PROBE_WINDOW_SECONDS
            ]
            recent.append(now)
            self._admin_probes[ip_address] = recent
            audit_logger.log(
                "unauthorized_admin_access",
                str(user.get("sub", "")),
                ip_address,
                {"attempts": len(recent)},
                "warning" if len(recent) < self.ADMIN_PROBE_LIMIT else "high",
            )
            if len(recent) >= self.ADMIN_PROBE_LIMIT:
                # Never permanently block the identity here: a shared NAT or a
                # stray click must not lock the real admin out of their account.
                rate_limiter.blocked_until[ip_address] = (
                    now + self.ADMIN_PROBE_BLOCK_SECONDS,
                    "unauthorized_admin_access",
                )
            raise HTTPException(status_code=403, detail="Admin access denied")
        return user


class PDFLimiter:
    """Enforces the per-identity PDF allowance: guests get fewer slots than accounts."""

    def limit_for(self, user_id: str) -> int:
        """Returns the PDF allowance for one identity.

        A stored email means the identity was proven by a password or by Google
        (create_session refuses to attach an unverified one), so it is the only
        signal needed to tell an account apart from an anonymous visitor.
        """
        user = security_store.get_user(user_id)
        has_email = bool((user or {}).get("email"))
        return PDF_LIMIT_SIGNED_IN if has_email else PDF_LIMIT_GUEST

    def can_upload(self, user_id: str) -> dict[str, Any]:
        """Returns the user's current slot count and upload eligibility."""
        limit = self.limit_for(user_id)
        current_count = security_store.active_document_count(user_id)
        remaining = max(0, limit - current_count)
        signed_in = limit >= PDF_LIMIT_SIGNED_IN
        if remaining > 0:
            message = "Ready for upload"
        elif signed_in:
            message = "Delete a PDF to upload a new one"
        else:
            # Guests at the cap have a way forward that is not deleting work.
            message = f"Sign in to raise your limit to {PDF_LIMIT_SIGNED_IN} PDFs"
        return {
            "can_upload": remaining > 0,
            "current_count": current_count,
            "remaining_slots": remaining,
            "limit": limit,
            "signed_in": signed_in,
            "signed_in_limit": PDF_LIMIT_SIGNED_IN,
            "message": message,
        }

    def reserve_document(
        self,
        user_id: str,
        doc_id: str,
        filename: str,
        file_size: int,
        content_hash: str,
        job_id: str,
    ) -> None:
        """Reserves one slot and creates a queued document before background work starts."""
        security_store.reserve_document(
            {
                "doc_id": doc_id,
                "user_id": user_id,
                "filename": filename,
                "file_size": file_size,
                "content_hash": content_hash,
                "created_at": int(time.time()),
                "job_id": job_id,
            },
            self.limit_for(user_id),
        )

    def mark_ready(self, doc_id: str, chunk_count: int) -> None:
        """Marks a queued document ready after its vectors are durably indexed."""
        security_store.mark_document_ready(doc_id, chunk_count)

    def mark_failed(self, doc_id: str) -> None:
        """Releases the slot held by a failed ingestion."""
        security_store.mark_document_failed(doc_id)

    def update_ingest_status(self, doc_id: str, status: str) -> None:
        """Persists the current ingestion stage for the status endpoint and UI."""
        security_store.update_document_status(doc_id, status)

    def get_document(self, user_id: str, doc_id: str) -> dict[str, Any] | None:
        """Returns one owned document row for status checks and metadata."""
        return security_store.get_document(user_id, doc_id)

    def register_upload(
        self,
        user_id: str,
        doc_id: str,
        filename: str,
        file_size: int,
        chunk_count: int,
        content_hash: str,
    ) -> None:
        """Registers an already-ingested PDF (used by the synchronous dev path)."""
        status = self.can_upload(user_id)
        if not status["can_upload"]:
            raise HTTPException(status_code=409, detail=str(status["message"]))
        if security_store.has_duplicate_document(user_id, content_hash):
            raise HTTPException(status_code=409, detail="This PDF has already been uploaded")
        security_store.add_document({
            "doc_id": doc_id,
            "user_id": user_id,
            "filename": filename,
            "file_size": file_size,
            "chunk_count": chunk_count,
            "content_hash": content_hash,
            "created_at": int(time.time()),
            "ingest_status": "ready",
        })

    def delete_pdf(self, user_id: str, doc_id: str) -> dict[str, Any]:
        """Removes a PDF from the user's slot registry and returns its metadata."""
        self.verify_access(user_id, [doc_id])
        return security_store.mark_document_deleted(user_id, doc_id)

    def verify_access(self, user_id: str, doc_ids: list[str]) -> None:
        """Raises if any requested document is outside the user's upload set."""
        missing = [doc_id for doc_id in doc_ids if security_store.get_document(user_id, doc_id) is None]
        if missing:
            raise HTTPException(status_code=404, detail="Document not found")

    def can_ask(self, user_id: str) -> dict[str, Any]:
        """Returns the user's question slot status. QUESTION_LIMIT_PER_USER <= 0 means unlimited."""
        user = security_store.get_user(user_id)
        used = int(user.get("question_count", 0)) if user else 0
        if QUESTION_LIMIT_PER_USER <= 0:
            return {
                "can_ask": True,
                "used": used,
                "limit": 0,          # 0 signals "unlimited" to the frontend
                "remaining": 999999,
                "unlimited": True,
                "message": "Unlimited questions",
            }
        remaining = max(0, QUESTION_LIMIT_PER_USER - used)
        return {
            "can_ask": remaining > 0,
            "used": used,
            "limit": QUESTION_LIMIT_PER_USER,
            "remaining": remaining,
            "unlimited": False,
            "message": "Ready for questions" if remaining > 0 else "Question limit reached",
        }

    def mark_question(self, user_id: str, doc_ids: list[str]) -> None:
        """Increments per-document question counters after an authorized query."""
        security_store.increment_questions(user_id, doc_ids)

    def list_pdfs(self, user_id: str) -> list[dict[str, Any]]:
        """Returns user document metadata without internal hashes."""
        return security_store.list_documents(user_id)


class AuditLogger:
    """Stores compact security and usage audit events in memory and logs JSON."""

    def log(
        self,
        event_type: str,
        user_id: str | None,
        ip_address: str,
        details: dict[str, Any] | None = None,
        severity: str = "info",
    ) -> None:
        """Records one audit event for later inspection and external log capture."""
        event = {
            "event_type": event_type,
            "user_id": user_id,
            "ip_address": ip_address,
            "details": details or {},
            "severity": severity,
            "created_at": int(time.time()),
        }
        SECURITY_EVENTS.append(event)
        security_store.log_audit(event)
        if event_type in {"ip_blocked", "injection_detected", "malware_detected"}:
            capture_security_event(event_type, severity)
        print(json.dumps({"event": "audit", **event}, default=str))


class ConcurrencyLimiter:
    """Limits active request work per user identity and system-wide load."""

    def __init__(self, max_per_user: int = 3, max_system: int = 20) -> None:
        self.max_per_user = max_per_user
        self.max_system = max_system
        self.system_active = 0
        self.user_semaphores: defaultdict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(self.max_per_user)
        )
        self.user_active_counts: defaultdict[str, int] = defaultdict(int)

    async def acquire(self, user_id: str) -> None:
        """Waits briefly for a per-user request slot or rejects the request."""
        if self.system_active >= self.max_system:
            raise HTTPException(
                status_code=503,
                detail="Server is busy. Please try again in a moment.",
            )
        try:
            await asyncio.wait_for(self.user_semaphores[user_id].acquire(), timeout=2.0)
            self.user_active_counts[user_id] += 1
            self.system_active += 1
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=429,
                detail="You have too many active requests. Please wait for one to complete.",
            ) from exc

    def release(self, user_id: str) -> None:
        """Releases one active request slot for a user."""
        self.user_semaphores[user_id].release()
        self.user_active_counts[user_id] = max(0, self.user_active_counts[user_id] - 1)
        self.system_active = max(0, self.system_active - 1)


security_store = SecurityStore(SECURITY_DB_PATH)
auth_service = AuthService()
rate_limiter = RateLimiter()
pdf_validator = PDFUploadValidator()
injection_scanner = PromptInjectionScanner()
file_storage = SecureTempStorage(os.getenv("UPLOAD_TMP_DIR"))
pdf_limiter = PDFLimiter()
audit_logger = AuditLogger()
concurrency_limiter = ConcurrencyLimiter()


def sanitize_identifier(value: str, field_name: str) -> str:
    """Validates and returns an API identifier field."""
    cleaned = value.strip()
    if not cleaned or len(cleaned) > 100 or not ID_PATTERN.match(cleaned):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return cleaned


def sanitize_question(question: str) -> str:
    """Normalizes a chat question and enforces the maximum prompt length."""
    cleaned = " ".join(question.replace("\x00", "").split())
    if not cleaned:
        raise HTTPException(status_code=400, detail="question is required")
    if len(cleaned) > MAX_CHAT_CHARS:
        raise HTTPException(status_code=400, detail="question is too long")
    return cleaned


def get_current_user_id(request: Request) -> str:
    """Returns the authenticated backend user id for limit enforcement."""
    return str(auth_service.current_user(request)["sub"])


def get_current_user(request: Request) -> dict[str, Any]:
    """Returns the authenticated backend user payload."""
    return auth_service.current_user(request)


def get_admin_user(request: Request) -> dict[str, Any]:
    """Returns the authenticated admin payload."""
    return auth_service.require_admin(request)


async def read_pdf_upload(file: UploadFile) -> dict[str, Any]:
    """Streams an upload into a size-capped buffer and validates it before writing anything."""
    filename = file.filename or "document.pdf"
    declared_mime = (file.content_type or "").split(";", 1)[0].strip().lower()
    if declared_mime and declared_mime not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    buffer = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        buffer.extend(chunk)
        if len(buffer) > MAX_PDF_SIZE_BYTES:
            raise HTTPException(status_code=400, detail="File exceeds maximum size of 10MB")
    content = bytes(buffer)
    validation = pdf_validator.validate_file(content, filename)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail="; ".join(validation["errors"]))
    validation["content"] = content
    return validation


async def limit_user_concurrency(user_id: str) -> AsyncGenerator[None, None]:
    """Applies a per-user concurrency guard around expensive request handlers."""
    await concurrency_limiter.acquire(user_id)
    try:
        yield
    finally:
        concurrency_limiter.release(user_id)
