// Tests for the 6 high-severity bug fixes applied on 2026-05-10.
// Each test isolates the pure logic of one fix and exercises both the
// "should block" and "should allow" branches. Runs under Node 18+ (uses
// the global Web Crypto API and fetch primitives).

import { strict as assert } from 'node:assert';

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            pass++;
            console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
            fail++;
            failures.push({ name, err });
            console.log(`  ✗ ${name}`);
            console.log(`    ${err.message}`);
        });
}

// ─── #5 PurchaseOrders XSS — escapeHtml ────────────────────────────────

const escapeHtml = (v) => {
    const s = v == null ? '' : String(v);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

console.log('\n#5 PurchaseOrders XSS — escapeHtml');
await test('neutralizes <img onerror>', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const out = escapeHtml(evil);
    // No raw '<' means the browser cannot parse a tag — the onerror= text
    // that remains is inert character data, not an attribute.
    assert.ok(!out.includes('<'), 'raw < leaked, parser will see a tag');
    assert.equal(out, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
await test('neutralizes <script>', () => {
    const out = escapeHtml('<script>fetch("/steal")</script>');
    assert.ok(!out.includes('<script'));
    assert.ok(!out.includes('</script'));
});
await test('escapes embedded quotes and ampersand', () => {
    assert.equal(escapeHtml(`a&b"c'd`), `a&amp;b&quot;c&#39;d`);
});
await test('passes through safe text unchanged structurally', () => {
    assert.equal(escapeHtml('Cotton 100% (premium)'), 'Cotton 100% (premium)');
});
await test('handles null/undefined safely', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

// ─── #4 WhatsApp signature verification ────────────────────────────────
//
// Port of verifySignature from supabase/functions/whatsapp-webhook/index.ts.
// Crucially: missing header OR missing secret must now return false (was true).

async function verifySignature(payloadText, signatureHeader, secret) {
    if (!signatureHeader || !secret) {
        return false; // post-fix behavior
    }
    try {
        const parts = signatureHeader.split('sha256=');
        if (parts.length !== 2) return false;
        const hex = parts[1];
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify', 'sign'],
        );
        return await crypto.subtle.verify(
            'HMAC',
            key,
            bytes,
            new TextEncoder().encode(payloadText),
        );
    } catch {
        return false;
    }
}

async function makeSignature(payload, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256=${hex}`;
}

console.log('\n#4 WhatsApp signature verification');
await test('returns false when header missing (was: true — fail-open)', async () => {
    const ok = await verifySignature('{"any":"payload"}', null, 'real-secret');
    assert.equal(ok, false);
});
await test('returns false when secret unset (was: true — fail-open)', async () => {
    const ok = await verifySignature('{"any":"payload"}', 'sha256=abc', undefined);
    assert.equal(ok, false);
});
await test('returns false on wrong signature', async () => {
    const ok = await verifySignature('{"x":1}', 'sha256=' + '00'.repeat(32), 'real-secret');
    assert.equal(ok, false);
});
await test('returns true on correct signature', async () => {
    const payload = '{"object":"whatsapp_business_account","entry":[]}';
    const sig = await makeSignature(payload, 'real-secret');
    const ok = await verifySignature(payload, sig, 'real-secret');
    assert.equal(ok, true);
});
await test('returns false on malformed header', async () => {
    const ok = await verifySignature('{"x":1}', 'not-a-sig', 'real-secret');
    assert.equal(ok, false);
});

// ─── #6 Anthropic-proxy size cap ───────────────────────────────────────
//
// Port of the cap logic: read raw body, cap on its actual length, not on
// the client-controlled Content-Length header. Build a Request whose
// Content-Length says 0 but whose body is 3MB — the new code must reject.

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function applyCap(req) {
    // Mirrors the post-fix flow in anthropic-proxy/index.ts.
    let raw;
    try {
        raw = await req.text();
    } catch {
        return { status: 400, body: { error: 'Failed to read request body' } };
    }
    if (raw.length > MAX_BODY_BYTES) {
        return {
            status: 413,
            body: { error: `Request too large (${raw.length} > ${MAX_BODY_BYTES} bytes)` },
        };
    }
    try {
        JSON.parse(raw);
    } catch {
        return { status: 400, body: { error: 'Invalid JSON' } };
    }
    return { status: 200, body: { ok: true, bytes: raw.length } };
}

console.log('\n#6 Anthropic-proxy size cap');
await test('rejects 3MB body even when Content-Length lies (says 0)', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const req = new Request('http://test/', {
        method: 'POST',
        body: JSON.stringify({ model: 'a', messages: [{ role: 'user', content: big }] }),
        headers: { 'Content-Length': '0' }, // intentionally lying
    });
    const res = await applyCap(req);
    assert.equal(res.status, 413, `expected 413, got ${res.status}`);
});
await test('accepts small body', async () => {
    const req = new Request('http://test/', {
        method: 'POST',
        body: JSON.stringify({ model: 'a', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await applyCap(req);
    assert.equal(res.status, 200);
});
await test('rejects malformed JSON with 400', async () => {
    const req = new Request('http://test/', { method: 'POST', body: 'not-json{' });
    const res = await applyCap(req);
    assert.equal(res.status, 400);
});

// ─── #2 qb-sync tenant access ──────────────────────────────────────────
//
// Port of assertTenantAccess from supabase/functions/qb-sync/index.ts.
// Caller is allowed iff (a) authenticated, (b) companyId is specific
// (not "ALL"/empty), (c) user.allowedCompanyIds includes it.

function assertTenantAccess(user, companyId) {
    if (!user) return { status: 401, error: 'Unauthenticated' };
    if (!companyId || companyId === 'ALL') {
        return { status: 400, error: 'companyId is required' };
    }
    if (!user.allowedCompanyIds.includes(companyId)) {
        return { status: 403, error: 'Forbidden: caller is not a member of this company' };
    }
    return null;
}

console.log('\n#2 qb-sync tenant access');
await test('blocks unauthenticated caller', () => {
    const r = assertTenantAccess(null, 'CompanyA');
    assert.equal(r.status, 401);
});
await test('blocks missing companyId', () => {
    const r = assertTenantAccess({ id: 'u1', allowedCompanyIds: ['CompanyA'] }, '');
    assert.equal(r.status, 400);
});
await test('blocks legacy "ALL" sentinel (was: hit any-token fallback)', () => {
    const r = assertTenantAccess({ id: 'u1', allowedCompanyIds: ['CompanyA'] }, 'ALL');
    assert.equal(r.status, 400);
});
await test('blocks user not a member of requested company (the real attack)', () => {
    const user = { id: 'attacker', allowedCompanyIds: ['CompanyA'] };
    const r = assertTenantAccess(user, 'VictimCo');
    assert.equal(r.status, 403);
});
await test('blocks user with no allowed companies', () => {
    const user = { id: 'u1', allowedCompanyIds: [] };
    const r = assertTenantAccess(user, 'CompanyA');
    assert.equal(r.status, 403);
});
await test('allows legitimate caller for their own company', () => {
    const user = { id: 'u1', allowedCompanyIds: ['CompanyA', 'CompanyB'] };
    assert.equal(assertTenantAccess(user, 'CompanyA'), null);
    assert.equal(assertTenantAccess(user, 'CompanyB'), null);
});

// ─── #3 system_settings RLS regex ─────────────────────────────────────
//
// The PostgreSQL `!~*` (case-insensitive negated regex match) maps to a
// JS regex with the `i` flag and negated boolean. Validate that the
// pattern denies real secret keys and admits real config keys.

const SECRET_PATTERN = /(credential|secret|token|api[_-]?key|password|client[_-]?secret|private[_-]?key)/i;
const denies = (key) => SECRET_PATTERN.test(key);

console.log('\n#3 system_settings RLS regex');
await test('denies twilio_credentials', () => assert.equal(denies('twilio_credentials'), true));
await test('denies meta_app_secret', () => assert.equal(denies('meta_app_secret'), true));
await test('denies gemini_api_key', () => assert.equal(denies('gemini_api_key'), true));
await test('denies gemini-api-key (hyphenated)', () => assert.equal(denies('gemini-api-key'), true));
await test('denies ANTHROPIC_BEARER_TOKEN (uppercase)', () => assert.equal(denies('ANTHROPIC_BEARER_TOKEN'), true));
await test('denies qb_refresh_token', () => assert.equal(denies('qb_refresh_token'), true));
await test('denies admin_password', () => assert.equal(denies('admin_password'), true));
await test('denies signing_private_key', () => assert.equal(denies('signing_private_key'), true));
await test('allows ai_personas (non-secret config)', () => assert.equal(denies('ai_personas'), false));
await test('allows workflow_state (non-secret config)', () => assert.equal(denies('workflow_state'), false));
await test('allows ui_preferences', () => assert.equal(denies('ui_preferences'), false));
await test('allows company_branding', () => assert.equal(denies('company_branding'), false));

// ─── #1 useSupabase options ───────────────────────────────────────────
//
// Hook needs React; can't unit-test in isolation. Validate the shape of
// the change instead: the type now accepts the options, the runtime
// honors `enabled === false` by early-returning, and `pageSize` is
// aliased to `limit` when `limit` isn't set.

import { readFile } from 'node:fs/promises';
const useSupabaseSrc = await readFile(
    new URL('../hooks/useSupabase.ts', import.meta.url),
    'utf8',
);

console.log('\n#1 useSupabase options (source-level checks)');
await test('UseSupabaseOptions now declares pageSize', () => {
    assert.ok(/pageSize\?:\s*number/.test(useSupabaseSrc), 'pageSize field missing');
});
await test('UseSupabaseOptions now declares enabled', () => {
    assert.ok(/enabled\?:\s*boolean/.test(useSupabaseSrc), 'enabled field missing');
});
await test('fetchData early-returns when enabled === false', () => {
    assert.ok(
        /options\?\.enabled\s*===\s*false[\s\S]{0,200}return/.test(useSupabaseSrc),
        'no early return for disabled',
    );
});
await test('limit-or-pageSize cap applied to query', () => {
    assert.ok(
        /options\?\.limit\s*\?\?\s*options\?\.pageSize/.test(useSupabaseSrc),
        'pageSize not aliased to limit',
    );
});
await test('initial loading reflects enabled (not always true)', () => {
    assert.ok(
        /useState\(enabled\)/.test(useSupabaseSrc),
        'loading state still hard-coded to true',
    );
});

// ─── Summary ───────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
        console.log(`  ✗ ${f.name}`);
        console.log(`    ${f.err.stack || f.err.message}`);
    }
    process.exit(1);
}
