"""Tests for self-healing engine, exact page preservation, and deictic page queries."""
import pytest
from self_healing import self_healing_engine, SelfHealingEngine
from query import extract_page_numbers, DEICTIC_PAGE_PATTERN


def test_extract_page_numbers_deictic():
    # Verifies deictic queries like 'content of this page' default to page 1 or conversational page context.
    assert DEICTIC_PAGE_PATTERN.search("give content of this page in pdf") is not None
    assert DEICTIC_PAGE_PATTERN.search("what is on this page") is not None
    assert DEICTIC_PAGE_PATTERN.search("summarize the first page") is not None

    pages = extract_page_numbers("give content of this page in pdf")
    assert pages == [1]

    pages_explicit = extract_page_numbers("tell me about page 3 and page 5")
    assert pages_explicit == [3, 5]


def test_exact_page_save_and_retrieve(tmp_path):
    # Verifies that exact page text is durably stored and retrievable without vector distortion.
    db_path = str(tmp_path / "test_healing.sqlite3")
    engine = SelfHealingEngine(db_path=db_path)

    doc_id = "doc_test_123"
    filename = "test_document.pdf"
    pages = {
        1: "This is the exact verbatim text of page 1 with confidential metrics.",
        2: "Second page details describing system architecture.",
    }
    chunks = [
        {"chunk_id": "c1", "page": 1, "chunk_index": 0, "text": "This is the exact verbatim text"},
        {"chunk_id": "c2", "page": 2, "chunk_index": 0, "text": "Second page details"},
    ]

    engine.save_pages_and_chunks(doc_id, filename, pages, chunks)

    # Retrieval
    text_p1 = engine.get_exact_page_text(doc_id, 1)
    assert text_p1 == pages[1]

    text_p2 = engine.get_exact_page_text(doc_id, 2)
    assert text_p2 == pages[2]

    # Non-existent page
    text_p99 = engine.get_exact_page_text(doc_id, 99)
    assert text_p99 is None

    # Available pages
    avail = engine.get_all_page_numbers(doc_id)
    assert avail == [1, 2]

    # Delete
    engine.delete_document_pages(doc_id)
    assert engine.get_exact_page_text(doc_id, 1) is None
    assert engine.get_all_page_numbers(doc_id) == []


def test_self_healing_telemetry_and_patches(tmp_path):
    # Tests autonomous query telemetry recording and health status reporting.
    db_path = str(tmp_path / "test_healing_telemetry.sqlite3")
    engine = SelfHealingEngine(db_path=db_path)

    # Initial status
    status = engine.get_status()
    assert status.health_score >= 95.0
    assert len(status.active_patches) >= 5

    # Record normal telemetry
    engine.record_query_telemetry(
        question="What is this document about?",
        doc_id="doc_abc",
        confidence="high",
        answer_source="document",
        had_error=False,
    )

    # Record error telemetry
    engine.record_query_telemetry(
        question="Give content of page 44",
        doc_id="doc_abc",
        confidence="low",
        answer_source="fallback",
        had_error=True,
        error_message="Page out of bounds",
    )

    # Check updated telemetry
    status2 = engine.get_status()
    assert status2.health_score >= 90.0
    assert len(status2.active_patches) >= 5
