// QuickBooks OAuth 2.0 — Supabase Edge Function
// Handles connect, callback, refresh, and status check for QBO integration
// URL: https://qfskvevighylzzmyiwre.supabase.co/functions/v1/qb-auth

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// QuickBooks OAuth endpoints
const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_USERINFO_URL = "https://accounts.platform.intuit.com/v1/openid_connect/userinfo";

function getEnv(key: string): string {
    const val = Deno.env.get(key);
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

function getSupabase() {
    return createClient(
        getEnv("SUPABASE_URL"),
        getEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
}

// ── Authorize: redirect user to Intuit consent page ──────────
async function handleAuthorize(url: URL): Promise<Response> {
    const clientId = getEnv("QB_CLIENT_ID");
    const redirectUri = getEnv("QB_REDIRECT_URI");
    const companyId = url.searchParams.get("companyId") || "ALL";

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        scope: "com.intuit.quickbooks.accounting",
        redirect_uri: redirectUri,
        state: companyId, // pass company ID through OAuth state
    });

    const authUrl = `${QB_AUTH_URL}?${params.toString()}`;
    return new Response(JSON.stringify({ authUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// ── Callback: exchange auth code for tokens ──────────────────
async function handleCallback(url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const companyId = url.searchParams.get("state") || "ALL";

    if (!code || !realmId) {
        return new Response(
            JSON.stringify({ error: "Missing code or realmId" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const clientId = getEnv("QB_CLIENT_ID");
    const clientSecret = getEnv("QB_CLIENT_SECRET");
    const redirectUri = getEnv("QB_REDIRECT_URI");

    const tokenResp = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        }),
    });

    if (!tokenResp.ok) {
        const err = await tokenResp.text();
        console.error("Token exchange failed:", err);
        return new Response(
            JSON.stringify({ error: "Token exchange failed", details: err }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const tokenData = await tokenResp.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Store tokens in Supabase
    const supabase = getSupabase();
    const { error: dbError } = await supabase
        .from("qb_tokens")
        .upsert({
            company_id: companyId,
            realm_id: realmId,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_expiry: expiresAt,
            updated_at: new Date().toISOString(),
        }, { onConflict: "company_id" });

    if (dbError) {
        console.error("DB save error:", dbError);
        return new Response(
            JSON.stringify({ error: "Failed to save tokens", details: dbError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    // Return an HTML page that closes the popup and notifies the opener
    const html = `<!DOCTYPE html>
<html><body>
<h2>QuickBooks Connected Successfully!</h2>
<p>This window will close automatically...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'QB_AUTH_SUCCESS', realmId: '${realmId}' }, '*');
  }
  setTimeout(() => window.close(), 1500);
</script>
</body></html>`;

    return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
}

// ── Refresh: get new access token using refresh token ────────
async function handleRefresh(req: Request): Promise<Response> {
    const { companyId } = await req.json();
    if (!companyId) {
        return new Response(
            JSON.stringify({ error: "companyId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const supabase = getSupabase();
    const { data: tokenRow, error } = await supabase
        .from("qb_tokens")
        .select("*")
        .eq("company_id", companyId)
        .single();

    if (error || !tokenRow) {
        return new Response(
            JSON.stringify({ error: "No QB connection found for this company" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const clientId = getEnv("QB_CLIENT_ID");
    const clientSecret = getEnv("QB_CLIENT_SECRET");

    const tokenResp = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenRow.refresh_token,
        }),
    });

    if (!tokenResp.ok) {
        const err = await tokenResp.text();
        console.error("Token refresh failed:", err);
        return new Response(
            JSON.stringify({ error: "Token refresh failed", details: err }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const newTokens = await tokenResp.json();
    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

    await supabase
        .from("qb_tokens")
        .update({
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token,
            token_expiry: expiresAt,
            updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);

    return new Response(
        JSON.stringify({ success: true, expiresAt }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

// ── Status: check if QB is connected for a company ───────────
async function handleStatus(url: URL): Promise<Response> {
    const companyId = url.searchParams.get("companyId") || "ALL";

    const supabase = getSupabase();
    const { data: tokenRow, error } = await supabase
        .from("qb_tokens")
        .select("realm_id, token_expiry, updated_at")
        .eq("company_id", companyId)
        .single();

    if (error || !tokenRow) {
        return new Response(
            JSON.stringify({ connected: false }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const isExpired = new Date(tokenRow.token_expiry) < new Date();

    return new Response(
        JSON.stringify({
            connected: true,
            realmId: tokenRow.realm_id,
            lastRefreshed: tokenRow.updated_at,
            tokenExpired: isExpired,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

// ── Disconnect: remove QB tokens for a company ───────────────
async function handleDisconnect(req: Request): Promise<Response> {
    const { companyId } = await req.json();
    if (!companyId) {
        return new Response(
            JSON.stringify({ error: "companyId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const supabase = getSupabase();
    await supabase.from("qb_tokens").delete().eq("company_id", companyId);

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

// ── Main Router ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const path = url.pathname.split("/").pop() || "";

        // Route by last path segment or by action query param
        const action = url.searchParams.get("action") || path;

        switch (action) {
            case "authorize":
                return await handleAuthorize(url);
            case "callback":
                return await handleCallback(url);
            case "refresh":
                return await handleRefresh(req);
            case "status":
                return await handleStatus(url);
            case "disconnect":
                return await handleDisconnect(req);
            default:
                return new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
        }
    } catch (err: any) {
        console.error("qb-auth error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Internal error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
