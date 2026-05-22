// Anthropic Proxy — Supabase Edge Function
//
// Server-side pass-through for Anthropic Messages API calls. Keeps
// ANTHROPIC_API_KEY out of the browser bundle and applies the same
// auth + size + model gates the gemini-proxy uses.
//
// Input (mirrors the v2 orchestrator's anthropicProvider shape, which
// is itself the Messages API body plus a metadata field):
// {
//   model: "claude-opus-4-7",
//   max_tokens: 4096,
//   temperature: 0.2,
//   system?: string,
//   messages: Array<{ role: 'user' | 'assistant', content: ... }>,
//   tools?: Array<{ name, description, input_schema }>,
//   metadata?: { requestId?: string, taskType?: string }
// }
//
// Output — Anthropic's Messages response unchanged, plus adapter fields
// the orchestrator expects (handled client-side in
// v2/services/ai/providers/anthropicProvider.ts).
//
// Security
// - Requires a valid Supabase user JWT via _shared/auth.ts.
// - CORS restricted via _shared/cors.ts.
// - Hard payload cap so files-as-base64 can't cost-bomb us.
// - Model allowlist so clients can't invoke unapproved Claude SKUs.
//
// Deploy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref qfskvevighylzzmyiwre
//   supabase functions deploy anthropic-proxy --project-ref qfskvevighylzzmyiwre

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Edit to add new Anthropic variants. Mirrors the orchestrator's
// v2/services/ai/config.ts models field for cross-checking.
const ALLOWED_MODELS = new Set([
    'claude-opus-4-7',
    'claude-opus-4-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
]);

interface MessagesRequest {
    model: string;
    max_tokens?: number;
    temperature?: number;
    system?: string;
    messages: unknown;
    tools?: unknown;
    metadata?: Record<string, unknown>;
}

function json(body: unknown, status: number, headers: Record<string, string>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (!ANTHROPIC_API_KEY) {
        console.error('[anthropic-proxy] ANTHROPIC_API_KEY not configured');
        return json({ error: 'AI not configured' }, 500, corsHeaders);
    }

    const authResult = await requireUser(req, corsHeaders);
    if ('response' in authResult) return authResult.response;

    // Read the raw body and enforce the size cap on actual bytes received.
    // We previously trusted Content-Length, which is client-controlled — a
    // caller could send Content-Length: 0 with a 100MB body and bypass the
    // cap entirely, then bill the team via the upstream Anthropic request.
    let raw: string;
    try {
        raw = await req.text();
    } catch {
        return json({ error: 'Failed to read request body' }, 400, corsHeaders);
    }
    if (raw.length > MAX_BODY_BYTES) {
        return json(
            { error: `Request too large (${raw.length} > ${MAX_BODY_BYTES} bytes)` },
            413,
            corsHeaders,
        );
    }

    let body: MessagesRequest;
    try {
        body = JSON.parse(raw) as MessagesRequest;
    } catch {
        return json({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    if (!body || typeof body !== 'object') {
        return json({ error: 'Invalid request body' }, 400, corsHeaders);
    }

    if (!body.model || !ALLOWED_MODELS.has(body.model)) {
        return json(
            { error: `Model "${body.model}" not allowed`, allowed: [...ALLOWED_MODELS] },
            400,
            corsHeaders,
        );
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return json({ error: 'messages[] is required' }, 400, corsHeaders);
    }

    // Build the Anthropic payload. metadata.user_id defaults to the
    // caller's Supabase user so Anthropic abuse reports tie back.
    const anthropicBody: Record<string, unknown> = {
        model: body.model,
        max_tokens: body.max_tokens ?? 4096,
        messages: body.messages,
    };
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
    if (body.system) anthropicBody.system = body.system;
    if (body.tools) anthropicBody.tools = body.tools;
    anthropicBody.metadata = {
        ...(body.metadata ?? {}),
        user_id: authResult.user.id,
    };

    let upstream: Response;
    try {
        upstream = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': ANTHROPIC_VERSION,
                'x-api-key': ANTHROPIC_API_KEY,
            },
            body: JSON.stringify(anthropicBody),
        });
    } catch (err) {
        console.error('[anthropic-proxy] upstream fetch failed', err);
        return json({ error: 'Upstream unreachable' }, 502, corsHeaders);
    }

    // Pass through the Anthropic response unchanged — orchestrator's
    // anthropicProvider parses `content[]`, `usage.*`, `model`, etc.
    const text = await upstream.text();
    return new Response(text, {
        status: upstream.status,
        headers: {
            ...corsHeaders,
            'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        },
    });
});
