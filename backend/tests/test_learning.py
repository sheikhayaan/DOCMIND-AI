"""Unit tests for the autonomous self-learning AI subsystem."""

import pytest
from learning import SelfLearningStore, learning_store


def test_learning_store_initialization(tmp_path):
    """Verifies that the self-learning store initializes its schema cleanly."""
    store = SelfLearningStore(tmp_path / "test_learning.sqlite3")
    stats = store.get_stats("test-engine")
    assert stats.total_exemplars == 0
    assert stats.retrieval_top_k >= 3


def test_session_promotion_and_exemplar_retrieval(tmp_path):
    """Verifies that high-star reviews promote Q&A pairs to few-shot memory."""
    store = SelfLearningStore(tmp_path / "test_learning.sqlite3")
    session_id = "test-session-123"

    store.record_session_qa(
        session_id,
        "What is the total compensation mentioned in the contract?",
        "The total compensation is $180,000 per annum (p. 2).",
        "doc-xyz",
    )

    # 3-star rating should not promote to few-shot memory
    promoted_low = store.promote_session_to_memory(session_id, 3)
    assert promoted_low == 0
    assert store.get_stats().total_exemplars == 0

    # 5-star rating promotes to few-shot memory
    promoted_high = store.promote_session_to_memory(session_id, 5)
    assert promoted_high == 1
    assert store.get_stats().total_exemplars == 1

    # Exemplar retrieval returns the matching Q&A
    exemplars = store.get_relevant_exemplars("tell me about the compensation and salary")
    assert len(exemplars) == 1
    assert "compensation" in exemplars[0]["question"].lower()
    assert "$180,000" in exemplars[0]["answer"]


def test_learning_consolidation_and_tuning(tmp_path):
    """Verifies that consolidation evaluates exemplars and calibrates parameters."""
    store = SelfLearningStore(tmp_path / "test_learning.sqlite3")
    store.record_direct_exemplar(
        "How is authentication handled?",
        "Authentication uses JWT Bearer tokens with HMAC signing (p. 1).",
        "doc-1",
        score=1.0,
        stars=5,
    )

    result = store.consolidate_learning("gemini-2.5-flash")
    assert result.status == "success"
    assert result.exemplars_evaluated == 1
    assert result.active_engine == "gemini-2.5-flash"
