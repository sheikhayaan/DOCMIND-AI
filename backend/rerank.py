"""
Cross-encoder reranking for retrieved chunks.
Disabled on memory-constrained environments (under 512MB RAM).
Falls back to fusion order automatically.
"""
import logging
import os

logger = logging.getLogger("rag.rerank")

_RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker = None
_load_failed = False


def is_low_memory() -> bool:
    """Returns True if we're running in a low-memory environment."""
    # Render free tier sets this, or we can check via env variable
    render_env = os.getenv("RENDER", "")
    low_memory = os.getenv("LOW_MEMORY", "")
    return bool(render_env or low_memory)


def get_reranker():
    """Lazily loads and caches the CrossEncoder.
    Returns None if unavailable or in low-memory environment."""
    global _reranker, _load_failed

    # Skip reranker entirely on memory-constrained environments
    if is_low_memory():
        logger.info("Low memory environment detected — skipping reranker")
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
    """Reorders chunks by cross-encoder relevance to the query.
    Returns the top_k most relevant chunks. On any failure (or empty
    input), returns the first top_k chunks in their original order.
    """
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