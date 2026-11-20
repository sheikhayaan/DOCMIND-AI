// Typed public contracts for the FastAPI command center (never authentication claims).
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type HealingAction = 'CONNECTION_POOL_RESET' | 'TRANSIENT_CACHE_FLUSH' | 'CIRCUIT_BREAKER_RESET' | 'MEMORY_COMPACT_DRAIN' | 'CIRCUIT_FALLBACK_CASCADE';

export interface Overview {
  totalUsers: number;
  active24h: number;
  totalSessions: number;
  completedSessions: number;
  averageRating: number;
  reviewCount: number;
  activeIncidents: number;
  systemAlerts: { severity: Severity; message: string }[];
  sessionDefinition: string;
  telemetryScope: string;
  autoHealingEnabled: boolean;
  autoMitigatedCount: number;
  measuredMttrMs: number | null;
}

export interface PoolStatus {
  name: string;
  capacity: number;
  active: number;
  idle: number;
  waiting: number;
  generation: number;
  status: 'healthy' | 'exhausted' | 'draining' | 'unavailable';
}

export interface Telemetry {
  timestamp: string;
  instanceId: string;
  scope: string;
  windowSeconds: number;
  windowElapsedSeconds: number;
  resources: {
    runtime: string;
    processId: number;
    cpuPercent: number | null;
    systemCpuPercent: number | null;
    rssBytes: number | null;
    heapUsedBytes: number | null;
    heapPeakBytes: number | null;
    memoryLimitBytes: number;
    eventLoopLagMs: number | null;
    sampledAt: string | null;
  };
  http: {
    totalRequests: number;
    windowRequests: number;
    requestsPerSecond: number;
    inFlight: number;
    statusCounts: Record<string, number>;
    totalStatusCounts: Record<string, number>;
  };
  latencyMs: { p50: number | null; p95: number | null; p99: number | null; sampleCount: number; samplesTruncated: boolean };
  database: {
    engine: string;
    pools: PoolStatus[];
    activeQueries: number;
    totalQueries: number;
    windowQueries: number;
    averageQueryLatencyMs: number | null;
    samplesTruncated: boolean;
  };
  gateway: {
    configured: boolean;
    route: 'primary' | 'fallback' | 'offline';
    activeModel: string | null;
    verified: boolean;
    breakers: { model: string; state: 'closed' | 'open' | 'half-open'; failures: number; retryAfterSeconds: number; lastSuccessAt: string | null }[];
  } | null;
}

export interface NodeTelemetry {
  runtime: string;
  scope: string;
  processId: number;
  timestamp: string;
  cpuPercent: number | null;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  eventLoopLagMs: number | null;
}

export interface Incident {
  id: string;
  timestamp: string;
  category: string;
  severity: Severity;
  endpoint: string;
  statusCode: number | null;
  errorDetails: string;
  autoMitigated: boolean;
  mitigationNotes: string;
  resolvedAt: string | null;
  occurrences: number;
  lastSeenAt: string;
}

export interface HealingReport {
  id: string;
  status: 'success' | 'partial' | 'failed' | 'noop' | 'busy' | 'cooldown';
  trigger: 'manual' | 'automatic';
  actor: string;
  startedAt: string;
  durationMs: number;
  actionsExecuted: { action: HealingAction; status: 'success' | 'failed' | 'skipped' | 'deferred'; notes: string; durationMs: number; verified: boolean }[];
  latencySavingsMs: number | null;
  latencySavingsBasis: string;
  verifiedNominal: boolean;
  checks: Record<string, boolean | null>;
  incidentId: string | null;
}

export interface IncidentPage {
  incidents: Incident[];
  total: number;
  page: number;
  pageSize: number;
  auditTrail: HealingReport[];
  persistenceHealthy: boolean;
  pendingCriticalWrites: number;
  droppedCriticalWrites: number;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string | null;
  role: string;
  totalSessions: number;
  completedSessions: number;
  interviewCount: number | null;
  averageDiagnosticScore: number | null;
  averageRating: number | null;
  reviewCount: number;
  joinedAt: string;
  lastActiveAt: string;
  suspended: boolean;
  suspensionReason: string | null;
  questions: number;
  activeDocuments: number;
}

export interface UserPage {
  users: UserRecord[];
  total: number;
  page: number;
  pageSize: number;
  scoreAvailability: string;
}

export interface UserDetail {
  user: UserRecord;
  sessions: { id: string; startedAt: string; completedAt: string | null; answers: number; stars: number | null }[];
}

export interface SessionFeedback {
  sessionId: string;
  completed: boolean;
  stars: number | null;
  verified: boolean;
}
