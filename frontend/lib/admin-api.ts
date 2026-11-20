import { API_URL, getStoredAccessToken } from './api';
import type { HealingReport, Incident, IncidentPage, NodeTelemetry, Overview, SessionFeedback, Telemetry, UserDetail, UserPage } from './admin-types';

export class AdminApiError extends Error {
  // Retains HTTP status so the UI can lock immediately after an authorization failure.
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

interface Envelope<T> { success: boolean; data: T | null; error: string | null }

// Sends an authenticated, abortable JSON request; mutations are never automatically replayed.
export async function protectedJson<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = getStoredAccessToken();
  if (!token) throw new AdminApiError(401, 'Sign in to continue.');
  const controller = new AbortController();
  // Propagates navigation/poll cancellation without leaving an unbounded network request.
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 60_000);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!response.ok || payload?.success !== true || payload.data === null) {
      throw new AdminApiError(response.status, payload?.error || `Request failed (${response.status}).`);
    }
    return payload.data;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new AdminApiError(408, 'The request timed out. Check the audit trail before repeating a repair.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

// Loads durable usage and verified rating totals from the protected backend.
export function getAdminOverview(signal?: AbortSignal): Promise<Overview> {
  return protectedJson(`${API_URL}/api/admin/overview`, 'GET', undefined, signal);
}

// Loads the real API-worker telemetry snapshot.
export function getAdminTelemetry(signal?: AbortSignal): Promise<Telemetry> {
  return protectedJson(`${API_URL}/api/admin/telemetry`, 'GET', undefined, signal);
}

// Loads separately authenticated Next.js Node runtime measurements, not Python heap aliases.
export function getNodeTelemetry(signal?: AbortSignal): Promise<NodeTelemetry> {
  return protectedJson('/api/admin/runtime', 'GET', undefined, signal);
}

// Requests a bounded, searchable page of users.
export function getAdminUsers(params: URLSearchParams, signal?: AbortSignal): Promise<UserPage> {
  return protectedJson(`${API_URL}/api/admin/users?${params}`, 'GET', undefined, signal);
}

// Loads a safe user detail projection without hashes or private chat content.
export function getAdminUser(id: string, signal?: AbortSignal): Promise<UserDetail> {
  return protectedJson(`${API_URL}/api/admin/users/${encodeURIComponent(id)}`, 'GET', undefined, signal);
}

// Changes account suspension with an explicit auditable reason.
export function setUserSuspension(id: string, suspended: boolean, notes: string): Promise<UserDetail> {
  return protectedJson(`${API_URL}/api/admin/users/${encodeURIComponent(id)}/suspension`, 'POST', { suspended, notes });
}

// Fetches filtered incidents and the verified repair audit trail.
export function getAdminIncidents(params: URLSearchParams, signal?: AbortSignal): Promise<IncidentPage> {
  return protectedJson(`${API_URL}/api/admin/incidents?${params}`, 'GET', undefined, signal);
}

// Resolves an incident as a human action, not as an automatic mitigation.
export function resolveAdminIncident(id: string, notes: string): Promise<Incident> {
  return protectedJson(`${API_URL}/api/admin/incidents/${encodeURIComponent(id)}/resolve`, 'POST', { notes });
}

// Runs diagnostics or chooses the safe category-specific remedy for one incident.
export function executeSelfHealing(incidentId?: string): Promise<HealingReport> {
  return protectedJson(`${API_URL}/api/admin/self-healing/execute`, 'POST', incidentId ? { incidentId } : {});
}

// Retrieves the authenticated user's real stored session feedback.
export function getSessionFeedback(sessionId: string, signal?: AbortSignal): Promise<SessionFeedback> {
  return protectedJson(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/feedback`, 'GET', undefined, signal);
}

// Stores only an explicitly selected rating; null completes without manufacturing a review.
export function finishSession(sessionId: string, stars: number | null): Promise<SessionFeedback> {
  const path = stars === null ? 'complete' : 'review';
  return protectedJson(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/${path}`, 'POST', stars === null ? {} : { stars });
}
