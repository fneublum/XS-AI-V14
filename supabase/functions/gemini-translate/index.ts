// Gemini Translate — Supabase Edge Function
// Proxies translation requests to Gemini API server-side so the API key
// never leaves the server.
//
// Security: requires a valid Supabase user JWT in Authorization header.

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

// Hard limits to prevent cost-bomb attacks.
const MAX_BATCH_SIZE = 100;
const MAX_DESCRIPTION_LEN = 2000;

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return new Response('Method not allowed', {
            status: 405,
            headers: corsHeaders,
        });
    }

    // Require authenticated caller.
    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    try {
        const body = await req.json();
        const { descriptions, targetCountry } = body ?? {};

        if (!Array.isArray(descriptions) || descriptions.length === 0) {
            return json({ error: 'Missing or empty descriptions array' }, 400, corsHeaders);
        }
        if (descriptions.length > MAX_BATCH_SIZE) {
            return json(
                { error: `Batch too large (max ${MAX_BATCH_SIZE})` },
                400,
                corsHeaders,
            );
        }
        if (descriptions.some(d => typeof d !== 'string' || d.length > MAX_DESCRIPTION_LEN)) {
            return json({ error: 'Invalid description entry' }, 400, corsHeaders);
        }
        const country = typeof targetCountry === 'string' ? targetCountry.slice(0, 80) : 'United States';

        const prompt = `You are a professional translator. Translate these product descriptions to the main language spoken in ${country}. For example: Brazil → Portuguese, Mexico/Honduras/Colombia → Spanish, China → Chinese, United States → English.

Descriptions:
${descriptions.map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}

Return ONLY a JSON array with exactly ${descriptions.length} translated strings, in the same order. No explanation, no markdown, no code fences.`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

        const geminiResp = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'ARRAY',
                        items: { type: 'STRING' },
                    },
                },
            }),
        });

        if (!geminiResp.ok) {
            const errText = await geminiResp.text();
            console.error('[gemini-translate] upstream error:', errText);
            return json(
                { error: 'Translation provider error' },
                502,
                corsHeaders,
            );
        }

        const geminiData = await geminiResp.json();
        const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

        let translated: string[];
        try {
            translated = JSON.parse(rawText);
        } catch {
            const match = rawText.match(/\[[\s\S]*\]/);
            translated = match ? JSON.parse(match[0]) : [];
        }

        if (!Array.isArray(translated)) translated = [];

        console.log(
            `[gemini-translate] user=${auth.user.id} country=${country} n=${translated.length}`,
        );

        return json({ translations: translated }, 200, corsHeaders);
    } catch (err) {
        console.error('[gemini-translate] error:', err);
        return json({ error: 'Internal error' }, 500, corsHeaders);
    }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
