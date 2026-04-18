// Edge Function auth + invocation helper.
//
// Central place to:
// - Store the short-lived JWT issued by the `auth-issue` Edge Function
//   (see Login.tsx for the login-flow integration).
// - Invoke any Supabase Edge Function with that JWT auto-attached.
//
// The JWT lives in sessionStorage (cleared on tab close) rather than
// localStorage, to reduce long-term XSS exfiltration risk. The Supabase
// anon key is read from Vite env — never hardcoded in the bundle.

import { getSupabaseConfig } from './supabase';

const TOKEN_KEY = 'xs_edge_auth_token';
const TOKEN_EXPIRY_KEY = 'xs_edge_auth_exp'; // epoch seconds

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
        throw new Error(
            `Edge function ${fnName} requires a logged-in session. ` +
                `Call issueEdgeToken() first.`,
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
        throw new Error(data?.error || `${fnName} failed (${resp.status})`);
    }
    return data;
}
