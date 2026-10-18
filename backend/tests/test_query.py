"""Unit tests for the pure retrieval/scoring helpers in query.py.

These tests deliberately avoid any network calls (Groq, Pinecone, HuggingFace).
They exercise only the deterministic logic so they run fast and offline in CI.
"""
import math

import pytest

from query import (
    classify_confidence,
    cosine_similarity,
    is_document_overview,
    is_probably_gibberish,
    is_pure_general_answer,
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
    # Top-weighted blend: 0.7 * best + 0.3 * mean, so strong evidence counts most.
    assert score_relevance("anything", chunks) == pytest.approx(0.74)


def test_score_relevance_word_overlap_fallback():
    # No embeddings or similarity scores -> falls back to word overlap ratio.
    chunks = [FakeChunk("the quick brown fox")]
    # query words: {the, lazy} -> overlap {the} = 1/2 = 0.5
    assert score_relevance("the lazy", chunks) == pytest.approx(0.5)


def test_score_relevance_prefers_embedding_cosine_when_present():
    q_emb = [1.0, 0.0]
    chunks = [FakeChunk("text", {"_question_embedding": q_emb, "embedding": [1.0, 0.0]})]
    assert score_relevance("anything", chunks) == pytest.approx(1.0)


# --------------------------- document overview intent ---------------------------

@pytest.mark.parametrize(
    "question",
    [
        "what is this document about",
        "What is this PDF about?",
        "what's this about",
        "summarize this document",
        "Summarize this",
        "give me a quick summary",
        "give me an overview of the file",
        "what are the main topics",
        "tell me about this document",
        "What does the document say?",
    ],
)
def test_document_overview_questions_are_detected(question):
    assert is_document_overview(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "What is the Project Atlas marketing budget?",
        "Explain the TLS handshake in simple terms.",
        "Summarize the TLS handshake",
        "summarize the key differences between TCP and UDP",
        "What does the report say about revenue?",
        "Tell me about the budget in the document",
        "Explain the main points of TLS",
        "Who is the project lead?",
        "What is the total revenue on page 3?",
    ],
)
def test_specific_questions_are_not_treated_as_overviews(question):
    assert is_document_overview(question) is False


# ----------------------- answer-source labelling -----------------------

def test_pure_general_answer_is_detected():
    answer = "## General knowledge\n_Not from the uploaded document._\nThe TLS handshake..."
    assert is_pure_general_answer(answer) is True


def test_grounded_answer_is_not_labelled_general():
    answer = "The budget is $4.2 million (p. 3).\n**Bottom line:** shipped."
    assert is_pure_general_answer(answer) is False


def test_mixed_answer_keeps_document_sources():
    answer = (
        "The document covers TLS 1.2 (p. 4).\n"
        "## General knowledge\n_Not from the uploaded document._\nTLS 1.3 is newer."
    )
    assert is_pure_general_answer(answer) is False


# ---------------------------- gibberish guard ----------------------------

@pytest.mark.parametrize("text", ["asdfgh", "qwerty", "zzzzzzzz", "sdfgsdfg"])
def test_keyboard_mash_is_flagged_as_gibberish(text):
    assert is_probably_gibberish(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "What is the budget?",
        "TLS",
        "GDPR compliance",
        "Tell me about Project Aurora",
        "summarize this document",
    ],
)
def test_real_questions_are_not_flagged_as_gibberish(text):
    assert is_probably_gibberish(text) is False


# ----------------------- page and metadata routing -----------------------

from query import (  # noqa: E402 - grouped with the page/metadata tests below
    collect_page_chunks,
    extract_page_numbers,
    generate_metadata_answer,
    is_document_deictic,
    is_document_follow_up,
    is_file_metadata_question,
    is_page_count_question,
    sanitize_page_citations,
)


@pytest.mark.parametrize(
    "question,expected",
    [
        ("what is written on page 7", [7]),
        ("summarize pages 2 to 4", [2, 3, 4]),
        ("show p. 3", [3]),
        ("page number 12", [12]),
        ("what is on pages 5-6", [5, 6]),
        ("explain page 10 and page 11", [10, 11]),
        ("what is this about", []),
        ("how many pages are there in this pdf", []),
    ],
)
def test_extract_page_numbers(question, expected):
    assert extract_page_numbers(question) == expected


@pytest.mark.parametrize(
    "question,expected",
    [
        ("how many pages are there in this pdf", True),
        ("what is the page count?", True),
        ("total pages in the document", True),
        ("what is written on page 7", False),
        ("summarize this document", False),
    ],
)
def test_page_count_intent(question, expected):
    assert is_page_count_question(question) is expected


@pytest.mark.parametrize(
    "question,expected",
    [
        ("what is the file name", True),
        ("how big is this pdf", True),
        ("when was this document uploaded", True),
        ("what is written on page 7", False),
    ],
)
def test_file_metadata_intent(question, expected):
    assert is_file_metadata_question(question) is expected


def test_vague_follow_up_needs_history_and_document_reference():
    history = [{"role": "user", "content": "what is this about"}]
    assert is_document_follow_up("more about pdf in short", history) is True
    assert is_document_follow_up("more about pdf in short", None) is False
    assert is_document_follow_up("what is the TLS handshake", history) is False


def test_sanitize_page_citations_drops_retrieved_page_numbers_not_in_sources():
    answer = "A (p. 2), B (p. 15), on page 4, on page 18."
    cleaned = sanitize_page_citations(answer, {2, 4})
    assert "(p. 2)" in cleaned
    assert "(p. 15)" not in cleaned
    assert "on page 4" in cleaned
    assert "on page 18" not in cleaned


def test_page_count_answer_uses_stored_metadata(monkeypatch):
    monkeypatch.setattr(
        "query.get_document_stats",
        lambda doc_id, index_name: {
            "filename": "guide.pdf",
            "page_count": 19,
            "chunk_count": 37,
        },
    )
    monkeypatch.setattr(
        "security.security_store.get_document_by_id",
        lambda doc_id: {"filename": "guide.pdf", "file_size": 2048, "created_at": 0},
    )
    answer = generate_metadata_answer("how many pages are there", ["d1"], "idx")
    assert "19 pages" in answer
    assert "guide.pdf" in answer


def test_collect_page_chunks_keeps_only_requested_page(monkeypatch):
    import query

    chunks = [
        FakeChunk("page two text", {"doc_id": "d1", "page": 2, "chunk_index": 0}),
        FakeChunk("page seven text", {"doc_id": "d1", "page": 7, "chunk_index": 0}),
        FakeChunk("page eight text", {"doc_id": "d1", "page": 8, "chunk_index": 0}),
    ]
    monkeypatch.setitem(query.LOCAL_DOC_CHUNKS, "d1", chunks)
    result = collect_page_chunks(["d1"], None, [0.0], [7])
    assert [chunk.metadata["page"] for chunk in result] == [7]
    assert result[0].page_content == "page seven text"


@pytest.mark.parametrize(
    "question,expected",
    [
        ("more about pdf in short", True),
        ("tell me more about it", True),
        ("summarize the document briefly", True),
        ("what is the PDF file format", False),
        ("history of the PDF format", False),
        ("Summarize the TLS handshake", False),
        ("what is a pdf", False),
    ],
)
def test_deictic_document_reference(question, expected):
    assert is_document_deictic(question) is expected


def test_keyword_search_ignores_stopwords_when_ranking_evidence():
    chunks = [
        FakeChunk("Chapter 6 says the data in the split is the same", {"doc_id": "d1"}),
        FakeChunk("PAGE FOUR BUDGET: the quarterly budget is four million dollars", {"doc_id": "d1"}),
    ]
    result = keyword_search("Tell me about the budget in the document", ["d1"], chunks, top_k=1)
    assert len(result) == 1
    assert "BUDGET" in result[0].page_content


def test_page_citation_sanitizer_rejects_partially_retrieved_range():
    text = "A claim (pp. 3-5) and another (p. 4)."
    cleaned = sanitize_page_citations(text, {3, 5})
    assert "pp. 3-5" not in cleaned
    assert "(see sources)" in cleaned
    assert "(p. 4)" not in cleaned


def test_page_citation_sanitizer_keeps_fully_retrieved_range():
    text = "A claim (pp. 3-5)."
    assert sanitize_page_citations(text, {3, 4, 5}) == text
