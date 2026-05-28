#!/usr/bin/env node
// Backfill auth.users from the custom users table.
//
// Phase A of the Supabase Auth migration (see App.tsx, services/edgeAuth.ts,
// pages/Login.tsx). The custom users table stores plaintext passwords and
// the app currently does a plaintext compare in Login.tsx; the cutover
// moves auth into supabase.auth.signInWithPassword so sessions persist
// to localStorage and survive the lazy-chunk-retry page reload.
//
// PREREQUISITE: run scripts/migration-add-users-auth-id.sql once (adds the
// users.auth_id UUID column). The application's users.id holds non-UUID
// strings (U_ADMIN, USR1767552065337, etc.) and Supabase auth.users.id is
// strictly UUID, so we can't reuse the id. Instead we let Supabase
// generate a UUID for each auth identity and write it back to users.auth_id.
//
// What this script does:
//   1. Reads every row from public.users.
//   2. For each row WITHOUT auth_id set:
//        a. Calls supabase.auth.admin.createUser(email, password, ...) with
//           NO explicit id (Supabase generates a UUID server-side).
//        b. UPDATE users SET auth_id = newAuthUser.id WHERE id = users.id.
//   3. Idempotent: rows where auth_id is already set are skipped on every
//      subsequent run. Safe to re-run after partial failures.
//   4. Prints a per-row report and a summary at the end.
//
// Synthetic emails: users in this app only have a `username`, not always
// a real email. Supabase Auth requires email (or phone), so we map
// `<username>` → `<lowercased-username>@xs-internal.local` consistently
// in both this script and Login.tsx. The synthetic domain is
// non-routable on purpose — these accounts cannot receive password-reset
// emails. Admins reset via the auth-provision-user Edge Function (Phase
// B) or directly in the Supabase dashboard.
//
// USAGE (env via .env.local OR shell):
//   DRY_RUN=1 node scripts/backfill-supabase-auth.mjs   # plan only
//   node scripts/backfill-supabase-auth.mjs              # apply
//
// SAFETY:
//   - Service role key. Never commit. Never paste into a chat. Either
//     drop it in .env.local (gitignored) or set in a fresh shell.
//   - Run against staging first if you have one. Cross-check the summary.
//   - Re-running is safe (idempotent via auth_id check). Partial-failure
//     recovery: just re-run.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Tiny .env loader — Vite's convention is .env.local for project secrets
// that shouldn't be committed. We check that first, then .env, then
// finally fall back to whatever's already in process.env. This means you
// can either set the vars in your shell OR drop them in a .env.local at
// the project root and just run `node scripts/backfill-supabase-auth.mjs`.
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
            // Strip surrounding single or double quotes.
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            // Don't overwrite anything explicitly set in the shell.
            if (process.env[key] === undefined) process.env[key] = value;
        }
        console.log(`[backfill] loaded env from ${filename}`);
    }
}
loadDotEnv();

// Accept VITE_SUPABASE_URL as a fallback so we can reuse the project's
// existing .env.local (which already has VITE_SUPABASE_URL set for the
// client bundle). The service role key never gets a VITE_ prefix —
// that would leak it into the browser bundle — so it must be set
// explicitly as SUPABASE_SERVICE_ROLE_KEY.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNTHETIC_EMAIL_DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || 'xs-internal.local';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.');
    console.error('       (The service role key is in Supabase dashboard → Settings → API.)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function syntheticEmail(username) {
    return `${String(username).trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

async function main() {
    console.log(`[backfill] target: ${SUPABASE_URL}`);
    console.log(`[backfill] synthetic email domain: @${SYNTHETIC_EMAIL_DOMAIN}`);
    console.log(`[backfill] dry run: ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
    console.log('');

    const { data: users, error } = await supabase
        .from('users')
        .select('id, username, email, password, role, auth_id')
        .order('username', { ascending: true });

    if (error) {
        // Surface the migration prerequisite clearly — the most likely
        // error here is "column users.auth_id does not exist".
        console.error('[backfill] failed to read users table:', error.message);
        if (String(error.message).toLowerCase().includes('auth_id')) {
            console.error('');
            console.error('Did you run scripts/migration-add-users-auth-id.sql first?');
            console.error('(Supabase Studio → SQL Editor → paste + run that file.)');
        }
        process.exit(1);
    }

    if (!users || users.length === 0) {
        console.error('[backfill] users table is empty — nothing to do.');
        process.exit(0);
    }

    console.log(`[backfill] found ${users.length} users to process`);
    console.log('');

    let linked = 0;        // newly created + linked auth identity
    let alreadyLinked = 0; // skipped because auth_id was already populated
    let skipped = 0;       // skipped due to bad row data
    let failed = 0;
    const failures = [];

    for (const u of users) {
        const tag = `${u.username} (${u.id})`;

        if (!u.id || !u.username || !u.password) {
            console.log(`  SKIP  ${tag} — missing id/username/password`);
            skipped++;
            continue;
        }

        if (u.auth_id) {
            console.log(`  SKIP  ${tag} — already linked to auth_id ${u.auth_id.slice(0, 8)}…`);
            alreadyLinked++;
            continue;
        }

        const email = syntheticEmail(u.username);

        if (DRY_RUN) {
            console.log(`  PLAN  ${tag} → ${email}`);
            linked++;
            continue;
        }

        // Step 1: create the Supabase auth identity. We let Supabase
        // assign the UUID — see header comment for why we can't reuse
        // users.id.
        const { data: authResult, error: createErr } = await supabase.auth.admin.createUser({
            email,
            password: u.password,
            email_confirm: true,
            user_metadata: {
                username: u.username,
                app_user_id: u.id,  // back-pointer for diagnostics
                source: 'backfill-supabase-auth.mjs',
            },
            app_metadata: {
                provider: 'xs-users',
                role: u.role ?? 'user',
            },
        });

        if (createErr || !authResult?.user) {
            const msg = createErr?.message ?? 'createUser returned no user';
            console.log(`  FAIL  ${tag} — ${msg}`);
            failed++;
            failures.push({ id: u.id, username: u.username, error: msg });
            continue;
        }

        const newAuthId = authResult.user.id;

        // Step 2: write the new auth_id back to users so subsequent runs
        // are idempotent and Login.tsx can resolve session → user row.
        const { error: linkErr } = await supabase
            .from('users')
            .update({ auth_id: newAuthId })
            .eq('id', u.id);

        if (linkErr) {
            // Orphan situation: auth user exists but users row not
            // updated. The next run will fail with "email already
            // registered". Surface clearly so it can be fixed manually
            // (either delete the auth user from the dashboard, or
            // UPDATE users SET auth_id = '<uuid>' by hand).
            console.log(`  FAIL  ${tag} — auth user created but UPDATE users failed: ${linkErr.message}`);
            console.log(`        Orphan auth.users id: ${newAuthId}`);
            failed++;
            failures.push({
                id: u.id, username: u.username,
                error: `link failed (orphan ${newAuthId}): ${linkErr.message}`,
            });
            continue;
        }

        console.log(`  OK    ${tag} → ${email}  [auth_id ${newAuthId.slice(0, 8)}…]`);
        linked++;
    }

    console.log('');
    console.log('────────────────────────────');
    console.log(`  linked:         ${linked}${DRY_RUN ? ' (planned)' : ''}`);
    console.log(`  already linked: ${alreadyLinked}`);
    console.log(`  skipped:        ${skipped}`);
    console.log(`  failed:         ${failed}`);
    console.log('────────────────────────────');

    if (failures.length > 0) {
        console.log('');
        console.log('Failures:');
        for (const f of failures) console.log(`  - ${f.username} (${f.id}): ${f.error}`);
        process.exit(2);
    }

    if (DRY_RUN) {
        console.log('');
        console.log('Dry run complete. Re-run without DRY_RUN=1 to apply.');
    }
}

main().catch(err => {
    console.error('[backfill] unhandled error:', err);
    process.exit(1);
});
