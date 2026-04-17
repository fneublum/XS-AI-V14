// WhatsApp Send — Supabase Edge Function
// Sends messages via Meta WhatsApp Cloud API.
//
// Security: requires a valid Supabase user JWT. Credentials are read
// from env (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN).

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';
const ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '';

const MAX_TEXT_LEN = 4096;

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error('[whatsapp-send] Missing WHATSAPP configuration secrets');
        return json({ error: 'WhatsApp not configured' }, 500, corsHeaders);
    }

    try {
        const body = await req.json();
        const { to, text, templateName, languageCode = 'en_US', components = [] } = body ?? {};

        if (typeof to !== 'string' || !to) {
            return json({ error: "Missing recipient 'to'" }, 400, corsHeaders);
        }
        if (!text && !templateName) {
            return json(
                { error: "Must provide either 'text' or 'templateName'" },
                400,
                corsHeaders,
            );
        }
        if (text && (typeof text !== 'string' || text.length > MAX_TEXT_LEN)) {
            return json({ error: 'Invalid text' }, 400, corsHeaders);
        }
        if (templateName && typeof templateName !== 'string') {
            return json({ error: 'Invalid templateName' }, 400, corsHeaders);
        }
        if (!Array.isArray(components)) {
            return json({ error: 'Invalid components' }, 400, corsHeaders);
        }

        const apiUrl = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
        const payload: Record<string, unknown> = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to.replace('+', ''),
        };

        if (templateName) {
            payload.type = 'template';
            payload.template = {
                name: templateName,
                language: { code: languageCode },
                components,
            };
        } else {
            payload.type = 'text';
            payload.text = { preview_url: false, body: text };
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error('[whatsapp-send] Meta API error:', data);
            return json({ error: 'WhatsApp API error' }, 502, corsHeaders);
        }

        console.log(`[whatsapp-send] user=${auth.user.id} to=${payload.to}`);

        return json({ success: true, data }, 200, corsHeaders);
    } catch (err) {
        console.error('[whatsapp-send] error:', err);
        return json({ error: 'Internal error' }, 500, corsHeaders);
    }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
