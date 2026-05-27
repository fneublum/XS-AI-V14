// Shared CORS helper for all Edge Functions.
//
// ALLOWED_ORIGINS is driven by the ALLOWED_ORIGINS env secret (comma-separated)
// so we can change it without redeploying code. Falls back to a hard-coded
// list of production + local dev origins.
//
// Webhooks (Twilio, Meta/WhatsApp, QuickBooks) do NOT need CORS — they're
// server-to-server and should use the `webhookResponse` helper instead of
// pulling in these CORS headers.

const FALLBACK_ALLOWED_ORIGINS = [
  'https://xs-erp.appspot.com',
  'https://xs-erp-489872954398.us-central1.run.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:62121',
];

function parseAllowlist(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) return FALLBACK_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Always allow any localhost / 127.0.0.1 origin regardless of the
 *  ALLOWED_ORIGINS secret. Dev ports shift all the time (Vite may
 *  pick 5173, 62121, 3000…) and we don't want to re-set the secret
 *  every time. Safe because localhost requests only reach this edge
 *  function from a developer's own machine. */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowlist = parseAllowlist();
  const allowed = allowlist.includes(origin) || isLocalhostOrigin(origin);

  // Echo back the exact origin (so credentials can flow) ONLY if allowed.
  // If not allowed, send 'null' — browsers block the response.
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(req),
  });
}
