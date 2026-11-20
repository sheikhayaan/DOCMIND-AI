"""Adversarial stress-testing suite for RAG AI chatbot.

Tests upstream error diagnostic extraction, multimodal vision payloads,
and concurrent database execution under WAL mode.
"""

import concurrent.futures
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models import QueryRequest
from query import handle_upstream_error, answer_question
from security import security_store


def test_upstream_429_quota_error_diagnostic():
    """Verifies that upstream rate limit / quota exhaustion produces actionable billing guidance."""
    raw_error = Exception("Error code: 429 - {'error': {'message': 'Rate limit reached or quota exceeded', 'type': 'insufficient_quota'}}")
    http_exc = handle_upstream_error(raw_error)
    assert http_exc.status_code == 429
    assert "quota exhausted" in http_exc.detail.lower()
    assert "https://console.groq.com/settings/limits" in http_exc.detail


def test_upstream_401_invalid_key_diagnostic():
    """Verifies that invalid or revoked upstream keys produce clear authentication diagnostics."""
    raw_error = Exception("Error code: 401 - {'error': {'message': 'Invalid API Key', 'type': 'invalid_request_error'}}")
    http_exc = handle_upstream_error(raw_error)
    assert http_exc.status_code == 401
    assert "invalid or revoked api key" in http_exc.detail.lower()


def test_upstream_413_payload_too_large_diagnostic():
    """Verifies that context length / payload errors produce clear model size warnings."""
    raw_error = Exception("Error code: 413 - {'error': {'message': 'Context length exceeded', 'type': 'context_length_exceeded'}}")
    http_exc = handle_upstream_error(raw_error)
    assert http_exc.status_code == 413
    assert "context window" in http_exc.detail.lower()


def test_upstream_503_service_unavailable_diagnostic():
    """Verifies that upstream provider outages produce clear retry recommendations."""
    raw_error = Exception("503 Service Unavailable: Connection error with Groq API")
    http_exc = handle_upstream_error(raw_error)
    assert http_exc.status_code == 503
    assert "temporarily unreachable" in http_exc.detail.lower()


def test_multimodal_valid_data_urls():
    """Verifies that PNG, JPEG, and WebP data URLs pass QueryRequest schema validation."""
    valid_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    valid_jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
    valid_webp = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="

    req_png = QueryRequest(question="Analyze this PNG chart", doc_ids=["doc_1"], image=valid_png)
    assert req_png.image == valid_png

    req_jpg = QueryRequest(question="Analyze this JPEG diagram", doc_ids=["doc_1"], image=valid_jpeg)
    assert req_jpg.image == valid_jpeg

    req_webp = QueryRequest(question="Analyze this WebP screenshot", doc_ids=["doc_1"], image=valid_webp)
    assert req_webp.image == valid_webp


def test_multimodal_rejects_non_image_data_urls():
    """Verifies that non-image MIME types and raw strings are rejected."""
    with pytest.raises(ValidationError):
        QueryRequest(
            question="Analyze this script",
            doc_ids=["doc_1"],
            image="data:text/plain;base64,SGVsbG8=",
        )

    with pytest.raises(ValidationError):
        QueryRequest(
            question="Analyze this raw path",
            doc_ids=["doc_1"],
            image="https://example.com/malicious.exe",
        )


def test_sqlite_wal_mode_active():
    """Verifies that SecurityStore connects with WAL journal mode enabled."""
    with security_store.lock, security_store._connect() as conn:
        row = conn.execute("PRAGMA journal_mode").fetchone()
        assert row[0].upper() == "WAL"


def test_sqlite_concurrency_stress():
    """Verifies that concurrent threads writing to SecurityStore do not trigger database lock failures."""
    def record_dummy_activity(user_suffix: int):
        user_id = f"usr_stress_{user_suffix}"
        security_store.upsert_user(user_id=user_id, email=f"stress_{user_suffix}@example.com", role="user")
        security_store.record_device(
            user_id=user_id,
            ip_address=f"10.0.0.{user_suffix % 250}",
            user_agent="Mozilla/5.0 (Adversarial Stress Test)"
        )
        return True

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(record_dummy_activity, i) for i in range(25)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
        assert all(results)
        assert len(results) == 25
