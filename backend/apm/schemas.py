"""Typed contracts shared by telemetry, remediation, and the admin API."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator

T = TypeVar("T")
Severity = Literal["low", "medium", "high", "critical"]
Action = Literal[
    "CONNECTION_POOL_RESET",
    "TRANSIENT_CACHE_FLUSH",
    "CIRCUIT_BREAKER_RESET",
    "MEMORY_COMPACT_DRAIN",
    "CIRCUIT_FALLBACK_CASCADE",
]


class Envelope(BaseModel, Generic[T]):
    """Keeps every new API response in the project's standard envelope."""

    success: bool = True
    data: T
    error: str | None = None


class Resources(BaseModel):
    """Reports measured API-worker resources, with null for unsupported sensors."""

    runtime: str = "python"
    processId: int
    cpuPercent: float | None = None
    systemCpuPercent: float | None = None
    rssBytes: int | None = None
    heapUsedBytes: int | None = None
    heapPeakBytes: int | None = None
    memoryLimitBytes: int
    eventLoopLagMs: float | None = None
    sampledAt: str | None = None


class Percentiles(BaseModel):
    """Contains nearest-rank percentiles from retained request samples."""

    p50: float | None = None
    p95: float | None = None
    p99: float | None = None
    sampleCount: int = 0
    samplesTruncated: bool = False


class HttpMetrics(BaseModel):
    """Separates lifetime counts from the rolling-window request rate."""

    totalRequests: int
    windowRequests: int
    requestsPerSecond: float
    inFlight: int
    statusCounts: dict[str, int]
    totalStatusCounts: dict[str, int]


class PoolStatus(BaseModel):
    """Describes a real bounded SQLite pool rather than an invented DB gauge."""

    name: str
    capacity: int
    active: int
    idle: int
    waiting: int
    generation: int
    status: Literal["healthy", "exhausted", "draining", "unavailable"]


class DatabaseMetrics(BaseModel):
    """Measures SQL execution, excluding parameter text and private row data."""

    engine: str = "sqlite"
    pools: list[PoolStatus] = Field(default_factory=list)
    activeQueries: int
    totalQueries: int
    windowQueries: int
    averageQueryLatencyMs: float | None = None
    samplesTruncated: bool = False


class BreakerStatus(BaseModel):
    """Exposes only operational model state, never provider credentials."""

    model: str
    state: Literal["closed", "open", "half-open"]
    failures: int
    retryAfterSeconds: float
    lastSuccessAt: str | None = None


class GatewayStatus(BaseModel):
    """Distinguishes a configured route from a recently verified healthy one."""

    configured: bool
    route: Literal["primary", "fallback", "offline"]
    activeModel: str | None = None
    verified: bool = False
    breakers: list[BreakerStatus] = Field(default_factory=list)


class TelemetrySnapshot(BaseModel):
    """Returns a clean process-scoped fifteen-minute telemetry payload."""

    timestamp: str
    instanceId: str
    scope: str = "This API worker only; not a cluster aggregate"
    windowSeconds: int
    windowElapsedSeconds: float
    resources: Resources
    http: HttpMetrics
    latencyMs: Percentiles
    database: DatabaseMetrics
    gateway: GatewayStatus | None = None


class Incident(BaseModel):
    """Stores one bounded, redacted incident and its verified mitigation state."""

    id: str
    timestamp: str
    category: str
    severity: Severity
    endpoint: str
    statusCode: int | None = None
    errorDetails: str
    autoMitigated: bool = False
    mitigationNotes: str = ""
    resolvedAt: str | None = None
    occurrences: int = 1
    lastSeenAt: str


class ActionExecution(BaseModel):
    """Records the actual outcome of a single allowlisted remediation."""

    action: Action
    status: Literal["success", "failed", "skipped", "deferred"]
    notes: str
    durationMs: float = 0
    verified: bool = False


class HealingReport(BaseModel):
    """Never equates executing a command with successfully repairing a service."""

    id: str
    status: Literal["success", "partial", "failed", "noop", "busy", "cooldown"]
    trigger: Literal["manual", "automatic"]
    actor: str
    startedAt: str
    durationMs: float = 0
    actionsExecuted: list[ActionExecution] = Field(default_factory=list)
    latencySavingsMs: float | None = None
    latencySavingsBasis: str = "Not measured: no comparable before/after probe"
    verifiedNominal: bool = False
    checks: dict[str, bool | None] = Field(default_factory=dict)
    incidentId: str | None = None


class HealingRequest(BaseModel):
    """Rejects arbitrary commands and constrains manual remediation input."""

    model_config = ConfigDict(extra="forbid")
    actions: list[Action] | None = Field(default=None, min_length=1, max_length=5)
    incidentId: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class ResolutionRequest(BaseModel):
    """Requires an auditable explanation for a human-resolved incident."""

    model_config = ConfigDict(extra="forbid")
    notes: str = Field(min_length=3, max_length=500)

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: str) -> str:
        """Rejects blank explanations after normalizing control characters."""
        value = " ".join(value.replace("\x00", "").split())
        if len(value) < 3:
            raise ValueError("Provide a resolution note of at least 3 characters")
        return value


class SuspensionRequest(ResolutionRequest):
    """Requires both an explicit account state and a reason."""

    suspended: StrictBool


class ReviewRequest(BaseModel):
    """Accepts only a real user-selected star value, never a verification flag."""

    model_config = ConfigDict(extra="forbid")
    stars: StrictInt = Field(ge=1, le=5)


class SessionFeedback(BaseModel):
    """Reports server-verified ownership and completion without fake ratings."""

    sessionId: str
    completed: bool
    stars: int | None = None
    verified: bool = False


class UserRecord(BaseModel):
    """Contains safe roster fields, excluding hashes and authentication tokens."""

    id: str
    name: str
    email: str | None
    role: str
    totalSessions: int
    completedSessions: int
    interviewCount: int | None = None
    averageDiagnosticScore: float | None = None
    averageRating: float | None = None
    reviewCount: int
    joinedAt: str
    lastActiveAt: str
    suspended: bool
    suspensionReason: str | None = None
    questions: int
    activeDocuments: int


class UserPage(BaseModel):
    """Provides stable pagination and honest feature availability for the roster."""

    users: list[UserRecord]
    total: int
    page: int
    pageSize: int
    scoreAvailability: str = "No interview or exam scoring subsystem is configured"


class UserDetail(BaseModel):
    """Adds recent owned sessions to a safe roster record."""

    user: UserRecord
    sessions: list[dict[str, str | int | None]]


class Alert(BaseModel):
    """Provides actionable platform alerts rather than placeholder health labels."""

    severity: Severity
    message: str


class Overview(BaseModel):
    """Aggregates durable activity and verified reviews without seeded data."""

    totalUsers: int
    active24h: int
    totalSessions: int
    completedSessions: int
    averageRating: float
    reviewCount: int
    activeIncidents: int
    systemAlerts: list[Alert]
    sessionDefinition: str = "A document chat with at least one successful answer; completion is explicit"
    telemetryScope: str = "Live incidents and resources are API-worker-local; usage and critical audit are durable"
    autoHealingEnabled: bool
    autoMitigatedCount: int
    measuredMttrMs: float | None = None


class IncidentPage(BaseModel):
    """Returns filtered incidents plus the retained self-healing audit trail."""

    incidents: list[Incident]
    total: int
    page: int
    pageSize: int
    auditTrail: list[HealingReport]
    persistenceHealthy: bool
    pendingCriticalWrites: int
    droppedCriticalWrites: int
