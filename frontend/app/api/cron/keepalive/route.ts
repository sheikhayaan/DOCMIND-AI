// Periodically pings the Hugging Face Space backend to keep it awake and prevent idle sleeping.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HealthPayload {
  status?: string;
  version?: string;
  queue_healthy?: boolean;
}

interface BackendResponse {
  success?: boolean;
  data?: HealthPayload;
  error?: string | null;
}

// Handles incoming cron requests and forwards an active health probe to the backend.
export async function GET(): Promise<Response> {
  const backendBase =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_INTERNAL_URL ||
    'https://ayaandevloper408-docmind-ai-backend.hf.space';
  const targetUrl = `${backendBase.replace(/\/+$/, '')}/health`;

  const startedAt = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'DocMindAI-KeepAlive-Cron/1.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startedAt;
    const body = (await res.json().catch(() => null)) as BackendResponse | null;

    return Response.json(
      {
        success: res.ok,
        data: {
          url: targetUrl,
          statusCode: res.status,
          latencyMs,
          timestamp: new Date().toISOString(),
          backendPayload: body,
        },
        error: res.ok ? null : `Backend returned HTTP ${res.status}`,
      },
      {
        status: res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    return Response.json(
      {
        success: false,
        data: {
          url: targetUrl,
          latencyMs,
          timestamp: new Date().toISOString(),
        },
        error: err instanceof Error ? err.message : 'Failed to reach Hugging Face Space backend',
      },
      {
        status: 504,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }
}
