// Twilio Send — Supabase Edge Function
// Sends WhatsApp messages via Twilio REST API.
//
// Security:
// - Requires authenticated Supabase user (JWT in Authorization header).
// - CORS restricted to the allowlist in _shared/cors.ts.
// - Credentials are read from env (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)
//   rather than the request body. Passing creds in the body is rejected
//   with a clear error so callers migrate to the server-managed flow.

import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';

const MAX_MESSAGE_LEN = 4096;

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        console.error('[twilio-send] Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
        return json({ error: 'Twilio not configured' }, 500, corsHeaders);
    }

    try {
        const body = await req.json();
        const { to, from, message, contentSid } = body ?? {};

        // Reject client-supplied credentials — force use of server env secrets.
        if (body && (body.accountSid || body.authToken)) {
            return json(
                { error: 'Do not pass accountSid/authToken — configured server-side' },
                400,
                corsHeaders,
            );
        }

        if (typeof to !== 'string' || !to || typeof from !== 'string' || !from) {
            return json({ error: 'Missing required fields: to, from' }, 400, corsHeaders);
        }
        if (!message && !contentSid) {
            return json(
                { error: 'Either message or contentSid is required' },
                400,
                corsHeaders,
            );
        }
        if (message && (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN)) {
            return json({ error: 'Invalid message' }, 400, corsHeaders);
        }
        if (contentSid && typeof contentSid !== 'string') {
            return json({ error: 'Invalid contentSid' }, 400, corsHeaders);
        }

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const authHeader = 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const params: Record<string, string> = { To: to, From: from };
        if (contentSid) params.ContentSid = contentSid;
        else params.Body = message;

        const twilioResp = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: authHeader,
            },
            body: new URLSearchParams(params).toString(),
        });

        const twilioData = await twilioResp.json().catch(() => ({}));

        if (!twilioResp.ok) {
            console.error('[twilio-send] upstream error:', twilioData);
            return json(
                { error: 'Twilio API error', code: twilioData.code },
                502,
                corsHeaders,
            );
        }

        console.log(
            `[twilio-send] user=${auth.user.id} sid=${twilioData.sid} status=${twilioData.status}`,
        );

        return json(
            { success: true, sid: twilioData.sid, status: twilioData.status },
            200,
            corsHeaders,
        );
    } catch (err) {
        console.error('[twilio-send] error:', err);
        return json({ error: 'Internal error' }, 500, corsHeaders);
    }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
