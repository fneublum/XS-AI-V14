#!/usr/bin/env node
// Bulk resync — runs the resync-user-password logic against every user
// in one node process, so we don't spawn 20+ subprocesses. Idempotent:
// users whose auth password is already in sync get a no-op (Supabase
// accepts the same password without error).
//
// USAGE: node scripts/resync-all-passwords.mjs

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

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const { data: users, error } = await sb
    .from('users')
    .select('id, username, password, auth_id')
    .order('username');

if (error) { console.error('users lookup failed:', error.message); process.exit(1); }

console.log(`\nBulk auth-password resync (${users.length} users)\n` + '─'.repeat(60));

let synced = 0, skipped = 0, failed = 0;
const failures = [];

for (const u of users) {
    const tag = `${u.username} (${u.id})`;
    if (!u.auth_id) {
        console.log(`  SKIP  ${tag} — no auth_id (re-run backfill?)`);
        skipped++;
        continue;
    }
    if (!u.password) {
        console.log(`  SKIP  ${tag} — empty users.password`);
        skipped++;
        continue;
    }
    const { error: updErr } = await sb.auth.admin.updateUserById(u.auth_id, {
        password: u.password,
    });
    if (updErr) {
        console.log(`  FAIL  ${tag} — ${updErr.message}`);
        failed++;
        failures.push({ username: u.username, error: updErr.message });
        continue;
    }
    console.log(`  OK    ${tag}`);
    synced++;
}

console.log('');
console.log('────────────────────────────');
console.log(`  synced:  ${synced}`);
console.log(`  skipped: ${skipped}`);
console.log(`  failed:  ${failed}`);
console.log('────────────────────────────');
if (failures.length) {
    console.log('');
    for (const f of failures) console.log(`  - ${f.username}: ${f.error}`);
    process.exit(2);
}
