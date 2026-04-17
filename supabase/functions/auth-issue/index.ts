// Auth Issue — Supabase Edge Function
//
// Temporary bridge that converts the app's custom-users plaintext login
// into a short-lived Supabase-compatible JWT. Phase 1e will replace the
// custom users table with Supabase Auth and delete this function.
//
// Flow:
// 1. Client calls with { username, password }.
// 2. Function looks up the row in the `users` table (via service role,
//    so it can read even without an existing auth session).
// 3. Plaintext compare — same broken check Login.tsx performs today.
//    This is NOT a new vulnerability; it preserves current behavior
//    while moving the check server-side where the credentials never
//    transit past Supabase's TLS boundary (no client bundle shipment).
// 4. If valid, signs an HS256 JWT using SUPABASE_JWT_SECRET with the
//    claims Supabase's own GoTrue expects, so `auth.getUser()` in the
//    other Edge Functions accepts it natively.
//
// Security notes:
// - Token is short-lived (1 hour) to limit blast radius if stolen.
// - `role: "authenticated"` so RLS sees the user as logged in.
// - `sub` is the users.id; `app_metadata.allowed_company_ids` carries
//   the per-tenant authorization list for future RLS policies.
// - Rate limiting should be added at the gateway (Supabase pro tier).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create as signJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') || '';

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

interface LoginRequest {
    username?: string;
    password?: string;
}

interface UserRow {
    id: string;
    username: string;
    email: string | null;
    password: string;
    role: string | null;
    allowed_company_ids: string[] | null;
}

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    const corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (!SUPABASE_JWT_SECRET) {
        console.error('[auth-issue] SUPABASE_JWT_SECRET not configured');
        return json({ error: 'Auth not configured' }, 500, corsHeaders);
    }

    let body: LoginRequest;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
        return json({ error: 'Missing credentials' }, 400, corsHeaders);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: user, error } = await supabase
        .from('users')
        .select('id, username, email, password, role, allowed_company_ids')
        .eq('username', username)
        .maybeSingle<UserRow>();

    // Constant-shape response to prevent user enumeration.
    const invalid = () => json({ error: 'Invalid credentials' }, 401, corsHeaders);

    if (error || !user) return invalid();
    if (user.password !== password) return invalid();

    // Sign a Supabase-compatible JWT.
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SUPABASE_JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );

    const now = getNumericDate(0);
    const exp = getNumericDate(TOKEN_TTL_SECONDS);

    const payload = {
        sub: user.id,
        email: user.email ?? undefined,
        aud: 'authenticated',
        role: 'authenticated',
        iat: now,
        exp,
        app_metadata: {
            provider: 'xs-users',
            role: user.role ?? 'user',
            allowed_company_ids: user.allowed_company_ids ?? [],
        },
        user_metadata: {
            username: user.username,
        },
    };

    const token = await signJwt({ alg: 'HS256', typ: 'JWT' }, payload, key);

    console.log(`[auth-issue] issued token for user=${user.id} ttl=${TOKEN_TTL_SECONDS}s`);

    return json(
        {
            token,
            expiresIn: TOKEN_TTL_SECONDS,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                allowed_company_ids: user.allowed_company_ids ?? [],
            },
        },
        200,
        corsHeaders,
    );
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
