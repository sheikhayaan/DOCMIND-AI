"""Unit tests for the pure retrieval/scoring helpers in query.py.

These tests deliberately avoid any network calls (Groq, Pinecone, HuggingFace).
They exercise only the deterministic logic so they run fast and offline in CI.
"""
import math

import pytest

from query import (
    classify_confidence,
    cosine_similarity,
    keyword_search,
    reciprocal_rank_fusion,
    sanitize_history,
    score_relevance,
)


class FakeChunk:
    """Minimal stand-in for a LangChain Document (page_content + metadata)."""

    def __init__(self, page_content: str, metadata: dict | None = None):
        self.page_content = page_content
        self.metadata = metadata or {}


# --------------------------- cosine_similarity ---------------------------

def test_cosine_identical_vectors_is_one():
    assert cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)


def test_cosine_orthogonal_vectors_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_opposite_vectors_is_negative_one():
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_zero_vector_returns_zero():
    # Guard branch: zero magnitude must short-circuit to 0, not divide-by-zero.
    assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0


def test_cosine_known_value():
    # angle of 45 degrees -> cos = 1/sqrt(2)
    assert cosine_similarity([1.0, 1.0], [1.0, 0.0]) == pytest.approx(1 / math.sqrt(2))


# --------------------------- classify_confidence ---------------------------

@pytest.mark.parametrize(
    "score,expected",
    [
        (0.35, "high"),
        (0.50, "high"),
        (0.34, "medium"),
        (0.20, "medium"),
        (0.19, "low"),
        (0.0, "low"),
    ],
)
def test_classify_confidence_thresholds(score, expected):
    assert classify_confidence(score) == expected


# --------------------------- sanitize_history ---------------------------

def test_sanitize_history_none_returns_empty():
    assert sanitize_history(None) == []


def test_sanitize_history_drops_invalid_roles_and_empty_content():
    history = [
        {"role": "user", "content": "hello"},
        {"role": "system", "content": "should be dropped"},
        {"role": "assistant", "content": "  hi there  "},
        {"role": "user", "content": "   "},  # whitespace only -> dropped
        {"role": "user", "content": 123},  # non-string -> dropped
    ]
    result = sanitize_history(history)
    assert result == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
    ]


def test_sanitize_history_caps_at_last_eight():
    history = [{"role": "user", "content": f"msg {i}"} for i in range(20)]
    result = sanitize_history(history)
    assert len(result) == 8
    assert result[0]["content"] == "msg 12"
    assert result[-1]["content"] == "msg 19"


# --------------------------- keyword_search ---------------------------

def test_keyword_search_empty_query_returns_empty():
    chunks = [FakeChunk("anything", {"doc_id": "d1"})]
    assert keyword_search("", ["d1"], chunks) == []


def test_keyword_search_ranks_by_term_frequency():
    chunks = [
        FakeChunk("apple apple apple", {"doc_id": "d1"}),
        FakeChunk("apple once", {"doc_id": "d1"}),
        FakeChunk("nothing relevant", {"doc_id": "d1"}),
    ]
    result = keyword_search("apple", ["d1"], chunks, top_k=2)
    assert len(result) == 2
    assert result[0].page_content == "apple apple apple"  # highest frequency first


def test_keyword_search_filters_by_doc_id():
    chunks = [
        FakeChunk("apple apple", {"doc_id": "allowed"}),
        FakeChunk("apple apple apple", {"doc_id": "blocked"}),
    ]
    result = keyword_search("apple", ["allowed"], chunks, top_k=5)
    assert len(result) == 1
    assert result[0].metadata["doc_id"] == "allowed"


def test_keyword_search_excludes_zero_score_chunks():
    chunks = [
        FakeChunk("apple", {"doc_id": "d1"}),
        FakeChunk("banana", {"doc_id": "d1"}),
    ]
    result = keyword_search("apple", ["d1"], chunks, top_k=5)
    assert len(result) == 1
    assert result[0].page_content == "apple"


# --------------------------- reciprocal_rank_fusion ---------------------------

def test_rrf_chunk_in_both_lists_outranks_single_list_chunk():
    shared = FakeChunk("shared content")
    vector_only = FakeChunk("vector only")
    keyword_only = FakeChunk("keyword only")

    vector_results = [shared, vector_only]
    keyword_results = [shared, keyword_only]

    fused = reciprocal_rank_fusion(vector_results, keyword_results)
    # 'shared' appears in both lists so its fused score is highest -> first.
    assert fused[0].page_content == "shared content"


def test_rrf_deduplicates_by_content():
    shared = FakeChunk("dup")
    fused = reciprocal_rank_fusion([shared], [FakeChunk("dup")])
    contents = [c.page_content for c in fused]
    assert contents.count("dup") == 1


def test_rrf_skips_empty_content():
    fused = reciprocal_rank_fusion([FakeChunk("")], [FakeChunk("real")])
    assert all(c.page_content for c in fused)
    assert len(fused) == 1


# --------------------------- score_relevance ---------------------------

def test_score_relevance_empty_chunks_returns_zero():
    assert score_relevance("question", []) == 0


def test_score_relevance_uses_pinecone_similarity_score():
    chunks = [
        FakeChunk("text", {"_similarity_score": 0.8}),
        FakeChunk("text", {"_similarity_score": 0.4}),
    ]
    assert score_relevance("anything", chunks) == pytest.approx(0.6)


def test_score_relevance_word_overlap_fallback():
    # No embeddings or similarity scores -> falls back to word overlap ratio.
    chunks = [FakeChunk("the quick brown fox")]
    # query words: {the, lazy} -> overlap {the} = 1/2 = 0.5
    assert score_relevance("the lazy", chunks) == pytest.approx(0.5)


def test_score_relevance_prefers_embedding_cosine_when_present():
    q_emb = [1.0, 0.0]
    chunks = [FakeChunk("text", {"_question_embedding": q_emb, "embedding": [1.0, 0.0]})]
    assert score_relevance("anything", chunks) == pytest.approx(1.0)
