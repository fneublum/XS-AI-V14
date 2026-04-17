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
  'http://localhost:3000',
  'http://localhost:5173',
];

function parseAllowlist(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) return FALLBACK_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowlist = parseAllowlist();
  const allowed = allowlist.includes(origin);

  // Echo back the exact origin (so credentials can flow) ONLY if allowed.
  // If not allowed, send 'null' — browsers block the response.
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
