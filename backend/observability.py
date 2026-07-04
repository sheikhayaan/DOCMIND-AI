"""Lightweight observability for the RAG pipeline.

Emits one structured JSON log line per query stage so latency, retrieval
quality, and token usage are visible in the server log and any log aggregator.
Pure stdlib (logging + json + time) so it adds no runtime dependency and never
changes the public API of answer_question().

Usage:
    from observability import QueryTrace

    with QueryTrace(question, doc_ids) as trace:
        trace.mark("rewrite", rewritten_query=rewritten)
        ...
        trace.set_retrieval(vector_count=8, fused_count=4, confidence=0.42)
        trace.set_tokens(prompt_tokens=950, completion_tokens=180)
    # on exit the trace logs total latency + all collected fields
"""
import json
import logging
import time
import uuid

logger = logging.getLogger("rag.trace")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class QueryTrace:
    """Collects timing and quality metrics for a single query, logged as JSON."""

    def __init__(self, question: str, doc_ids: list[str]):
        self.trace_id = str(uuid.uuid4())[:8]
        self.question_len = len(question or "")
        self.doc_count = len(doc_ids or [])
        self.fields: dict = {}
        self.stage_timings: dict[str, float] = {}
        self._start = 0.0
        self._last_mark = 0.0
        self.error: str | None = None

    def __enter__(self) -> "QueryTrace":
        self._start = time.perf_counter()
        self._last_mark = self._start
        return self

    def mark(self, stage: str, **extra) -> None:
        """Records elapsed ms since the previous mark for a named stage."""
        now = time.perf_counter()
        self.stage_timings[stage] = round((now - self._last_mark) * 1000, 1)
        self._last_mark = now
        if extra:
            self.fields.update(extra)

    def set_retrieval(self, **metrics) -> None:
        self.fields.update(metrics)

    def set_tokens(self, prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
        self.fields["prompt_tokens"] = prompt_tokens
        self.fields["completion_tokens"] = completion_tokens
        self.fields["total_tokens"] = prompt_tokens + completion_tokens

    def __exit__(self, exc_type, exc, tb) -> bool:
        total_ms = round((time.perf_counter() - self._start) * 1000, 1)
        if exc is not None:
            self.error = f"{exc_type.__name__}: {exc}"
        record = {
            "trace_id": self.trace_id,
            "event": "query",
            "total_ms": total_ms,
            "question_len": self.question_len,
            "doc_count": self.doc_count,
            "stages_ms": self.stage_timings,
            **self.fields,
        }
        if self.error:
            record["error"] = self.error
        try:
            logger.info(json.dumps(record, default=str))
        except Exception:
            # Observability must never break the request path.
            logger.info("trace_id=%s total_ms=%s (json failed)", self.trace_id, total_ms)
        return False  # never suppress exceptions


def extract_token_usage(response: object) -> tuple[int, int]:
    """Best-effort pull of (prompt_tokens, completion_tokens) from a LangChain response."""
    try:
        meta = getattr(response, "response_metadata", {}) or {}
        usage = meta.get("token_usage") or meta.get("usage") or {}
        prompt = int(usage.get("prompt_tokens", 0))
        completion = int(usage.get("completion_tokens", 0))
        if prompt or completion:
            return prompt, completion
        # Fallback: newer LangChain exposes usage_metadata on the message.
        usage_meta = getattr(response, "usage_metadata", {}) or {}
        return int(usage_meta.get("input_tokens", 0)), int(usage_meta.get("output_tokens", 0))
    except Exception:
        return 0, 0
