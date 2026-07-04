import os
import uuid
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()

SESSIONS = {}
DOC_METADATA = {}
_embeddings_model = None


# Caches the HuggingFace embedding model so it loads once and is reused.
def get_embeddings():
    global _embeddings_model
    if _embeddings_model is None:
        _embeddings_model = HuggingFaceEmbeddings(
            model_name="sentence-transformers/paraphrase-MiniLM-L3-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings_model


# Loads a PDF, chunks it, embeds it, and stores the vectors in Pinecone.
def ingest_pdf(file_path: str, doc_id: str) -> int:
    from langchain_community.vectorstores import Pinecone as PineconeVectorStore

    index_name = os.getenv("PINECONE_INDEX_NAME")
    if not index_name:
        raise ValueError("PINECONE_INDEX_NAME is required")

    loader = PyPDFLoader(file_path)
    pages = loader.load()
    if not pages:
        raise ValueError("PDF has 0 pages")

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = text_splitter.split_documents(pages)
    if not chunks:
        raise ValueError("PDF has 0 chunks")

    filename = os.path.basename(file_path)
    for chunk_index, chunk in enumerate(chunks):
        page_number = int(chunk.metadata.get("page", 0)) + 1
        chunk.metadata.update(
            {
                "doc_id": doc_id,
                "filename": filename,
                "page": page_number,
                "chunk_index": chunk_index,
            }
        )

    DOC_METADATA[doc_id] = {
        "filename": filename,
        "chunk_count": len(chunks),
    }

    embeddings = get_embeddings()
    vector_store = PineconeVectorStore(index_name=index_name, embedding=embeddings)
    vector_store.add_documents(
        documents=chunks,
        ids=[f"{doc_id}-{uuid.uuid4()}" for _ in chunks],
        namespace=doc_id,
    )

    return len(chunks)


# Creates an in-memory multi-document session for a list of document ids.
def create_session(doc_ids: list[str]) -> str:
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = doc_ids
    return session_id


# Deletes all vectors for a document namespace from Pinecone.
def delete_doc(doc_id: str) -> bool:
    from langchain_community.vectorstores import Pinecone as PineconeVectorStore

    index_name = os.getenv("PINECONE_INDEX_NAME")
    if not index_name:
        raise ValueError("PINECONE_INDEX_NAME is required")

    embeddings = get_embeddings()
    vector_store = PineconeVectorStore(index_name=index_name, embedding=embeddings)
    vector_store.delete(delete_all=True, namespace=doc_id)

    return True