"""Durable real chat activity, verified reviews, critical incidents, and healing audit."""

import json
import time
from pathlib import Path

from fastapi import HTTPException

from apm.common import epoch_iso, redact
from apm.database import get_pool
from apm.schemas import HealingReport, Incident, SessionFeedback, UserDetail, UserPage, UserRecord


class AdminStore:
    """Adds operational tables beside existing users without inventing interview data."""

    def __init__(self, path: Path) -> None:
        """Creates additive, idempotent schema migrations in the existing security database."""
        self.pool = get_pool(path, "security")
        with self.pool.connection(observe=False) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS activity_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(user_id),
                    started_at REAL NOT NULL,
                    last_activity_at REAL NOT NULL,
                    completed_at REAL,
                    answers INTEGER NOT NULL DEFAULT 0 CHECK(answers >= 0)
                );
                CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_sessions(user_id, started_at DESC);
                CREATE TABLE IF NOT EXISTS session_reviews (
                    session_id TEXT PRIMARY KEY REFERENCES activity_sessions(session_id),
                    user_id TEXT NOT NULL REFERENCES users(user_id),
                    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
                    verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1)),
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_reviews_user_verified ON session_reviews(user_id, verified);
                CREATE TABLE IF NOT EXISTS apm_incidents (
                    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_apm_incidents_time ON apm_incidents(timestamp DESC);
                CREATE TABLE IF NOT EXISTS apm_healing_runs (
                    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_apm_runs_time ON apm_healing_runs(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at DESC);
                """
            )

    def is_completed(self, session_id: str) -> bool:
        """Detects explicit completion so the next answered question can start a new session."""
        with self.pool.connection() as conn:
            row = conn.execute("SELECT completed_at FROM activity_sessions WHERE session_id = ?", (session_id,)).fetchone()
            return row is not None and row[0] is not None

    def record_answer(self, user_id: str, session_id: str) -> None:
        """Counts only successfully answered document sessions and refreshes real user activity."""
        now = time.time()
        with self.pool.connection() as conn:
            result = conn.execute(
                """INSERT INTO activity_sessions(session_id, user_id, started_at, last_activity_at, answers)
                   VALUES (?, ?, ?, ?, 1)
                   ON CONFLICT(session_id) DO UPDATE SET
                     last_activity_at = excluded.last_activity_at, answers = activity_sessions.answers + 1
                   WHERE activity_sessions.user_id = excluded.user_id AND activity_sessions.completed_at IS NULL""",
                (session_id, user_id, now, now),
            )
            if result.rowcount != 1:
                raise HTTPException(status_code=409, detail="This session is already complete; start a new session")
            conn.execute("UPDATE users SET last_seen_at = ? WHERE user_id = ?", (int(now), user_id))

    def feedback(self, user_id: str, session_id: str, stars: int | None = None, *, complete: bool = False) -> SessionFeedback:
        """Verifies session ownership before completing a chat or upserting its sole real review."""
        with self.pool.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            session = conn.execute(
                "SELECT completed_at, answers FROM activity_sessions WHERE session_id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
            if session is None or session["answers"] < 1:
                raise HTTPException(status_code=404, detail="Answered session not found")
            if stars is not None and (isinstance(stars, bool) or not isinstance(stars, int) or not 1 <= stars <= 5):
                raise HTTPException(status_code=422, detail="Choose a star rating between 1 and 5")
            now = time.time()
            if complete or stars is not None:
                conn.execute("UPDATE activity_sessions SET completed_at = COALESCE(completed_at, ?) WHERE session_id = ?", (now, session_id))
            if stars is not None:
                conn.execute(
                    """INSERT INTO session_reviews(session_id, user_id, stars, verified, created_at) VALUES (?, ?, ?, 1, ?)
                       ON CONFLICT(session_id) DO UPDATE SET stars = excluded.stars, verified = 1, created_at = excluded.created_at""",
                    (session_id, user_id, stars, now),
                )
                if stars >= 4:
                    try:
                        from learning import learning_store
                        learning_store.promote_session_to_memory(session_id, stars)
                    except Exception:
                        pass
            review = conn.execute("SELECT stars, verified FROM session_reviews WHERE session_id = ? AND user_id = ? AND verified = 1", (session_id, user_id)).fetchone()
        return SessionFeedback(sessionId=session_id, completed=complete or stars is not None or session["completed_at"] is not None, stars=int(review["stars"]) if review else None, verified=bool(review))

    def overview(self) -> dict[str, int | float]:
        """Averages individual verified reviews rather than averages-of-user-averages."""
        with self.pool.connection() as conn:
            row = conn.execute(
                """SELECT
                  (SELECT COUNT(*) FROM users) AS totalUsers,
                  (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?) AS active24h,
                  (SELECT COUNT(*) FROM activity_sessions WHERE answers > 0) AS totalSessions,
                  (SELECT COUNT(*) FROM activity_sessions WHERE completed_at IS NOT NULL AND answers > 0) AS completedSessions,
                  (SELECT COUNT(*) FROM session_reviews r JOIN activity_sessions s USING(session_id)
                    WHERE r.verified = 1 AND s.completed_at IS NOT NULL AND r.user_id = s.user_id) AS reviewCount,
                  (SELECT COALESCE(AVG(r.stars), 0.0) FROM session_reviews r JOIN activity_sessions s USING(session_id)
                    WHERE r.verified = 1 AND s.completed_at IS NOT NULL AND r.user_id = s.user_id) AS averageRating""",
                (time.time() - 86400,),
            ).fetchone()
        return dict(row)

    def users(self, search: str = "", role: str | None = None, status: str | None = None, rated: str | None = None, page: int = 1, page_size: int = 20, user_id: str | None = None) -> UserPage:
        """Paginates a parameterized roster with independently aggregated counts and reviews."""
        clauses, values = ["1 = 1"], []
        if search:
            escaped = search[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            clauses.append("(u.email LIKE ? ESCAPE '\\' OR u.user_id LIKE ? ESCAPE '\\')")
            values.extend([f"%{escaped}%", f"%{escaped}%"])
        if role:
            clauses.append("u.role = ?")
            values.append(role)
        if status:
            clauses.append("u.is_blocked = ?")
            values.append(1 if status == "suspended" else 0)
        if user_id:
            clauses.append("u.user_id = ?")
            values.append(user_id)
        if rated:
            clauses.append("COALESCE(r.review_count, 0) > 0" if rated == "rated" else "COALESCE(r.review_count, 0) = 0")
        cte = """WITH session_totals AS (
                   SELECT user_id, COUNT(*) AS total_sessions, COUNT(completed_at) AS completed_sessions
                   FROM activity_sessions WHERE answers > 0 GROUP BY user_id
                 ), ratings AS (
                   SELECT r.user_id, COUNT(*) AS review_count, AVG(r.stars) AS average_rating
                   FROM session_reviews r JOIN activity_sessions s USING(session_id)
                   WHERE r.verified = 1 AND s.completed_at IS NOT NULL AND r.user_id = s.user_id GROUP BY r.user_id
                 ), document_totals AS (
                   SELECT user_id, COUNT(*) AS active_documents FROM documents WHERE is_deleted = 0 GROUP BY user_id
                 ) """
        joins = """FROM users u LEFT JOIN session_totals s ON s.user_id = u.user_id
                    LEFT JOIN ratings r ON r.user_id = u.user_id
                    LEFT JOIN document_totals d ON d.user_id = u.user_id WHERE """ + " AND ".join(clauses)
        with self.pool.connection() as conn:
            total = conn.execute(cte + "SELECT COUNT(*) " + joins, values).fetchone()[0]
            rows = conn.execute(
                cte + """SELECT u.user_id, u.email, u.role, u.created_at, u.last_seen_at, u.question_count,
                         u.is_blocked, u.block_reason, COALESCE(s.total_sessions, 0) AS total_sessions,
                         COALESCE(s.completed_sessions, 0) AS completed_sessions,
                         COALESCE(r.review_count, 0) AS review_count, r.average_rating,
                         COALESCE(d.active_documents, 0) AS active_documents """ + joins +
                " ORDER BY u.last_seen_at DESC, u.user_id LIMIT ? OFFSET ?",
                [*values, page_size, (page - 1) * page_size],
            ).fetchall()
        users = [UserRecord(
            id=row["user_id"], name=row["email"].split("@", 1)[0] if row["email"] else f"Guest {row['user_id'][-6:]}",
            email=row["email"], role=row["role"], totalSessions=row["total_sessions"], completedSessions=row["completed_sessions"],
            averageRating=round(row["average_rating"], 2) if row["review_count"] > 0 else None,
            reviewCount=row["review_count"], joinedAt=epoch_iso(row["created_at"]), lastActiveAt=epoch_iso(row["last_seen_at"]),
            suspended=bool(row["is_blocked"]), suspensionReason=row["block_reason"], questions=row["question_count"], activeDocuments=row["active_documents"],
        ) for row in rows]
        return UserPage(users=users, total=total, page=page, pageSize=page_size)

    def user_detail(self, user_id: str) -> UserDetail:
        """Returns only a safe user projection and recent activity, not private chat contents."""
        page = self.users(user_id=user_id)
        if not page.users:
            raise HTTPException(status_code=404, detail="User not found")
        with self.pool.connection() as conn:
            rows = conn.execute(
                """SELECT s.session_id AS id, s.started_at, s.completed_at, s.answers,
                   CASE WHEN r.verified = 1 AND r.user_id = s.user_id AND s.completed_at IS NOT NULL THEN r.stars ELSE NULL END AS stars
                   FROM activity_sessions s LEFT JOIN session_reviews r USING(session_id)
                   WHERE s.user_id = ? ORDER BY s.started_at DESC LIMIT 20""", (user_id,),
            ).fetchall()
        return UserDetail(user=page.users[0], sessions=[{
            "id": row["id"], "startedAt": epoch_iso(row["started_at"]),
            "completedAt": epoch_iso(row["completed_at"]) if row["completed_at"] else None,
            "answers": row["answers"], "stars": row["stars"],
        } for row in rows])

    def suspend(self, user_id: str, suspended: bool, notes: str, actor: str, ip_address: str) -> UserDetail:
        """Changes enforcement state atomically with an audit record and protects all admins."""
        with self.pool.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            user = conn.execute("SELECT role FROM users WHERE user_id = ?", (user_id,)).fetchone()
            if user is None:
                raise HTTPException(status_code=404, detail="User not found")
            if user_id == actor or user["role"] == "admin":
                raise HTTPException(status_code=409, detail="Administrator accounts cannot be suspended here")
            conn.execute("UPDATE users SET is_blocked = ?, block_reason = ? WHERE user_id = ?", (int(suspended), redact(notes) if suspended else None, user_id))
            conn.execute(
                "INSERT INTO audit_events(event_type, user_id, ip_address, severity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("admin_account_suspended" if suspended else "admin_account_restored", actor, ip_address, "high", json.dumps({"target": user_id, "notes": redact(notes)}), int(time.time())),
            )
        return self.user_detail(user_id)

    def persist_incidents(self, incidents: list[Incident]) -> None:
        """Persists critical changes without recursively instrumenting the audit write path."""
        with self.pool.connection(observe=False) as conn:
            conn.executemany("INSERT INTO apm_incidents(id, timestamp, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload", [(item.id, item.timestamp, item.model_dump_json()) for item in incidents])
            # Keep a bounded durable archive as well as the 200-item live ring.
            conn.execute("DELETE FROM apm_incidents WHERE id IN (SELECT id FROM apm_incidents ORDER BY timestamp DESC LIMIT -1 OFFSET 5000)")

    def load_incidents(self) -> list[Incident]:
        """Loads the latest critical audit records while tolerating a damaged individual row."""
        with self.pool.connection(observe=False) as conn:
            rows = conn.execute("SELECT payload FROM apm_incidents ORDER BY timestamp DESC LIMIT 200").fetchall()
        records = []
        for row in rows:
            try:
                records.append(Incident.model_validate_json(row[0]))
            except ValueError:
                continue
        return records

    def persist_report(self, report: HealingReport) -> None:
        """Stores every executed repair report with a bounded durable history."""
        with self.pool.connection(observe=False) as conn:
            conn.execute("INSERT INTO apm_healing_runs(id, timestamp, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload", (report.id, report.startedAt, report.model_dump_json()))
            conn.execute("DELETE FROM apm_healing_runs WHERE id IN (SELECT id FROM apm_healing_runs ORDER BY timestamp DESC LIMIT -1 OFFSET 1000)")

    def reports(self, limit: int = 30) -> list[HealingReport]:
        """Returns persisted, typed repair reports newest first."""
        with self.pool.connection(observe=False) as conn:
            rows = conn.execute("SELECT payload FROM apm_healing_runs ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
        records = []
        for row in rows:
            try:
                records.append(HealingReport.model_validate_json(row[0]))
            except ValueError:
                continue
        return records
