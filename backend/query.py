import os
import re

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
try:
    from langchain_pinecone import PineconeVectorStore
except ImportError:
    from langchain_pinecone import Pinecone as PineconeVectorStore

from ingest import DOC_METADATA
from observability import QueryTrace, extract_token_usage
from rerank import rerank_chunks

load_dotenv()

_embeddings_model = None
SYSTEM_PROMPT = (
    "You are a precise, polished RAG assistant for PDF question answering. "
    "Answer using ONLY the provided document context. If the answer is not "
    "supported by the context, say 'I could not find this information in the "
    "document.' Do not guess or add outside knowledge. Write in a clear, "
    "well-structured style: start with the direct answer, then add concise "
    "supporting details when useful. Use bullets or short sections for "
    "multi-part answers. Mention page numbers when the context provides them. "
    "Keep the answer beautiful, readable, and focused on the user's question."
)
REWRITE_SYSTEM_PROMPT = (
    "You are a semantic search query optimizer for a RAG chatbot. Rewrite the "
    "user's question as one short natural-language search query for document "
    "chunks. Preserve the user's intent and important nouns. Do not write SQL, "
    "code, filters, Boolean syntax, or explanations. Return ONLY the rewritten "
    "query."
)


def get_embeddings():
    global _embeddings_model
    if _embeddings_model is None:
        _embeddings_model = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings_model


def cosine_similarity(vector_a: list[float], vector_b: list[float]) -> float:
    dot_product = sum(a * b for a, b in zip(vector_a, vector_b))
    magnitude_a = sum(a * a for a in vector_a) ** 0.5
    magnitude_b = sum(b * b for b in vector_b) ** 0.5
    if magnitude_a == 0 or magnitude_b == 0:
        return 0
    return dot_product / (magnitude_a * magnitude_b)


def score_relevance(question: str, chunks: list) -> float:
    if not chunks:
        return 0

    scores = []
    for chunk in chunks:
        question_embedding = chunk.metadata.get("_question_embedding")
        chunk_embedding = chunk.metadata.get("embedding") or chunk.metadata.get("_embedding")
        if question_embedding and chunk_embedding:
            scores.append(cosine_similarity(question_embedding, chunk_embedding))
            continue

        pinecone_score = chunk.metadata.get("_similarity_score")
        if pinecone_score is not None:
            scores.append(float(pinecone_score))

    if scores:
        return sum(scores) / len(scores)

    query_words = set(re.findall(r"\b\w+\b", question.lower()))
    if not query_words:
        return 0

    overlap_scores = []
    for chunk in chunks:
        chunk_words = set(re.findall(r"\b\w+\b", chunk.page_content.lower()))
        overlap_scores.append(len(query_words & chunk_words) / len(query_words))

    return sum(overlap_scores) / len(overlap_scores)


def classify_confidence(score: float) -> str:
    if score >= 0.22:
        return "high"
    if score >= 0.12:
        return "medium"
    return "low"


def sanitize_history(history: list[dict] | None) -> list[dict]:
    if not history:
        return []

    sanitized_messages = []
    for message in history:
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        if not content.strip():
            continue
        sanitized_messages.append({"role": role, "content": content.strip()})

    return sanitized_messages[-8:]


def get_llm_content(response: object) -> str:
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content
    return str(content)


# Detects generated rewrites that look like database syntax instead of search text.
def is_invalid_rewrite(rewritten_query: str) -> bool:
    normalized = rewritten_query.strip().lower()
    sql_markers = ("select ", " from ", " where ", " contains ", "vector_similarity")
    return any(marker in normalized for marker in sql_markers)


# Rewrites a user question into a concise semantic search query.
def rewrite_query(original_query: str) -> str:
    if os.getenv("ENABLE_QUERY_REWRITE", "false").lower() not in {"1", "true", "yes"}:
        return original_query

    try:
        client = ChatGroq(
            model="llama-3.1-8b-instant",
            api_key=os.getenv("GROQ_API_KEY"),
            temperature=0,
            max_tokens=100,
        )
        response = client.invoke(
            [
                {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
                {"role": "user", "content": original_query},
            ]
        )
        rewritten_query = get_llm_content(response)
        rewritten_query = rewritten_query.strip()
        if not rewritten_query or is_invalid_rewrite(rewritten_query):
            return original_query
        return rewritten_query
    except Exception:
        return original_query


def keyword_search(query: str, doc_ids: list[str], chunks: list, top_k: int = 4) -> list:
    query_words = re.findall(r"\b\w+\b", query.lower())
    if not query_words:
        return []

    allowed_doc_ids = set(doc_ids)
    scored_chunks = []
    for chunk in chunks:
        chunk_doc_id = chunk.metadata.get("doc_id")
        if chunk_doc_id and chunk_doc_id not in allowed_doc_ids:
            continue

        content = chunk.page_content.lower()
        score = sum(content.count(query_word) for query_word in query_words)
        if score > 0:
            scored_chunks.append((score, chunk))

    scored_chunks.sort(key=lambda item: item[0], reverse=True)
    return [chunk for _, chunk in scored_chunks[:top_k]]


def reciprocal_rank_fusion(vector_results: list, keyword_results: list, k: int = 60) -> list:
    fused_scores: dict[str, float] = {}
    chunks_by_content: dict[str, object] = {}

    for results in (vector_results, keyword_results):
        for rank, chunk in enumerate(results, start=1):
            content = chunk.page_content
            if not content:
                continue
            chunks_by_content[content] = chunk
            fused_scores[content] = fused_scores.get(content, 0) + (1 / (k + rank))

    ranked_contents = sorted(
        fused_scores,
        key=lambda content: fused_scores[content],
        reverse=True,
    )
    return [chunks_by_content[content] for content in ranked_contents]


def answer_question(
    question: str,
    doc_ids: list[str] | str,
    history: list[dict] | None = None,
) -> dict:
    index_name = os.getenv("PINECONE_INDEX_NAME")
    if not index_name:
        raise ValueError("PINECONE_INDEX_NAME is required")

    if isinstance(doc_ids, str):
        doc_ids = [doc_ids]
    doc_ids = [doc_id for doc_id in doc_ids if doc_id]
    if not doc_ids:
        raise ValueError("At least one doc_id is required")

    with QueryTrace(question, doc_ids) as trace:
        rewritten_query = rewrite_query(question)
        trace.mark("rewrite", rewritten_query=rewritten_query)

        embeddings = get_embeddings()
        question_embedding = embeddings.embed_query(rewritten_query)
        vector_store = PineconeVectorStore(index_name=index_name, embedding=embeddings)
        vector_results = []
        for doc_id in doc_ids:
            namespace_results_with_scores = vector_store.similarity_search_by_vector_with_score(
                embedding=question_embedding,
                k=8,
                namespace=doc_id,
            )
            for chunk, score in namespace_results_with_scores:
                chunk.metadata.setdefault("doc_id", doc_id)
                chunk.metadata["_similarity_score"] = score
                chunk.metadata["_question_embedding"] = question_embedding
                vector_results.append(chunk)
        trace.mark("vector_search", vector_count=len(vector_results))

        if not vector_results:
            trace.set_retrieval(confidence=0.0, confidence_level="low")
            return {
                "success": True,
                "answer": "No relevant content found. Please upload a document first.",
                "sources": [],
                "doc_id": doc_ids[0] if len(doc_ids) == 1 else None,
                "doc_ids": doc_ids,
                "rewritten_query": rewritten_query,
                "confidence": "low",
                "confidence_score": 0,
            }

        keyword_results = keyword_search(rewritten_query, doc_ids, vector_results)
        fused = reciprocal_rank_fusion(vector_results, keyword_results)
        trace.mark("fusion", fused_count=len(fused))

        chunks = rerank_chunks(rewritten_query, fused, top_k=4)
        trace.mark("rerank", final_chunk_count=len(chunks))

        confidence_score = round(score_relevance(rewritten_query, chunks), 2)
        confidence = classify_confidence(confidence_score)
        trace.set_retrieval(confidence=confidence_score, confidence_level=confidence)

        context = "\n\n".join(
            f"Chunk {chunk_index + 1} (page {chunk.metadata.get('page', 0)}):\n"
            f"{chunk.page_content}"
            for chunk_index, chunk in enumerate(chunks)
        )
        user_message = f"Document context:\n{context}\n\nQuestion:\n{question}"
        system_prompt = SYSTEM_PROMPT
        if confidence == "low":
            system_prompt = (
                "The retrieved context has low relevance to this question. "
                "Be very clear if you cannot find a definitive answer. "
                f"{SYSTEM_PROMPT}"
            )

        client = ChatGroq(
            model="llama-3.3-70b-versatile",
            api_key=os.getenv("GROQ_API_KEY"),
            temperature=0.2,
            max_tokens=1000,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            *sanitize_history(history),
            {"role": "user", "content": user_message},
        ]
        response = client.invoke(messages)
        answer = get_llm_content(response)
        prompt_tokens, completion_tokens = extract_token_usage(response)
        trace.set_tokens(prompt_tokens, completion_tokens)
        trace.mark("generation")

        return {
            "success": True,
            "answer": answer,
            "sources": [
                {
                    "page": int(chunk.metadata.get("page", 0)),
                    "text": chunk.page_content[:200],
                    "filename": DOC_METADATA.get(
                        chunk.metadata.get("doc_id", ""),
                        {},
                    ).get("filename", chunk.metadata.get("filename")),
                }
                for chunk in chunks
            ],
            "doc_id": doc_ids[0] if len(doc_ids) == 1 else None,
            "doc_ids": doc_ids,
            "rewritten_query": rewritten_query,
            "confidence": confidence,
            "confidence_score": confidence_score,
        }
