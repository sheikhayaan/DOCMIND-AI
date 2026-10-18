"""PDF ingestion: extract, chunk, embed, and durably index document vectors.

The queue worker calls ingest_pdf() with a stage callback so the status endpoint
can expose extracting -> chunking -> embedding -> indexing. Vectors are written
directly to Pinecone with clean metadata; the former `_embedding` metadata field
is retained only in the optional local development cache and is never sent to
the vector store.
"""

import os
import uuid
from collections.abc import Callable

from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone import Pinecone

from session_store import session_store

load_dotenv()

DOC_METADATA = {}
LOCAL_DOC_CHUNKS = {}
EMBEDDING_DIMENSION = 384
_embeddings_model = None
StageCallback = Callable[[str], None] | None


def total_rows(value: int) -> int:
    """Returns a non-negative count for metadata written to the UI."""
    return max(0, int(value))


# Caches the HuggingFace embedding model so it loads once and is reused.
def get_embeddings():
    global _embeddings_model
    if _embeddings_model is None:
        _embeddings_model = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings_model


def _notify(on_stage: StageCallback, stage: str) -> None:
    """Calls an optional stage callback without letting UI bookkeeping fail ingestion."""
    if on_stage is None:
        return
    try:
        on_stage(stage)
    except Exception as exc:
        print(f"Warning: stage callback failed for {stage}: {exc}")


def _upsert_vectors(
    doc_id: str,
    chunks: list,
    embeddings: list[list[float]],
    filename: str,
    index_name: str,
) -> None:
    """Upserts clean vectors and text metadata directly into the document namespace."""
    api_key = os.getenv("PINECONE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("PINECONE_API_KEY is required for ingestion")
    index = Pinecone(api_key=api_key).Index(index_name)
    vectors: list[dict] = []
    for chunk_index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        if len(embedding) != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Embedding dimension {len(embedding)} does not match the {EMBEDDING_DIMENSION}D index"
            )
        vectors.append(
            {
                "id": f"{doc_id}-{chunk_index}-{uuid.uuid4().hex[:12]}",
                "values": [float(value) for value in embedding],
                "metadata": {
                    "doc_id": doc_id,
                    "filename": filename,
                    "page": int(chunk.metadata.get("page", 0)),
                    "page_count": int(chunk.metadata.get("page_count", 0)),
                    "chunk_index": chunk_index,
                    "text": chunk.page_content,
                },
            }
        )
    batch_size = 100
    for offset in range(0, len(vectors), batch_size):
        index.upsert(vectors=vectors[offset:offset + batch_size], namespace=doc_id)


# Loads a PDF, chunks it, embeds it, and stores the vectors in Pinecone.
def ingest_pdf(
    file_path: str,
    doc_id: str,
    on_stage: StageCallback = None,
    cache_locally: bool | None = None,
    filename: str | None = None,
) -> int:
    """Runs the full ingestion pipeline and reports each stage to the job store."""
    index_name = os.getenv("PINECONE_INDEX_NAME")
    if not index_name:
        raise ValueError("PINECONE_INDEX_NAME is required")

    _notify(on_stage, "extracting")
    loader = PyPDFLoader(file_path)
    pages = loader.load()
    if not pages:
        raise ValueError("PDF has 0 pages")

    _notify(on_stage, "chunking")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = text_splitter.split_documents(pages)
    if not chunks:
        raise ValueError("PDF has 0 chunks")

    safe_filename = filename or os.path.basename(file_path)
    page_count = len(pages)
    for chunk_index, chunk in enumerate(chunks):
        page_number = int(chunk.metadata.get("page", 0)) + 1
        chunk.metadata.update(
            {
                "doc_id": doc_id,
                "filename": safe_filename,
                "page": page_number,
                "page_count": page_count,
                "chunk_index": chunk_index,
            }
        )

    _notify(on_stage, "embedding")
    embeddings_model = get_embeddings()
    chunk_embs = embeddings_model.embed_documents([c.page_content for c in chunks])

    _notify(on_stage, "indexing")
    _upsert_vectors(doc_id, chunks, chunk_embs, safe_filename, index_name)

    if cache_locally is None:
        cache_locally = os.getenv("LOCAL_CHUNK_CACHE_ENABLED", "true").lower() not in {"0", "false", "no"}
    if cache_locally:
        for chunk, embedding in zip(chunks, chunk_embs):
            chunk.metadata["_embedding"] = embedding
        LOCAL_DOC_CHUNKS[doc_id] = chunks
    else:
        LOCAL_DOC_CHUNKS.pop(doc_id, None)

    DOC_METADATA[doc_id] = {
        "filename": safe_filename,
        "chunk_count": total_rows(len(chunks)),
        "page_count": total_rows(page_count),
    }

    return len(chunks)


# Creates a durable multi-document session for a list of document ids.
def create_session(doc_ids: list[str], user_id: str = "") -> str:
    """Persists a query session so any API worker can resolve it."""
    return session_store.create(doc_ids, user_id)


# Deletes all vectors, chunks, and metadata for a document.
def delete_doc(doc_id: str) -> bool:
    LOCAL_DOC_CHUNKS.pop(doc_id, None)
    DOC_METADATA.pop(doc_id, None)
    index_name = os.getenv("PINECONE_INDEX_NAME")
    if not index_name:
        return True

    try:
        api_key = os.getenv("PINECONE_API_KEY", "").strip()
        if api_key:
            Pinecone(api_key=api_key).Index(index_name).delete(delete_all=True, namespace=doc_id)
        else:
            embeddings = get_embeddings()
            vector_store = PineconeVectorStore(index_name=index_name, embedding=embeddings)
            vector_store.delete(delete_all=True, namespace=doc_id)
    except Exception as exc:
        if os.getenv("ENVIRONMENT", "development").lower() == "production":
            raise RuntimeError("Vector deletion failed") from exc
        print(f"Warning: Pinecone deletion failed: {exc}")

    return True
