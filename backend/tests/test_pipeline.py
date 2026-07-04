"""Tests for the rerank fallback paths and observability trace.

The cross-encoder model itself is not loaded here (that needs a model download);
instead we verify the graceful-degradation contract: empty input, single chunk,
and model-unavailable all return sensible ordering without raising.
"""
import rerank
from observability import QueryTrace, extract_token_usage


class FakeChunk:
    def __init__(self, page_content: str, metadata: dict | None = None):
        self.page_content = page_content
        self.metadata = metadata or {}


# --------------------------- rerank fallbacks ---------------------------

def test_rerank_empty_returns_empty():
    assert rerank.rerank_chunks("q", []) == []


def test_rerank_single_chunk_passthrough():
    chunk = FakeChunk("only one")
    assert rerank.rerank_chunks("q", [chunk], top_k=4) == [chunk]


def test_rerank_falls_back_to_fusion_order_when_model_unavailable(monkeypatch):
    # Force get_reranker() to report the model as unavailable.
    monkeypatch.setattr(rerank, "get_reranker", lambda: None)
    chunks = [FakeChunk(f"chunk {i}") for i in range(6)]
    result = rerank.rerank_chunks("q", chunks, top_k=4)
    # Same order, truncated to top_k.
    assert [c.page_content for c in result] == ["chunk 0", "chunk 1", "chunk 2", "chunk 3"]


def test_rerank_reorders_by_score(monkeypatch):
    # Simulate a model that scores the 3rd chunk highest.
    class FakeModel:
        def predict(self, pairs):
            return [0.1, 0.2, 0.9, 0.05]

    monkeypatch.setattr(rerank, "get_reranker", lambda: FakeModel())
    chunks = [FakeChunk(f"c{i}") for i in range(4)]
    result = rerank.rerank_chunks("q", chunks, top_k=2)
    assert [c.page_content for c in result] == ["c2", "c1"]
    assert chunks[2].metadata["_rerank_score"] == 0.9


def test_rerank_handles_predict_exception(monkeypatch):
    class BrokenModel:
        def predict(self, pairs):
            raise RuntimeError("model exploded")

    monkeypatch.setattr(rerank, "get_reranker", lambda: BrokenModel())
    chunks = [FakeChunk(f"c{i}") for i in range(5)]
    result = rerank.rerank_chunks("q", chunks, top_k=3)
    # Falls back to original order, no exception raised.
    assert [c.page_content for c in result] == ["c0", "c1", "c2"]


# --------------------------- observability ---------------------------

def test_query_trace_records_stages_without_raising():
    with QueryTrace("a question", ["doc1"]) as trace:
        trace.mark("rewrite", rewritten_query="expanded")
        trace.mark("vector_search", vector_count=8)
        trace.set_retrieval(confidence=0.42, confidence_level="high")
        trace.set_tokens(prompt_tokens=900, completion_tokens=120)
    assert trace.fields["total_tokens"] == 1020
    assert trace.fields["vector_count"] == 8
    assert "rewrite" in trace.stage_timings
    assert "vector_search" in trace.stage_timings


def test_query_trace_does_not_suppress_exceptions():
    raised = False
    try:
        with QueryTrace("q", ["d"]):
            raise ValueError("boom")
    except ValueError:
        raised = True
    assert raised  # __exit__ returns False -> exception propagates


def test_extract_token_usage_from_response_metadata():
    class Resp:
        response_metadata = {"token_usage": {"prompt_tokens": 50, "completion_tokens": 10}}

    assert extract_token_usage(Resp()) == (50, 10)


def test_extract_token_usage_missing_returns_zeros():
    class Resp:
        pass

    assert extract_token_usage(Resp()) == (0, 0)
