// Dropbox upload — receives base64-encoded PDFs from the client and
// pushes them into a per-invoice subfolder under a configurable root.
//
// Auth: requires a logged-in app user. Cross-tenant abuse is impossible
// here because Dropbox itself is one-tenant (the EC4 Dropbox account is
// owned by ops); the user's allowed_company_ids JWT claim is logged for
// audit but not enforced — by design, any EC4 user may save to the
// shared "3 SHIPPED WITH BL" folder.
//
// Credentials: read from `system_settings.dropbox_credentials` as a
// jsonb value of shape:
//   {
//     "appKey":         "...",
//     "appSecret":      "...",
//     "refreshToken":   "...",   // long-lived, generated once via OAuth
//     "rootPath":       "/EC4 COMEC - 3. SHIPPED WITH BL"  // optional override
//   }
// The system_settings row is read with the service-role key (bypasses
// RLS), so the strict regex policy on system_settings (denies any key
// matching `credential|secret|token|...` for client sessions) keeps the
// row out of the browser bundle.
//
// Request body:
//   {
//     "folderName":   "<customer> - CI<invoice#>",   // e.g. "BEATRIZ TEXTIL - CI8004"
//     "files": [
//       { "name": "INV-8004.pdf",  "contentType": "application/pdf", "base64": "..." },
//       { "name": "PL-18211.pdf",  ... },
//       { "name": "BOL-8004.pdf",  ... }
//     ]
//   }
//
// Response: { ok: true, folderPath, uploaded: [{ name, path }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

let corsHeaders: Record<string, string> = {};

const DROPBOX_OAUTH_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_API_BASE = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_BASE = 'https://content.dropboxapi.com/2';

interface DropboxCreds {
    appKey: string;
    appSecret: string;
    refreshToken: string;
    rootPath?: string;
}

interface FilePayload {
    name: string;
    contentType: string;
    base64: string;
}

function getEnv(key: string): string {
    const v = Deno.env.get(key);
    if (!v) throw new Error(`Missing env: ${key}`);
    return v;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

async function loadCredentials(): Promise<DropboxCreds> {
    const supabase = createClient(
        getEnv('SUPABASE_URL'),
        getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    );
    const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'dropbox_credentials')
        .single();
    if (error || !data?.value) {
        throw new Error(
            'Dropbox is not configured. Insert a `dropbox_credentials` row into system_settings. See setup doc.',
        );
    }
    const raw = data.value as Record<string, unknown>;
    const appKey = typeof raw.appKey === 'string' ? raw.appKey : '';
    const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret : '';
    const refreshToken = typeof raw.refreshToken === 'string' ? raw.refreshToken : '';
    const rootPath = typeof raw.rootPath === 'string' ? raw.rootPath : undefined;
    if (!appKey || !appSecret || !refreshToken) {
        throw new Error(
            'dropbox_credentials is missing appKey/appSecret/refreshToken.',
        );
    }
    return { appKey, appSecret, refreshToken, rootPath };
}

async function getAccessToken(creds: DropboxCreds): Promise<string> {
    const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.appKey,
        client_secret: creds.appSecret,
    });
    const resp = await fetch(DROPBOX_OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Dropbox token refresh failed (${resp.status}): ${text}`);
    }
    const body = await resp.json();
    if (!body.access_token) {
        throw new Error('Dropbox token refresh: no access_token in response.');
    }
    return body.access_token as string;
}

async function ensureFolder(accessToken: string, path: string): Promise<void> {
    // create_folder_v2 returns 409 "path/conflict/folder" if it exists —
    // that's fine, treat as success.
    const resp = await fetch(`${DROPBOX_API_BASE}/files/create_folder_v2`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, autorename: false }),
    });
    if (resp.ok) return;
    const text = await resp.text();
    // Dropbox returns a structured error tag; surface it as-is for debugging.
    if (text.includes('"folder"') || text.includes('path/conflict')) {
        // Folder already exists — fine.
        return;
    }
    throw new Error(`Dropbox create_folder_v2 failed (${resp.status}): ${text}`);
}

function decodeBase64(b64: string): Uint8Array {
    // atob is available in Deno. Strips any data-URL prefix the client
    // forgot to remove (e.g. "data:application/pdf;base64,...").
    const commaIdx = b64.indexOf(',');
    const stripped = commaIdx >= 0 && b64.startsWith('data:') ? b64.slice(commaIdx + 1) : b64;
    const binary = atob(stripped);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function uploadFile(
    accessToken: string,
    path: string,
    bytes: Uint8Array,
): Promise<string> {
    // `mode: "overwrite"` so re-saving the same invoice replaces the
    // previous file rather than auto-renaming to "INV-8004 (1).pdf".
    // strict_conflict=false because the folder may not exist yet on the
    // first upload — but we already ensured it. autorename=false makes
    // intent explicit.
    const apiArg = JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
        strict_conflict: false,
    });
    const resp = await fetch(`${DROPBOX_CONTENT_BASE}/files/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': apiArg,
        },
        body: bytes,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Dropbox upload failed for ${path} (${resp.status}): ${text}`);
    }
    const body = await resp.json();
    return (body.path_display as string) || path;
}

// Sanitize a path segment so Dropbox accepts it (no slashes, no leading
// dots, trimmed). Dropbox's only hard rule is no NUL or `/`.
function sanitizeSegment(s: string): string {
    return s
        .replace(/[\\/\x00]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;
    corsHeaders = buildCorsHeaders(req);

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    let payload: { folderName?: string; files?: FilePayload[] };
    try {
        payload = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const folderName = sanitizeSegment(payload.folderName ?? '');
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!folderName) {
        return jsonResponse({ error: 'folderName is required' }, 400);
    }
    if (files.length === 0) {
        return jsonResponse({ error: 'files[] is required and must be non-empty' }, 400);
    }
    for (const f of files) {
        if (!f || typeof f.name !== 'string' || typeof f.base64 !== 'string') {
            return jsonResponse({ error: 'each file needs { name, base64 }' }, 400);
        }
    }

    try {
        const creds = await loadCredentials();
        const accessToken = await getAccessToken(creds);
        const root = creds.rootPath || '/EC4 COMEC - 3. SHIPPED WITH BL';
        const folderPath = `${root.replace(/\/+$/, '')}/${folderName}`;

        await ensureFolder(accessToken, folderPath);

        const uploaded: Array<{ name: string; path: string }> = [];
        for (const f of files) {
            const safeName = sanitizeSegment(f.name) || 'file';
            const bytes = decodeBase64(f.base64);
            const path = `${folderPath}/${safeName}`;
            const finalPath = await uploadFile(accessToken, path, bytes);
            uploaded.push({ name: safeName, path: finalPath });
        }

        return jsonResponse({
            ok: true,
            folderPath,
            uploaded,
            user: auth.user.email ?? auth.user.id,
        });
    } catch (err: any) {
        console.error('dropbox-upload error:', err);
        return jsonResponse({ error: err?.message ?? 'Internal error' }, 500);
    }
});
