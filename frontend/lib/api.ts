const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const SERVICE_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again in a moment.";

export type UploadResponse = {
  success: boolean;
  doc_id: string;
  filename: string;
  chunk_count: number;
  message: string;
  doc_type?: string;
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

// Reads the server error body and returns the clearest available error message.
async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorResponse;
    return data.error ?? data.detail ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

// Sends a fetch request and converts network failures into a user-friendly error.
async function request(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

// Uploads a PDF file to the backend ingestion endpoint.
export async function uploadPDF(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await request(`${API_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as UploadResponse;
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

  const response = await request(`${API_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

  const prompt = `Generate exactly 4 short useful questions for a ${docType} PDF. Return only a JSON array of strings.`;
  const response = await queryDocument(prompt, docId);
  const jsonMatch = response.answer.match(/\[[\s\S]*\]/);
  const jsonText = jsonMatch?.[0] ?? response.answer;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((question) => question.trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
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


