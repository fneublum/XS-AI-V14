#!/usr/bin/env node
// Resync a user's Supabase Auth password to match their stored
// users.password value.
//
// Why this exists: scripts/backfill-supabase-auth.mjs ran once and
// seeded auth.users with whatever password was in users.password at
// that moment. If an admin updates users.password later (or if a row's
// password was different at backfill time vs. now), the user can't
// sign in until the auth-side password is refreshed too.
//
// This script is the targeted "make these two values match again" fix.
// Idempotent: a re-run with no change is a no-op (Supabase accepts the
// same password). Read-only against users; write against auth.users
// via the admin API.
//
// USAGE:
//   node scripts/resync-user-password.mjs <username>
//
// SAFETY:
//   - Requires SUPABASE_SERVICE_ROLE_KEY in .env.local or env.
//   - Single-user. To resync everyone, loop in shell:
//       for u in lucas leonardo nelson; do node scripts/resync-user-password.mjs $u; done

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

function loadDotEnv() {
    const here = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(here, '..');
    for (const filename of ['.env.local', '.env']) {
        const path = join(projectRoot, filename);
        if (!existsSync(path)) continue;
        const text = readFileSync(path, 'utf8');
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
            if (!m) continue;
            const key = m[1];
            let value = m[2];
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            if (process.env[key] === undefined) process.env[key] = value;
        }
    }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (via .env.local or shell).');
    process.exit(1);
}

const username = process.argv[2];
if (!username) {
    console.error('usage: node scripts/resync-user-password.mjs <username>');
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\nResync auth password for: '${username}'\n` + '─'.repeat(60));

// 1. Read users row.
const { data: row, error } = await sb
    .from('users')
    .select('id, username, password, auth_id')
    .ilike('username', username)
    .maybeSingle();

if (error) { console.error('users lookup failed:', error.message); process.exit(1); }
if (!row) { console.error('No users row found.'); process.exit(2); }
if (!row.auth_id) {
    console.error('users.auth_id is NULL — run backfill-supabase-auth.mjs first.');
    process.exit(3);
}
if (!row.password) {
    console.error('users.password is empty — nothing to sync.');
    process.exit(4);
}

console.log(`  users.id:       ${row.id}`);
console.log(`  users.username: ${row.username}`);
console.log(`  users.auth_id:  ${row.auth_id}`);
console.log(`  stored pwd len: ${row.password.length}`);

// 2. Update auth.users password via admin API.
const { error: updErr } = await sb.auth.admin.updateUserById(row.auth_id, {
    password: row.password,
});

if (updErr) {
    console.error('\nUpdate failed:', updErr.message);
    process.exit(5);
}

console.log('');
console.log('  ✓ auth password resynced.');

// 3. Verify by signing in.
const synthetic = `${row.username.trim().toLowerCase()}@xs-internal.local`;
const anon = createClient(
    SUPABASE_URL,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q',
    { auth: { persistSession: false } },
);
const { data: verify, error: verifyErr } = await anon.auth.signInWithPassword({
    email: synthetic,
    password: row.password,
});
if (verifyErr) {
    console.error('  ✗ verification sign-in still fails:', verifyErr.message);
    process.exit(6);
}
await anon.auth.signOut().catch(() => {});
console.log(`  ✓ verified: signInWithPassword works for ${synthetic}`);
console.log('');
