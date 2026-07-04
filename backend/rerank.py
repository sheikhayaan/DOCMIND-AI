"""Cross-encoder reranking for retrieved chunks.

After hybrid retrieval (vector + keyword) and Reciprocal Rank Fusion, the top
candidates are reordered by a cross-encoder that scores each (query, chunk)
pair jointly. Cross-encoders are far more accurate at relevance judgement than
the bi-encoder used for the initial vector search, so this measurably improves
the final context quality.

Uses sentence-transformers' CrossEncoder (already a project dependency). The
model is cached after first load. Any failure falls back to the original order
so retrieval never breaks because of reranking.
"""
import logging

logger = logging.getLogger("rag.rerank")

# A small, fast, well-regarded reranking model (~80MB, CPU-friendly).
_RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker = None
_load_failed = False


def get_reranker():
    """Lazily loads and caches the CrossEncoder. Returns None if unavailable."""
    global _reranker, _load_failed
    if _reranker is not None:
        return _reranker
    if _load_failed:
        return None
    try:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(_RERANK_MODEL_NAME, max_length=512)
        logger.info("Reranker loaded: %s", _RERANK_MODEL_NAME)
        return _reranker
    except Exception as exc:  # pragma: no cover - depends on environment
        _load_failed = True
        logger.warning("Reranker unavailable, falling back to fusion order: %s", exc)
        return None


def rerank_chunks(query: str, chunks: list, top_k: int = 4) -> list:
    """Reorders chunks by cross-encoder relevance to the query.

    Returns the top_k most relevant chunks. On any failure (or empty input),
    returns the first top_k chunks in their original order.
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
        ranked = sorted(zip(scores, chunks), key=lambda item: item[0], reverse=True)
        for score, chunk in ranked:
            # Surface the rerank score for observability / debugging.
            chunk.metadata["_rerank_score"] = float(score)
        return [chunk for _, chunk in ranked[:top_k]]
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Rerank failed, using fusion order: %s", exc)
        return chunks[:top_k]
