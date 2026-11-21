import { getRuntimeSnapshot } from '@/lib/server/runtime-telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Requires backend protect + requireAdmin verification before exposing the Next.js process metrics.
export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get('Authorization') || '';
  const headers = { 'Cache-Control': 'no-store, private' };
  if (!authorization.startsWith('Bearer ') || (authorization || '').length > 8192) {
    return Response.json({ success: false, data: null, error: 'Authentication required' }, { status: 401, headers });
  }
  const apiUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  try {
    const verified = await fetch(`${apiUrl}/api/admin/telemetry`, {
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
    });
    if (!verified.ok) {
      const status = [401, 403, 429].includes(verified.status) ? verified.status : 503;
      return Response.json({ success: false, data: null, error: 'Admin verification unavailable or denied' }, { status, headers });
    }
    const payload = await verified.json() as { success?: boolean };
    if (payload.success !== true) throw new Error('Verification failed');
    return Response.json({ success: true, data: getRuntimeSnapshot(), error: null }, { headers });
  } catch {
    return Response.json({ success: false, data: null, error: 'Admin verification is unavailable; metrics remain protected' }, { status: 503, headers });
  }
}
