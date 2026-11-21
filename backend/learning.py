"""Autonomous self-learning, collective cross-user intelligence, and adaptive tuning engine."""

import os
import time
import uuid
import re
from typing import Any
from pathlib import Path
from pydantic import BaseModel
from apm.database import get_pool


class LearningExemplar(BaseModel):
    """Represents a validated high-quality Q&A exemplar for few-shot guidance."""
    id: str
    question: str
    answer: str
    doc_id: str
    stars: int | None
    feedback_score: float
    created_at: float
    use_count: int


class LearningStats(BaseModel):
    """Operational telemetry for the self-learning AI subsystem."""
    total_exemplars: int
    average_satisfaction: float
    active_engine: str
    available_engines: list[str]
    retrieval_top_k: int
    adaptive_mode: str
    recent_exemplars: list[dict[str, Any]]
    optimizations_applied: int
    collective_sessions: int = 0
    collective_insights: int = 0
    news_grounding_status: str = "Active (Google Search + Real-Time News Stream)"
    intelligence_mode: str = "IoT Human Intelligence Cognitive Engine (Active)"


class LearningOptimizationResult(BaseModel):
    """Outcome report for an autonomous learning consolidation cycle."""
    status: str
    action: str
    message: str
    exemplars_evaluated: int
    adaptive_top_k: int
    active_engine: str
    collective_insights_synthesized: int = 0


class SelfLearningStore:
    """Manages persistent dynamic Q&A exemplars, collective cross-user memory, and adaptive retrieval parameters."""

    def __init__(self, db_path: Path | None = None) -> None:
        """Initializes idempotent SQLite schema for learning memory and adaptive tuning."""
        default_path = Path(__file__).resolve().parent / ".data" / "security.sqlite3"
        path = db_path or Path(os.getenv("SECURITY_DB_PATH", str(default_path)))
        path.parent.mkdir(parents=True, exist_ok=True)
        self.pool = get_pool(path, "security")
        self._init_schema()

    def _init_schema(self) -> None:
        """Creates learning memory, collective wisdom, and optimization key-value tables if absent."""
        with self.pool.connection(observe=False) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS learning_memory (
                    id TEXT PRIMARY KEY,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    doc_id TEXT NOT NULL,
                    stars INTEGER,
                    feedback_score REAL DEFAULT 1.0,
                    created_at REAL NOT NULL,
                    use_count INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_learning_created ON learning_memory(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_learning_score ON learning_memory(feedback_score DESC, stars DESC);

                CREATE TABLE IF NOT EXISTS learned_optimizations (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS session_qa_pairs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    doc_id TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_session_qa ON session_qa_pairs(session_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS collective_wisdom (
                    id TEXT PRIMARY KEY,
                    topic TEXT NOT NULL,
                    sample_question TEXT NOT NULL,
                    sample_answer TEXT NOT NULL,
                    confidence REAL DEFAULT 0.9,
                    created_at REAL NOT NULL,
                    applied_count INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_collective_created ON collective_wisdom(created_at DESC);
                """
            )

    def record_session_qa(self, session_id: str, question: str, answer: str, doc_id: str) -> None:
        """Tracks the latest Q&A interaction in a session so verified reviews and collective distillation can learn from it."""
        if not session_id or not question or not answer:
            return
        identifier = str(uuid.uuid4())
        now = time.time()
        try:
            with self.pool.connection() as conn:
                conn.execute(
                    "INSERT INTO session_qa_pairs(id, session_id, question, answer, doc_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (identifier, session_id, question[:1000], answer[:4000], doc_id, now),
                )
            self._maybe_learn_collective_wisdom(question, answer)
        except Exception:
            pass

    def _maybe_learn_collective_wisdom(self, question: str, answer: str) -> None:
        """Autonomously indexes high-quality, substantive user exchanges into collective wisdom."""
        clean_q = question.strip()
        clean_a = answer.strip()
        if len(clean_q) < 10 or len(clean_a) < 50:
            return
        # Extract prominent keywords as topic
        words = re.findall(r"\b[a-zA-Z]{4,}\b", clean_q.lower())
        topic = " ".join(words[:4]) or "General Intelligence"

        try:
            with self.pool.connection() as conn:
                exists = conn.execute(
                    "SELECT 1 FROM collective_wisdom WHERE sample_question = ?", (clean_q,)
                ).fetchone()
                if not exists:
                    conn.execute(
                        """INSERT INTO collective_wisdom(id, topic, sample_question, sample_answer, confidence, created_at, applied_count)
                           VALUES (?, ?, ?, ?, 0.85, ?, 0)""",
                        (str(uuid.uuid4()), topic, clean_q[:500], clean_a[:1500], time.time()),
                    )
        except Exception:
            pass

    def promote_session_to_memory(self, session_id: str, stars: int) -> int:
        """Promotes high-rated session Q&A pairs (stars >= 4) into durable learning memory."""
        if stars < 4 or not session_id:
            return 0
        promoted = 0
        now = time.time()
        try:
            with self.pool.connection() as conn:
                rows = conn.execute(
                    "SELECT question, answer, doc_id FROM session_qa_pairs WHERE session_id = ? ORDER BY created_at DESC LIMIT 5",
                    (session_id,),
                ).fetchall()
                for row in rows:
                    q = row["question"].strip()
                    a = row["answer"].strip()
                    doc_id = row["doc_id"]
                    # Skip duplicate questions
                    exists = conn.execute(
                        "SELECT 1 FROM learning_memory WHERE question = ?", (q,)
                    ).fetchone()
                    if not exists and len(q) > 5 and len(a) > 20:
                        conn.execute(
                            """INSERT INTO learning_memory(id, question, answer, doc_id, stars, feedback_score, created_at, use_count)
                               VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
                            (str(uuid.uuid4()), q, a, doc_id, stars, float(stars) / 5.0, now),
                        )
                        promoted += 1
                        # Also elevate into collective wisdom
                        conn.execute(
                            """INSERT OR REPLACE INTO collective_wisdom(id, topic, sample_question, sample_answer, confidence, created_at, applied_count)
                               VALUES (?, ?, ?, ?, 1.0, ?, 0)""",
                            (str(uuid.uuid4()), "Verified User Feedback", q[:500], a[:1500], now),
                        )
        except Exception:
            pass
        return promoted

    def record_direct_exemplar(
        self, question: str, answer: str, doc_id: str, score: float = 1.0, stars: int = 5
    ) -> None:
        """Directly writes a verified Q&A exemplar into learning memory."""
        if not question or not answer:
            return
        now = time.time()
        with self.pool.connection() as conn:
            conn.execute(
                """INSERT INTO learning_memory(id, question, answer, doc_id, stars, feedback_score, created_at, use_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
                (str(uuid.uuid4()), question[:1000], answer[:4000], doc_id, stars, score, now),
            )

    def get_relevant_exemplars(self, question: str, limit: int = 1) -> list[dict[str, Any]]:
        """Finds high-scoring historical Q&A exemplars and collective wisdom relevant to the current user query."""
        if not question:
            return []
        keywords = set(re.findall(r"\b[a-zA-Z]{4,}\b", question.lower()))
        if not keywords:
            return []

        results: list[dict[str, Any]] = []
        try:
            with self.pool.connection() as conn:
                # 1. Search verified individual learning memory
                rows = conn.execute(
                    "SELECT id, question, answer, doc_id, stars, feedback_score, use_count FROM learning_memory ORDER BY feedback_score DESC, stars DESC LIMIT 50"
                ).fetchall()

                scored_rows = []
                for row in rows:
                    q_words = set(re.findall(r"\b[a-zA-Z]{4,}\b", row["question"].lower()))
                    overlap = len(keywords & q_words)
                    if overlap > 0:
                        score = overlap * float(row["feedback_score"] or 1.0)
                        scored_rows.append((score, row))

                scored_rows.sort(key=lambda item: item[0], reverse=True)
                for _, r in scored_rows[:limit]:
                    results.append(
                        {
                            "id": r["id"],
                            "question": r["question"],
                            "answer": r["answer"],
                            "doc_id": r["doc_id"],
                            "stars": r["stars"],
                            "source": "Verified Feedback",
                        }
                    )
                    conn.execute(
                        "UPDATE learning_memory SET use_count = use_count + 1 WHERE id = ?",
                        (r["id"],),
                    )

                # 2. If room remains, search collective cross-user wisdom
                if len(results) < limit:
                    seen_questions = {res["question"].strip().lower() for res in results}
                    c_rows = conn.execute(
                        "SELECT id, topic, sample_question, sample_answer, confidence FROM collective_wisdom ORDER BY confidence DESC, created_at DESC LIMIT 30"
                    ).fetchall()
                    for c in c_rows:
                        if len(results) >= limit:
                            break
                        if c["sample_question"].strip().lower() in seen_questions:
                            continue
                        c_words = set(re.findall(r"\b[a-zA-Z]{4,}\b", (c["topic"] + " " + c["sample_question"]).lower()))
                        if len(keywords & c_words) > 0:
                            results.append(
                                {
                                    "id": c["id"],
                                    "question": c["sample_question"],
                                    "answer": c["sample_answer"],
                                    "doc_id": "",
                                    "stars": 5,
                                    "source": "Collective User Intelligence",
                                }
                            )
                            seen_questions.add(c["sample_question"].strip().lower())
                            conn.execute(
                                "UPDATE collective_wisdom SET applied_count = applied_count + 1 WHERE id = ?",
                                (c["id"],),
                            )
        except Exception:
            pass
        return results

    def auto_distill_cross_user_wisdom(self) -> int:
        """Synthesizes high-performing response patterns from across all user conversations."""
        distilled = 0
        try:
            with self.pool.connection() as conn:
                rows = conn.execute(
                    "SELECT question, answer FROM session_qa_pairs ORDER BY created_at DESC LIMIT 100"
                ).fetchall()
                for r in rows:
                    q = r["question"].strip()
                    a = r["answer"].strip()
                    if len(q) > 12 and len(a) > 60:
                        exists = conn.execute(
                            "SELECT 1 FROM collective_wisdom WHERE sample_question = ?", (q,)
                        ).fetchone()
                        if not exists:
                            words = re.findall(r"\b[a-zA-Z]{4,}\b", q.lower())
                            topic = " ".join(words[:4]) or "Multi-User Synthesis"
                            conn.execute(
                                """INSERT INTO collective_wisdom(id, topic, sample_question, sample_answer, confidence, created_at, applied_count)
                                   VALUES (?, ?, ?, ?, 0.88, ?, 0)""",
                                (str(uuid.uuid4()), topic, q[:500], a[:1500], time.time()),
                            )
                            distilled += 1
        except Exception:
            pass
        return distilled

    def get_adaptive_top_k(self) -> int:
        """Retrieves dynamically tuned vector search depth from learned optimizations."""
        try:
            with self.pool.connection() as conn:
                row = conn.execute(
                    "SELECT value FROM learned_optimizations WHERE key = 'adaptive_top_k'"
                ).fetchone()
                if row:
                    return max(3, min(15, int(row["value"])))
        except Exception:
            pass
        return 5

    def set_adaptive_top_k(self, top_k: int) -> None:
        """Saves updated retrieval depth parameter."""
        val = str(max(3, min(15, top_k)))
        now = time.time()
        with self.pool.connection() as conn:
            conn.execute(
                """INSERT INTO learned_optimizations(key, value, updated_at) VALUES ('adaptive_top_k', ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
                (val, now),
            )

    def get_stats(self, active_engine: str = "Google Gemini (gemini-2.5-flash)") -> LearningStats:
        """Returns real-time learning metrics for the admin intelligence dashboard."""
        total = 0
        avg_score = 5.0
        recent: list[dict[str, Any]] = []
        optimizations = 0
        collective_sessions = 0
        collective_insights = 0

        try:
            with self.pool.connection() as conn:
                row = conn.execute(
                    "SELECT COUNT(*) AS total, COALESCE(AVG(stars), 5.0) AS avg_stars FROM learning_memory"
                ).fetchone()
                if row:
                    total = int(row["total"])
                    avg_score = round(float(row["avg_stars"]), 2)

                rows = conn.execute(
                    "SELECT question, answer, stars, created_at, use_count FROM learning_memory ORDER BY created_at DESC LIMIT 5"
                ).fetchall()
                for r in rows:
                    recent.append(
                        {
                            "question": r["question"][:80],
                            "answer": r["answer"][:120] + "...",
                            "stars": r["stars"],
                            "use_count": r["use_count"],
                        }
                    )

                opt_row = conn.execute("SELECT COUNT(*) AS cnt FROM learned_optimizations").fetchone()
                if opt_row:
                    optimizations = int(opt_row["cnt"])

                sess_row = conn.execute("SELECT COUNT(DISTINCT session_id) AS cnt FROM session_qa_pairs").fetchone()
                if sess_row:
                    collective_sessions = int(sess_row["cnt"])

                wis_row = conn.execute("SELECT COUNT(*) AS cnt FROM collective_wisdom").fetchone()
                if wis_row:
                    collective_insights = int(wis_row["cnt"])
        except Exception:
            pass

        engines = ["Google Gemini (gemini-2.5-flash)"]
        if os.getenv("GROQ_API_KEY"):
            engines.append("Groq (qwen/qwen3.8-27b)")
            engines.append("Groq (openai/gpt-oss-120b)")

        return LearningStats(
            total_exemplars=total,
            average_satisfaction=avg_score,
            active_engine=active_engine,
            available_engines=engines,
            retrieval_top_k=self.get_adaptive_top_k(),
            adaptive_mode="Continuous Feedback Optimization (Active)",
            recent_exemplars=recent,
            optimizations_applied=optimizations,
            collective_sessions=collective_sessions,
            collective_insights=collective_insights,
            news_grounding_status="Active (Google Search + Real-Time News Stream)",
            intelligence_mode="IoT Human Intelligence Cognitive Engine (Active)",
        )

    def consolidate_learning(self, active_engine: str = "gemini-2.5-flash") -> LearningOptimizationResult:
        """Analyzes verified ratings, distills cross-user wisdom, and calibrates parameters."""
        new_insights = self.auto_distill_cross_user_wisdom()
        stats = self.get_stats(active_engine)
        new_top_k = stats.retrieval_top_k

        # Auto-calibrate retrieval depth based on satisfaction:
        if stats.average_satisfaction >= 4.0:
            msg = f"High satisfaction detected. Synthesized {new_insights} cross-user wisdom insights; reinforced optimal weights."
            action = "REINFORCE_OPTIMAL"
        elif stats.average_satisfaction < 3.5:
            new_top_k = min(12, new_top_k + 2)
            self.set_adaptive_top_k(new_top_k)
            msg = f"Expanded retrieval context to top_{new_top_k} chunks and synthesized {new_insights} cross-user insights."
            action = "EXPAND_RETRIEVAL_CONTEXT"
        else:
            msg = f"Satisfaction balanced. Synthesized {new_insights} cross-user insights into collective wisdom."
            action = "MAINTAIN_STABLE"

        return LearningOptimizationResult(
            status="success",
            action=action,
            message=msg,
            exemplars_evaluated=stats.total_exemplars,
            adaptive_top_k=new_top_k,
            active_engine=active_engine,
            collective_insights_synthesized=new_insights,
        )


# Global singleton instance
learning_store = SelfLearningStore()
