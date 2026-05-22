// Gemini Proxy — Supabase Edge Function
//
// Generic pass-through for `@google/genai` generateContent calls. Lets
// the client SDK's request payload flow through unchanged while the
// GEMINI_API_KEY lives only in Supabase env — never in the browser bundle.
//
// Input (mirrors `ai.models.generateContent({ ... })`):
// {
//   model: "gemini-2.0-flash",
//   contents: string | Content[],
//   config?: {
//     responseMimeType?: string,
//     responseSchema?: object,
//     tools?: Tool[],
//     systemInstruction?: string | Content,
//     temperature?: number,
//     // ...any other generationConfig keys
//   }
// }
//
// Output (subset of the SDK's GenerateContentResponse shape):
// {
//   text: string,
//   functionCalls?: Array<{ name, args }>,
//   candidates: Candidate[],
//   usageMetadata?: object,
// }
//
// Security:
// - Requires a valid Supabase user JWT via _shared/auth.ts.
// - CORS restricted via _shared/cors.ts.
// - Hard payload cap to prevent cost-bomb attacks.
// - Model allowlist so clients can't invoke non-approved models.

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

// Request body size cap (bytes). The SDK's payload for normal prompts
// is well under this; files/inlineData pushes up fast so we gate it.
// 25 MB cap — covers PDFs up to ~17-18 MB after base64 + JSON envelope
// overhead. Gemini's `generateContent` accepts inline payloads up to
// 20 MB; anything bigger should go through the Files API (separate
// architecture). This is also the practical OCR ceiling: scanned PDFs
// from EC4's flow rarely exceed 10 MB.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Allowed models. Edit to add new Gemini variants.
const ALLOWED_MODELS = new Set([
    // Gemini 3 (current)
    'gemini-3-pro-preview',
    'gemini-3-pro',
    // Gemini 2.5 (current, may require paid tier on some projects)
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-latest',
    // Gemini 2.0 (deprecated by Google for new users, kept for old code)
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-lite',
    // Gemini 1.5 (deprecated)
    'gemini-1.5-flash',
    'gemini-1.5-pro',
]);

// These `config` keys are top-level in the REST payload; everything
// else falls into generationConfig.
const TOP_LEVEL_CONFIG_KEYS = new Set([
    'tools',
    'toolConfig',
    'safetySettings',
    'systemInstruction',
    'cachedContent',
]);

interface GenerateContentRequest {
    model: string;
    contents: unknown;
    config?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    if (!GEMINI_API_KEY) {
        console.error('[gemini-proxy] GEMINI_API_KEY not configured');
        return json({ error: 'Gemini not configured' }, 500, corsHeaders);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
        return json({ error: 'Payload too large' }, 413, corsHeaders);
    }

    let body: GenerateContentRequest;
    try {
        body = JSON.parse(raw);
    } catch {
        return json({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    const { model, contents, config } = body ?? {};

    if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
        return json({ error: `Model not allowed: ${model}` }, 400, corsHeaders);
    }
    if (contents === undefined || contents === null) {
        return json({ error: 'Missing contents' }, 400, corsHeaders);
    }

    // Build REST payload.
    const restBody: Record<string, unknown> = {
        contents: normalizeContents(contents),
    };

    if (config && typeof config === 'object') {
        const generationConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(config)) {
            if (TOP_LEVEL_CONFIG_KEYS.has(k)) {
                restBody[k] = v;
            } else {
                generationConfig[k] = v;
            }
        }
        if (Object.keys(generationConfig).length > 0) {
            restBody.generationConfig = generationConfig;
        }
    }

    // systemInstruction accepts string shorthand in the SDK — normalize.
    if (typeof restBody.systemInstruction === 'string') {
        restBody.systemInstruction = {
            role: 'user',
            parts: [{ text: restBody.systemInstruction }],
        };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;

    let upstream: Response;
    try {
        upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(restBody),
        });
    } catch (err) {
        console.error('[gemini-proxy] upstream fetch failed:', err);
        return json({ error: 'Upstream unreachable' }, 502, corsHeaders);
    }

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
        console.error(
            `[gemini-proxy] upstream ${upstream.status}: ${upstreamText.slice(0, 500)}`,
        );
        // Forward Google's error message so the client can surface
        // "API key invalid", "quota exceeded", etc. rather than a
        // generic "Gemini API error".
        let upstreamMessage = upstreamText.slice(0, 300);
        try {
            const parsed = JSON.parse(upstreamText);
            upstreamMessage = parsed?.error?.message ?? upstreamMessage;
        } catch { /* keep raw */ }
        return json(
            { error: 'Gemini API error', status: upstream.status, detail: upstreamMessage },
            502,
            corsHeaders,
        );
    }

    let upstreamJson: any;
    try {
        upstreamJson = JSON.parse(upstreamText);
    } catch {
        return json({ error: 'Invalid upstream response' }, 502, corsHeaders);
    }

    const text = extractText(upstreamJson);
    const functionCalls = extractFunctionCalls(upstreamJson);

    console.log(
        `[gemini-proxy] user=${auth.user.id} model=${model} textLen=${text.length} fcCount=${functionCalls.length}`,
    );

    return json(
        {
            text,
            functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
            candidates: upstreamJson.candidates ?? [],
            usageMetadata: upstreamJson.usageMetadata,
        },
        200,
        corsHeaders,
    );
});

function normalizeContents(contents: unknown): unknown {
    // SDK accepts a bare string — the REST API expects [{ role, parts }].
    if (typeof contents === 'string') {
        return [{ role: 'user', parts: [{ text: contents }] }];
    }
    return contents;
}

function extractText(resp: any): string {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    let out = '';
    for (const p of parts) {
        if (typeof p?.text === 'string') out += p.text;
    }
    return out;
}

function extractFunctionCalls(resp: any): Array<{ name: string; args: unknown }> {
    const calls: Array<{ name: string; args: unknown }> = [];
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return calls;
    for (const p of parts) {
        if (p?.functionCall && typeof p.functionCall.name === 'string') {
            calls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
        }
    }
    return calls;
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
