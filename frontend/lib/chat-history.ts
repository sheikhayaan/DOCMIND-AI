// Reads and manages the saved chat transcripts kept in browser storage.
// Each document gets one conversation, so the history list is a document list.

export const CHAT_STORAGE_PREFIX = "docmind_chat_v1:";

export interface StoredConversation {
  docId: string;
  filename: string;
  docType: string;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

interface StoredPayload {
  messages?: { role?: string; content?: string }[];
  history?: unknown[];
  filename?: string;
  docType?: string;
  updatedAt?: number;
}

// Builds the storage key a single document's transcript lives under.
export function chatStorageKey(docId: string): string {
  return `${CHAT_STORAGE_PREFIX}${docId || "default"}`;
}

// Returns every conversation saved in this browser, newest first.
export function listConversations(): StoredConversation[] {
  if (typeof window === "undefined") return [];
  const items: StoredConversation[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(CHAT_STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      let payload: StoredPayload;
      try {
        payload = JSON.parse(raw) as StoredPayload;
      } catch {
        continue;
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (!messages.length) continue;

      const firstQuestion = messages.find((message) => message.role === "user");
      const preview =
        typeof firstQuestion?.content === "string" ? firstQuestion.content.slice(0, 90) : "";

      items.push({
        docId: key.slice(CHAT_STORAGE_PREFIX.length),
        filename: payload.filename || "Untitled document",
        docType: payload.docType || "general",
        updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : 0,
        messageCount: messages.length,
        preview,
      });
    }
  } catch {
    return [];
  }

  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Removes one conversation from browser storage.
export function deleteConversation(docId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chatStorageKey(docId));
  } catch {
    // Storage unavailable — nothing to delete.
  }
}

// Removes every saved conversation from browser storage.
export function clearAllConversations(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(CHAT_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

// Formats a saved timestamp as a short relative label for the history list.
export function formatConversationTime(timestamp: number): string {
  if (!timestamp) return "";
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
