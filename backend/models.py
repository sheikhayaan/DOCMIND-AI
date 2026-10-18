import re

from pydantic import BaseModel, Field, field_validator


ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class PDFSlotStatus(BaseModel):
    """Current PDF slot usage for a user."""

    used: int
    limit: int
    remaining: int
    can_upload: bool
    # Tier context, so the UI can explain the allowance rather than only enforce
    # it: a guest at the cap should be told an account raises it. Defaulted
    # rather than required so the limit itself is never duplicated here.
    signed_in: bool = False
    signed_in_limit: int | None = None
    message: str = ""


class QuestionSlotStatus(BaseModel):
    """Current question usage for a user."""

    used: int
    limit: int
    remaining: int
    can_ask: bool


class AuthSessionRequest(BaseModel):
    """Request body for creating a signed backend session."""

    email: str | None = Field(default=None, max_length=254)
    admin_token: str | None = Field(default=None, max_length=500)


class GoogleAuthRequest(BaseModel):
    """Request body for exchanging a Google ID token for a backend session."""

    credential: str = Field(..., min_length=10, max_length=8192)


class EmailAuthRequest(BaseModel):
    """Request body for email/password sign-up and sign-in."""

    email: str = Field(..., min_length=3, max_length=254)
    # Only an upper bound here: the real minimum is enforced in AuthService so
    # sign-up and sign-in return the same shaped error, and so a short password
    # on sign-in reads as "incorrect" rather than leaking the policy.
    password: str = Field(..., min_length=1, max_length=200)


class AuthSessionResponse(BaseModel):
    """Response returned after issuing a signed backend session."""

    success: bool
    data: dict[str, object]
    error: str | None = None


class UploadResponse(BaseModel):
    """Response returned after a PDF upload is accepted for background processing."""

    success: bool
    data: dict[str, object] | None = None
    error: str | None = None
    doc_id: str
    filename: str
    chunk_count: int
    message: str
    job_id: str
    status: str
    pdf_slots: PDFSlotStatus
    question_slots: QuestionSlotStatus


class IngestionStatusResponse(BaseModel):
    """Response returned while polling an asynchronous ingestion job."""

    success: bool
    data: dict[str, object] | None = None
    error: str | None = None


class QueryRequest(BaseModel):
    """Request body for asking a question about an uploaded document."""

    question: str = Field(..., min_length=1, max_length=4000)
    doc_ids: list[str] = Field(default_factory=list)
    doc_id: str | None = None
    session_id: str | None = None
    history: list[dict] = Field(default_factory=list)

    @field_validator("question")
    @classmethod
    def sanitize_question(cls, value: str) -> str:
        """Normalizes user questions before retrieval."""
        return " ".join(value.replace("\x00", "").split())

    @field_validator("doc_ids")
    @classmethod
    def validate_doc_ids(cls, value: list[str]) -> list[str]:
        """Rejects malformed document ids before they reach storage or Pinecone."""
        for doc_id in value:
            if doc_id and not ID_PATTERN.match(doc_id):
                raise ValueError("Invalid document id")
        return value

    @field_validator("doc_id", "session_id")
    @classmethod
    def validate_optional_id(cls, value: str | None) -> str | None:
        """Rejects malformed optional ids before request handling."""
        if value and not ID_PATTERN.match(value):
            raise ValueError("Invalid id")
        return value


class SessionRequest(BaseModel):
    """Request body for creating an in-memory document session."""

    doc_ids: list[str]

    @field_validator("doc_ids")
    @classmethod
    def validate_doc_ids(cls, value: list[str]) -> list[str]:
        """Rejects malformed document ids in session creation."""
        for doc_id in value:
            if doc_id and not ID_PATTERN.match(doc_id):
                raise ValueError("Invalid document id")
        return value


class SessionResponse(BaseModel):
    """Response returned after creating a multi-document session."""

    success: bool = True
    data: dict[str, object] | None = None
    error: str | None = None
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
    data: dict[str, object] | None = None
    error: str | None = None
    answer: str
    sources: list[SourceChunk]
    doc_id: str | None = None
    doc_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    rewritten_query: str | None = None
    confidence: str
    confidence_score: float
    answer_source: str | None = None


class ErrorResponse(BaseModel):
    """Standard error response returned by backend API routes."""

    success: bool = False
    data: None = None
    error: str


class VitalsRequest(BaseModel):
    """Core Web Vitals sample sent by the browser."""

    name: str = Field(..., pattern=r"^(CLS|FID|LCP|INP|FCP|TTFB)$")
    value: float = Field(..., ge=0)
    rating: str = Field(..., max_length=30)
    delta: float = Field(default=0, ge=0)
    id: str = Field(..., max_length=100)
    page: str = Field(default="/", max_length=200)
    referrer: str = Field(default="", max_length=500)
    timestamp: int = Field(..., ge=0)
    connection: str | None = Field(default=None, max_length=30)
    device: str = Field(default="desktop", pattern=r"^(mobile|desktop)$")
