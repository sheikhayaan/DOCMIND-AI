import { getRecaptchaToken } from "./recaptcha";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const SERVICE_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again in a moment.";

export type UploadResponse = {
  success: boolean;
  doc_id: string;
  filename: string;
  chunk_count: number;
  message: string;
  doc_type?: string;
  job_id: string;
  status: IngestionStatus;
  pdf_slots: PDFSlotStatus;
  question_slots: QuestionSlotStatus;
};

export type IngestionStatus =
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed"
  | "cancelled";

export type IngestionStatusResponse = {
  success: boolean;
  data: {
    doc_id: string;
    filename: string;
    job_id: string | null;
    status: IngestionStatus;
    stage: IngestionStatus;
    progress: number;
    chunk_count: number;
    error: string | null;
  };
  error: string | null;
};

export type PDFSlotStatus = {
  used: number;
  limit: number;
  remaining: number;
  can_upload: boolean;
  // Tier context from the backend: guests get fewer slots than accounts, so the
  // UI can offer signing in instead of only reporting that the cap was hit.
  signed_in?: boolean;
  signed_in_limit?: number | null;
  message?: string;
};

export type QuestionSlotStatus = {
  used: number;
  limit: number;
  remaining: number;
  can_ask: boolean;
  unlimited?: boolean;
  message?: string;
};

export type DocumentRecord = {
  doc_id: string;
  filename: string;
  file_size: number;
  chunk_count: number;
  created_at: number;
  question_count: number;
  last_accessed_at?: number;
  ingest_status?: IngestionStatus;
  job_id?: string | null;
};

export type DocumentStatusResponse = {
  success: boolean;
  data: {
    documents: DocumentRecord[];
    pdf_slots: PDFSlotStatus;
    question_slots: QuestionSlotStatus;
  };
  error: string | null;
};

export type DeleteDocumentResponse = {
  success: boolean;
  data: {
    deleted_doc_id: string;
    pdf_slots: PDFSlotStatus;
  };
  error: string | null;
};

export type AuthSessionResponse = {
  success: boolean;
  data: {
    user_id: string;
    email: string | null;
    role: "user" | "admin";
    access_token: string;
  };
  error: string | null;
};

// One recorded (identity, address, browser) triple. A browser cannot report its
// MAC address to a server, so the IP and user agent are what the backend has.
export type AdminDevice = {
  user_id: string;
  ip_address: string;
  user_agent: string | null;
  email: string | null;
  is_guest: number;
  is_blocked_ip: number;
  first_seen_at: number;
  last_seen_at: number;
  hits: number;
};

export type AdminMetricsResponse = {
  success: boolean;
  data: {
    totals: Record<string, number>;
    users: Record<string, string | number | null>[];
    devices?: AdminDevice[];
    audit_events: Record<string, unknown>[];
    web_vitals: Record<string, string | number | null>[];
    limits: {
      pdfs_per_user: number;
      questions_per_user: number;
      pdfs_per_guest?: number;
      pdfs_per_account?: number;
    };
  };
  error: string | null;
};

export type QueryRequest = {
  question: string;
  doc_ids: string[];
  doc_id?: string;
  session_id?: string;
  history?: ChatHistoryMessage[];
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SourceChunk = {
  page: number;
  text: string;
  filename?: string | null;
};

export type QueryResponse = {
  success: boolean;
  answer: string;
  sources: SourceChunk[];
  doc_id?: string | null;
  doc_ids: string[];
  session_id?: string | null;
  rewritten_query?: string | null;
  confidence: "high" | "medium" | "low";
  confidence_score: number;
  answer_source?: "document" | "general" | "assistant";
};

export type SessionResponse = {
  session_id: string;
  doc_ids: string[];
  filenames: string[];
  total_chunks: number;
};

type ErrorResponse = {
  success?: boolean;
  error?: string;
  detail?: string;
};

// Returns the existing backend signed session token from browser storage.
function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("docmind_access_token");
}

// Same-tab notification so account UI updates without a reload.
export const SESSION_CHANGED_EVENT = "docmind:session-changed";

function notifySessionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
  }
}

// Saves a backend signed session token in browser storage.
function storeAccessToken(token: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("docmind_access_token", token);
    notifySessionChanged();
  }
}

export type SessionInfo = {
  email: string | null;
  role: "user" | "admin";
  provider?: string;
};

// Decodes a base64url segment (no padding) into a UTF-8 string.
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

// Reads the stored session token's payload for display only (no signature check).
export function getSessionInfo(): SessionInfo | null {
  const token = getStoredAccessToken();
  if (!token) return null;
  try {
    const [body] = token.split(".");
    const payload = JSON.parse(base64UrlDecode(body)) as {
      email?: string | null;
      role?: string;
      provider?: string;
      exp?: number;
    };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      email: payload.email ?? null,
      role: payload.role === "admin" ? "admin" : "user",
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}

// Clears the stored session; the next request mints a fresh anonymous session.
export function signOut(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("docmind_access_token");
    notifySessionChanged();
  }
}

let activeSessionPromise: Promise<string> | null = null;

// Creates a signed public backend session when the browser has none.
export async function ensureAccessToken(): Promise<string> {
  const existing = getStoredAccessToken();
  if (existing) return existing;

  if (activeSessionPromise) return activeSessionPromise;

  activeSessionPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }
      const session = (await response.json()) as AuthSessionResponse;
      storeAccessToken(session.data.access_token);
      return session.data.access_token;
    } finally {
      activeSessionPromise = null;
    }
  })();

  return activeSessionPromise;
}

// Reads the server error body and returns the clearest available error message.
async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorResponse;
    return data.error ?? data.detail ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

// Transient gateway/network failures worth retrying once or twice.
const RETRYABLE_STATUS = new Set([502, 503, 504]);

// Delays between retry attempts without blocking the UI.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends a fetch request, retrying transient network failures for safe calls.
async function request(input: RequestInfo | URL, init: RequestInit, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await ensureAccessToken()}`);
  const method = (init.method ?? "GET").toUpperCase();
  // Uploads are not blindly retried: a lost response may already have created a
  // document. Queries and reads are safe to replay.
  const canRetry = method === "GET" || String(input).endsWith("/query");
  const attempts = canRetry ? 3 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, { ...init, headers });
      if (response.status === 401 && retry) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("docmind_access_token");
        }
        const freshHeaders = new Headers(init.headers);
        freshHeaders.set("Authorization", `Bearer ${await ensureAccessToken()}`);
        return await fetch(input, { ...init, headers: freshHeaders });
      }
      if (canRetry && attempt + 1 < attempts && RETRYABLE_STATUS.has(response.status)) {
        await wait(400 * 2 ** attempt);
        continue;
      }
      return response;
    } catch {
      if (attempt + 1 >= attempts) break;
      await wait(400 * 2 ** attempt);
    }
  }
  throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
}

// Creates an admin session for the configured owner email and secret token.
export async function loginAdmin(email: string, adminToken: string): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_URL}/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, admin_token: adminToken }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const session = (await response.json()) as AuthSessionResponse;
  storeAccessToken(session.data.access_token);
  return session;
}

// Registers a new email/password account and stores the returned session token.
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const session = (await response.json()) as AuthSessionResponse;
  storeAccessToken(session.data.access_token);
  return session;
}

// Verifies email/password credentials and stores the returned session token.
export async function loginWithEmail(
  email: string,
  password: string,
): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const session = (await response.json()) as AuthSessionResponse;
  storeAccessToken(session.data.access_token);
  return session;
}

// True when the browser holds a session tied to a verified email, as opposed to
// the anonymous session that /auth/session mints for first-time visitors.
export function isSignedIn(): boolean {
  return Boolean(getSessionInfo()?.email);
}

// Exchanges a Google ID token for a backend session and stores the returned token.
export async function loginWithGoogle(credential: string): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const session = (await response.json()) as AuthSessionResponse;
  storeAccessToken(session.data.access_token);
  return session;
}

// Reads admin-only usage, security, and performance analytics.
export async function getAdminMetrics(): Promise<AdminMetricsResponse> {
  const response = await request(`${API_URL}/admin/metrics`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as AdminMetricsResponse;
}

// Uploads a PDF and returns the queued ingestion job id.
export async function uploadPDF(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const recaptchaToken = await getRecaptchaToken("upload");

  const response = await request(`${API_URL}/upload`, {
    method: "POST",
    headers: recaptchaToken ? { "X-Recaptcha-Token": recaptchaToken } : undefined,
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as UploadResponse;
}

// Reads durable ingestion progress for one document.
export async function getIngestionStatus(docId: string): Promise<IngestionStatusResponse> {
  const response = await request(`${API_URL}/documents/${encodeURIComponent(docId)}/status`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as IngestionStatusResponse;
}

// Polls ingestion until it is ready, failed, cancelled, or times out.
export async function waitForIngestion(
  docId: string,
  onUpdate?: (status: IngestionStatusResponse["data"]) => void,
  timeoutMs = 300_000,
  intervalMs = 500,
): Promise<IngestionStatusResponse["data"]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await getIngestionStatus(docId);
    onUpdate?.(response.data);
    if (response.data.status === "ready") return response.data;
    if (response.data.status === "failed" || response.data.status === "cancelled") {
      throw new Error(response.data.error ?? "Document processing failed");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Document processing timed out. Please try again.");
}

// Reads the current PDF slot state for the browser user.
export async function getDocumentStatus(): Promise<DocumentStatusResponse> {
  const response = await request(`${API_URL}/documents`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as DocumentStatusResponse;
}

// Deletes one uploaded PDF and frees its user slot.
export async function deleteDocument(docId: string): Promise<DeleteDocumentResponse> {
  const response = await request(`${API_URL}/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as DeleteDocumentResponse;
}

// Sends a document question to the backend query endpoint.
export async function queryDocument(
  question: string,
  docIds: string[] | string,
  sessionIdOrHistory?: string | ChatHistoryMessage[],
  history: ChatHistoryMessage[] = [],
): Promise<QueryResponse> {
  const normalizedDocIds = Array.isArray(docIds) ? docIds : [docIds];
  const sessionId =
    typeof sessionIdOrHistory === "string" ? sessionIdOrHistory : undefined;
  const conversationHistory = Array.isArray(sessionIdOrHistory)
    ? sessionIdOrHistory
    : history;
  const requestBody: QueryRequest = {
    question,
    doc_ids: normalizedDocIds,
    session_id: sessionId,
    history: conversationHistory.slice(-8),
  };

  const recaptchaToken = await getRecaptchaToken("query");
  const response = await request(`${API_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(recaptchaToken ? { "X-Recaptcha-Token": recaptchaToken } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as QueryResponse;
}

// Generates suggested questions for the uploaded document through the query endpoint.
export async function getSuggestions(
  docId: string,
  docType = "general",
): Promise<string[]> {
  if (!docId) {
    return [];
  }
  const label = docType === "general" ? "this document" : `this ${docType} document`;
  return [
    `Summarize ${label} in 5 bullets.`,
    "What are the most important facts?",
    "Which pages support the main conclusion?",
    "What should I pay attention to first?",
  ];
}

// Creates an in-memory backend session for querying multiple documents together.
export async function createSession(docIds: string[]): Promise<SessionResponse> {
  const response = await request(`${API_URL}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ doc_ids: docIds }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as SessionResponse;
}


export type SuggestionsResponse = {
  success: boolean;
  suggestions: string[];
};
