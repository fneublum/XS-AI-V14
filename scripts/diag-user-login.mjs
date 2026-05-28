#!/usr/bin/env node
// Diagnose a single user's login state. Checks:
//   1. Does the users row exist? What's the stored (plaintext) password?
//   2. Is users.auth_id populated?
//   3. Try supabase.auth.signInWithPassword with the synthetic email and
//      the stored password — does it succeed?
// Read-only; uses anon key only.
//
// USAGE: node scripts/diag-user-login.mjs <username> [<password-to-test>]
//   If <password-to-test> is omitted, uses the stored users.password value.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://qfskvevighylzzmyiwre.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q';

const username = process.argv[2];
const passwordOverride = process.argv[3];
if (!username) {
    console.error('usage: node scripts/diag-user-login.mjs <username> [<password>]');
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\nDiagnose: username='${username}'\n` + '─'.repeat(60));

// 1. Look up the users row (case-insensitive).
const { data: row, error } = await sb
    .from('users')
    .select('id, username, email, password, role, auth_id')
    .ilike('username', username)
    .maybeSingle();

if (error) { console.error('users lookup failed:', error.message); process.exit(1); }
if (!row) { console.error('No users row matches that username (case-insensitive ilike).'); process.exit(2); }

console.log('users row found:');
console.log(`  id:           ${row.id}`);
console.log(`  username:     "${row.username}"`);
console.log(`  email:        ${row.email ?? '(null)'}`);
console.log(`  role:         ${row.role ?? '(null)'}`);
console.log(`  stored pwd:   "${row.password}"  (length ${(row.password ?? '').length})`);
console.log(`  auth_id:      ${row.auth_id ?? '(NULL — not backfilled!)'}`);

// 2. Try Supabase Auth sign-in with the synthetic email.
const synthetic = `${row.username.trim().toLowerCase()}@xs-internal.local`;
const tryPasswords = passwordOverride
    ? [{ label: `override "${passwordOverride}"`, pwd: passwordOverride }]
    : [{ label: 'stored password', pwd: row.password }];

console.log('');
console.log(`Synthetic email: ${synthetic}`);
console.log('');
for (const { label, pwd } of tryPasswords) {
    const { data, error: authErr } = await sb.auth.signInWithPassword({
        email: synthetic,
        password: pwd ?? '',
    });
    if (authErr) {
        console.log(`  ✗ ${label} → ${authErr.message}`);
    } else {
        console.log(`  ✓ ${label} → signed in. session user.id = ${data.user?.id}`);
        // Sign back out so we don't leave state behind.
        await sb.auth.signOut().catch(() => {});
    }
}

console.log('');
