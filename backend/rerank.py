"""
Cross-encoder reranking for retrieved chunks.
"""
import logging
import os

logger = logging.getLogger("rag.rerank")

_RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker = None
_load_failed = False


def get_reranker():
    """Loads the optional CrossEncoder reranker only when explicitly enabled."""
    global _reranker, _load_failed
    if os.getenv("ENABLE_RERANKER", "false").lower() not in {"1", "true", "yes"}:
        return None
    if _reranker is not None:
        return _reranker
    if _load_failed:
        return None
    try:
        from sentence_transformers import CrossEncoder
        _reranker = CrossEncoder(_RERANK_MODEL_NAME, max_length=512)
        logger.info("Reranker loaded: %s", _RERANK_MODEL_NAME)
        return _reranker
    except Exception as exc:
        _load_failed = True
        logger.warning(
            "Reranker unavailable, falling back to fusion order: %s", exc
        )
        return None


def rerank_chunks(query: str, chunks: list, top_k: int = 4) -> list:
    """Returns reranked chunks when enabled, otherwise preserves fusion order."""
    if not chunks:
        return []
    if len(chunks) == 1:
        return chunks[:top_k]
    model = get_reranker()
    if model is None:
        return chunks[:top_k]
    try:
        pairs = [(query, chunk.page_content) for chunk in chunks]
        scores = model.predict(pairs)
        ranked = sorted(
            zip(scores, chunks),
            key=lambda item: item[0],
            reverse=True,
        )
        for score, chunk in ranked:
            chunk.metadata["_rerank_score"] = float(score)
        return [chunk for _, chunk in ranked[:top_k]]
    except Exception as exc:
        logger.warning("Rerank failed, using fusion order: %s", exc)
        return chunks[:top_k]
