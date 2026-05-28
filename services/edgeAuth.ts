// Edge Function auth + invocation helper.
//
// Two token sources are supported, in priority order:
//
// 1. Supabase Auth session (v1 / current). After Login.tsx calls
//    supabase.auth.signInWithPassword, the access_token lives in the
//    Supabase client (persisted to localStorage with autoRefreshToken).
//    We mirror it into a module-local cache via onAuthStateChange so the
//    sync getEdgeToken() signature still works for legacy callers.
//
// 2. Legacy auth-issue JWT (v2 / fallback). The v2 LoginV2 still calls
//    issueEdgeToken() which posts to the auth-issue Edge Function and
//    stashes the returned JWT in sessionStorage. Kept intact so v2
//    routes don't break during the cutover. Decommission path: once v2
//    is also on supabase.auth, delete the auth-issue function, drop
//    setEdgeToken/clearEdgeToken/issueEdgeToken, and rotate the JWT
//    signing secret (memory note: deferred since 2026-04-17).
//
// Both token shapes are signed with the project's JWT secret, so any
// Edge Function deployed with verify_jwt: true accepts either.

import { getSupabaseClient, getSupabaseConfig } from './supabase';

const TOKEN_KEY = 'xs_edge_auth_token';
const TOKEN_EXPIRY_KEY = 'xs_edge_auth_exp'; // epoch seconds

/**
 * The synthetic-email domain used to map usernames into Supabase Auth
 * identities. See scripts/backfill-supabase-auth.mjs for the rationale
 * and the corresponding backfill. Login.tsx imports this so the
 * username → email mapping lives in one place.
 */
export const SYNTHETIC_EMAIL_DOMAIN = 'xs-internal.local';

// Cache the current Supabase access token in module scope so the sync
// getEdgeToken() can return it without awaiting a Promise. Kept fresh
// by onAuthStateChange — token refresh, sign-in, and sign-out all fire
// the callback, so the cached value is never more than a tick stale.
let supabaseAccessToken: string | null = null;
try {
    const client = getSupabaseClient();
    // Initial population: read whatever session already exists in storage.
    client.auth.getSession().then(({ data }) => {
        supabaseAccessToken = data.session?.access_token ?? null;
    }).catch(() => { /* no session yet — fine */ });
    client.auth.onAuthStateChange((_event, session) => {
        supabaseAccessToken = session?.access_token ?? null;
    });
} catch {
    // getSupabaseClient throws only if env is broken at bundle time —
    // edge functions would be unusable anyway. Leave the cache null.
}

export interface IssuedUser {
    id: string;
    username: string;
    email: string | null;
    role: string | null;
    allowed_company_ids: string[];
}

export interface IssueResult {
    token: string;
    expiresIn: number;
    user: IssuedUser;
}

export function setEdgeToken(token: string, expiresInSeconds: number): void {
    try {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(
            TOKEN_EXPIRY_KEY,
            String(Math.floor(Date.now() / 1000) + expiresInSeconds),
        );
    } catch {
        // sessionStorage blocked (private mode?) — fall back to in-memory.
        inMemoryToken = { token, expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds };
    }
}

export function clearEdgeToken(): void {
    try {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    } catch {
        /* ignore */
    }
    inMemoryToken = null;
}

let inMemoryToken: { token: string; expiresAt: number } | null = null;

export function getEdgeToken(): string | null {
    // Prefer the Supabase Auth session — it's the canonical v1 token and
    // is auto-refreshed by the supabase-js client.
    if (supabaseAccessToken) return supabaseAccessToken;

    // Legacy v2 / auth-issue fallback. The sessionStorage path remains
    // for routes that still call issueEdgeToken().
    try {
        const token = sessionStorage.getItem(TOKEN_KEY);
        const expStr = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
        if (token && expStr) {
            const exp = parseInt(expStr, 10);
            if (!isNaN(exp) && exp > Math.floor(Date.now() / 1000)) return token;
        }
    } catch {
        /* fall through */
    }
    if (inMemoryToken && inMemoryToken.expiresAt > Math.floor(Date.now() / 1000)) {
        return inMemoryToken.token;
    }
    return null;
}

export async function issueEdgeToken(
    username: string,
    password: string,
): Promise<IssueResult> {
    const { url, key } = getSupabaseConfig();
    // The Supabase Functions gateway rejects with
    // UNAUTHORIZED_NO_AUTH_HEADER when `Authorization` is absent, even
    // for functions deployed with --no-verify-jwt. For this login
    // bootstrap call we haven't got a user token yet, so use the anon
    // key as the bearer — the function itself verifies credentials.
    const resp = await fetch(`${url}/functions/v1/auth-issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: key,
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(data?.error || `auth-issue failed (${resp.status})`);
    }
    setEdgeToken(data.token, data.expiresIn);
    return data;
}

export interface InvokeOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    params?: Record<string, string>;
    /** If true, call succeeds without a user token (anon key only). */
    allowAnon?: boolean;
}

/**
 * Call a Supabase Edge Function with the current user's issued token
 * as the Authorization bearer, plus the Supabase anon key as `apikey`
 * (required by the Supabase functions gateway).
 *
 * Throws if no user token is available (unless `allowAnon: true`).
 */
export async function invokeEdgeFunction(
    fnName: string,
    opts: InvokeOptions = {},
): Promise<any> {
    const { method = 'POST', body, params, allowAnon = false } = opts;
    const { url, key } = getSupabaseConfig();

    const token = getEdgeToken();
    if (!token && !allowAnon) {
        // Distinguish "never logged in" from "session expired" so the UI
        // can prompt the user to sign back in instead of showing a scary
        // generic error.
        const hadToken = (() => {
            try { return !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
        })();
        // Token slot is still populated but past exp → stale; wipe it.
        if (hadToken) clearEdgeToken();
        throw new Error(
            hadToken
                ? `Your session expired. Please sign out and sign back in, then retry.`
                : `Edge function ${fnName} requires a logged-in session. Please sign in.`,
        );
    }

    const qs = params
        ? '?' + new URLSearchParams(params).toString()
        : '';
    const fullUrl = `${url}/functions/v1/${fnName}${qs}`;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${token ?? key}`,
    };

    const resp = await fetch(fullUrl, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        // Server rejected our token — treat as expired and drop it so
        // the next call surfaces the "please sign in" path instead of
        // re-sending the same bad token. Broadcast a window event so a
        // top-level banner can prompt the user to re-auth, instead of
        // the failure being buried in the console.
        if (resp.status === 401 && !allowAnon) {
            clearEdgeToken();
            try {
                window.dispatchEvent(new CustomEvent('xs-session-expired', {
                    detail: { fnName, ranAt: new Date().toISOString() },
                }));
            } catch { /* SSR / older runtimes */ }
            throw new Error(
                'Your session expired. Please sign out and sign back in, then retry.',
            );
        }
        throw new Error(data?.error || `${fnName} failed (${resp.status})`);
    }
    return data;
}
