// QuickBooks OAuth 2.0 — Supabase Edge Function
// Handles connect, callback, refresh, status, and disconnect for QBO.
//
// Security:
// - Client-invoked actions (authorize/refresh/status/disconnect) require a
//   valid Supabase JWT via _shared/auth.ts.
// - The OAuth `callback` endpoint is browser-reached via Intuit's redirect
//   and CANNOT carry a JWT. It relies on the OAuth `state` parameter (which
//   Intuit echoes back) for context. This is the same trust model any
//   OAuth-callback URL has.
// - CORS is restricted via _shared/cors.ts to the production + local-dev
//   origins; callback responses use text/html without CORS restrictions
//   since they're rendered directly by the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function getEnv(key: string): string {
    const val = Deno.env.get(key);
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

function getSupabase() {
    return createClient(
        getEnv('SUPABASE_URL'),
        getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    );
}

// ── Authorize: build Intuit consent URL ──────────────────────
async function handleAuthorize(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
    const clientId = getEnv('QB_CLIENT_ID');
    const redirectUri = getEnv('QB_REDIRECT_URI');
    const companyId = url.searchParams.get('companyId') || 'ALL';

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'com.intuit.quickbooks.accounting',
        redirect_uri: redirectUri,
        state: companyId,
    });

    const authUrl = `${QB_AUTH_URL}?${params.toString()}`;
    return json({ authUrl }, 200, corsHeaders);
}

// ── Callback: exchange auth code for tokens ──────────────────
// Reached via Intuit browser redirect — no JWT available.
async function handleCallback(url: URL): Promise<Response> {
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');
    const companyId = url.searchParams.get('state') || 'ALL';

    if (!code || !realmId) {
        return new Response('Missing code or realmId', { status: 400 });
    }

    const clientId = getEnv('QB_CLIENT_ID');
    const clientSecret = getEnv('QB_CLIENT_SECRET');
    const redirectUri = getEnv('QB_REDIRECT_URI');

    const tokenResp = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
            Accept: 'application/json',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        }),
    });

    if (!tokenResp.ok) {
        console.error('[qb-auth] Token exchange failed:', await tokenResp.text());
        return new Response('Token exchange failed', { status: 400 });
    }

    const tokenData = await tokenResp.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const supabase = getSupabase();
    const { error: dbError } = await supabase
        .from('qb_tokens')
        .upsert(
            {
                company_id: companyId,
                realm_id: realmId,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                token_expiry: expiresAt,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'company_id' },
        );

    if (dbError) {
        console.error('[qb-auth] DB save error:', dbError);
        return new Response('Failed to save tokens', { status: 500 });
    }

    // Pass realmId through postMessage so opener can confirm; origin is
    // constrained to the app's origin when the opener picks it up.
    const html = `<!DOCTYPE html>
<html><body>
<h2>QuickBooks Connected Successfully!</h2>
<p>This window will close automatically...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'QB_AUTH_SUCCESS', realmId: ${JSON.stringify(realmId)} }, '*');
  }
  setTimeout(() => window.close(), 1500);
</script>
</body></html>`;

    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
    });
}

async function handleRefresh(
    req: Request,
    corsHeaders: Record<string, string>,
): Promise<Response> {
    const { companyId } = await req.json();
    if (!companyId) return json({ error: 'companyId is required' }, 400, corsHeaders);

    const supabase = getSupabase();
    const { data: tokenRow, error } = await supabase
        .from('qb_tokens')
        .select('*')
        .eq('company_id', companyId)
        .single();

    if (error || !tokenRow) {
        return json({ error: 'No QB connection for this company' }, 404, corsHeaders);
    }

    const clientId = getEnv('QB_CLIENT_ID');
    const clientSecret = getEnv('QB_CLIENT_SECRET');

    const tokenResp = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
            Accept: 'application/json',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokenRow.refresh_token,
        }),
    });

    if (!tokenResp.ok) {
        console.error('[qb-auth] Token refresh failed:', await tokenResp.text());
        return json({ error: 'Token refresh failed' }, 400, corsHeaders);
    }

    const newTokens = await tokenResp.json();
    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

    await supabase
        .from('qb_tokens')
        .update({
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token,
            token_expiry: expiresAt,
            updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId);

    return json({ success: true, expiresAt }, 200, corsHeaders);
}

async function handleStatus(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
    const companyId = url.searchParams.get('companyId') || 'ALL';

    const supabase = getSupabase();
    const { data: tokenRow, error } = await supabase
        .from('qb_tokens')
        .select('realm_id, token_expiry, updated_at')
        .eq('company_id', companyId)
        .single();

    if (error || !tokenRow) return json({ connected: false }, 200, corsHeaders);

    const isExpired = new Date(tokenRow.token_expiry) < new Date();
    return json(
        {
            connected: true,
            realmId: tokenRow.realm_id,
            lastRefreshed: tokenRow.updated_at,
            tokenExpired: isExpired,
        },
        200,
        corsHeaders,
    );
}

async function handleDisconnect(
    req: Request,
    corsHeaders: Record<string, string>,
): Promise<Response> {
    const { companyId } = await req.json();
    if (!companyId) return json({ error: 'companyId is required' }, 400, corsHeaders);

    const supabase = getSupabase();
    await supabase.from('qb_tokens').delete().eq('company_id', companyId);
    return json({ success: true }, 200, corsHeaders);
}

// ── Main Router ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    try {
        const url = new URL(req.url);
        const path = url.pathname.split('/').pop() || '';
        const action = url.searchParams.get('action') || path;

        // Callback is reached via browser redirect from Intuit — no JWT.
        if (action === 'callback') {
            return await handleCallback(url);
        }

        // All other actions require an authenticated caller.
        const auth = await requireUser(req, corsHeaders);
        if ('response' in auth) return auth.response;

        switch (action) {
            case 'authorize':
                return await handleAuthorize(url, corsHeaders);
            case 'refresh':
                return await handleRefresh(req, corsHeaders);
            case 'status':
                return await handleStatus(url, corsHeaders);
            case 'disconnect':
                return await handleDisconnect(req, corsHeaders);
            default:
                return json({ error: `Unknown action: ${action}` }, 400, corsHeaders);
        }
    } catch (err) {
        console.error('[qb-auth] error:', err);
        return json({ error: 'Internal error' }, 500, corsHeaders);
    }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
