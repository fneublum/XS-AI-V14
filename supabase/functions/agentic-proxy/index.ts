// Agentic Proxy — Supabase Edge Function
//
// Server-side pass-through for the XS-agentic control-plane that lives on
// the Mac mini and is exposed via Tailscale Funnel
// (https://maxs-mac-mini.tailb21dd3.ts.net). Some browsers / corporate
// networks can't reach `*.ts.net` directly, so we proxy through Supabase
// — the browser only ever talks to *.supabase.co (which already works
// everywhere because the app uses it for auth + DB + every other RPC).
//
// Path mapping
//   Browser request:  POST  /functions/v1/agentic-proxy/chat/messages
//                     GET   /functions/v1/agentic-proxy/chat/personas
//                     etc.
//   Upstream:         https://maxs-mac-mini.tailb21dd3.ts.net/chat/messages
//
// Security
// - Requires a valid app JWT via _shared/auth.ts (same gate as the other
//   proxies).
// - CORS restricted via _shared/cors.ts.
// - The control-plane itself has no auth (it lives on the tailnet); this
//   edge function is the only public path in.
// - Forwards a fixed `x-actor: felipe` header so the control-plane logs
//   actions correctly. (Multi-user later: map authedUser.id → actor.)
//
// Deploy
//   supabase functions deploy agentic-proxy --project-ref qfskvevighylzzmyiwre
//
// No new secrets — the upstream URL is hard-coded because it's not a
// credential, and rotating the funnel is a one-line edit + redeploy.

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const UPSTREAM = 'https://maxs-mac-mini.tailb21dd3.ts.net';

// 25 MB upload cap (attachments are base64-encoded data-URLs in chat
// messages; PDFs/screenshots from V14 fit comfortably under this).
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Reasonable per-request timeout. HERMES bridges can run 20-90s, so the
// composer's send path needs headroom — but we still want to fail rather
// than hang forever.
const UPSTREAM_TIMEOUT_MS = 120_000;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const cors = buildCorsHeaders(req);

  // Auth gate — same JWT the other proxies use.
  const authed = await requireUser(req);
  if (authed instanceof Response) return authed;

  // Strip the `/agentic-proxy` prefix; everything after it is the
  // upstream path. Supabase's edge URL is
  // /functions/v1/agentic-proxy/<rest>, and only `/agentic-proxy/<rest>`
  // reaches us as req.url's pathname.
  const url = new URL(req.url);
  const idx = url.pathname.indexOf('/agentic-proxy');
  if (idx === -1) {
    return new Response(JSON.stringify({ error: 'bad proxy path' }), {
      status: 400,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }
  const upstreamPath = url.pathname.slice(idx + '/agentic-proxy'.length) || '/';
  const upstreamUrl = UPSTREAM + upstreamPath + url.search;

  // Read body once. Edge Functions' Request body is a stream; we need to
  // re-emit it to the upstream fetch.
  let body: Uint8Array | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: `payload too large (>${MAX_BODY_BYTES} bytes)` }),
        { status: 413, headers: { ...cors, 'content-type': 'application/json' } },
      );
    }
    body = buf;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        'content-type': req.headers.get('content-type') || 'application/json',
        // Authed-user → control-plane actor. Future: derive from
        // authed.email/id once the control-plane supports multi-actor
        // auth. For now, all writes are attributed to felipe (the only
        // human approver in the loop).
        'x-actor': 'felipe',
      },
      body,
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `upstream fetch failed: ${msg}` }),
      { status: 502, headers: { ...cors, 'content-type': 'application/json' } },
    );
  }
  clearTimeout(timer);

  // Pass body + status through. Preserve content-type so the client's
  // strict-JSON parser sees what the control-plane intended.
  const upstreamBody = await upstream.arrayBuffer();
  return new Response(upstreamBody, {
    status: upstream.status,
    headers: {
      ...cors,
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
});
