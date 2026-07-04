from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Response returned after a PDF upload is processed."""

    success: bool
    doc_id: str
    filename: str
    chunk_count: int
    message: str


class QueryRequest(BaseModel):
    """Request body for asking a question about an uploaded document."""

    question: str
    doc_ids: list[str] = Field(default_factory=list)
    doc_id: str | None = None
    session_id: str | None = None
    history: list[dict] = Field(default_factory=list)


class SessionRequest(BaseModel):
    """Request body for creating an in-memory document session."""

    doc_ids: list[str]


class SessionResponse(BaseModel):
    """Response returned after creating a multi-document session."""

    session_id: str
    doc_ids: list[str]
    filenames: list[str]
    total_chunks: int


class SourceChunk(BaseModel):
    """Source excerpt used to support a generated answer."""

    page: int
    text: str
    filename: str | None = None


class QueryResponse(BaseModel):
    """Response returned after answering a document question."""

    success: bool
    answer: str
    sources: list[SourceChunk]
    doc_id: str | None = None
    doc_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    rewritten_query: str | None = None
    confidence: str
    confidence_score: float


class ErrorResponse(BaseModel):
    """Standard error response returned by backend API routes."""

    success: bool = False
    error: str
