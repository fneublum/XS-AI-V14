// Set a user's password in BOTH places — users.password (legacy column
// the admin UI still reads) AND auth.users via admin API (the source of
// truth post-Phase-A). Atomic-ish: if either write fails we report
// loudly so the caller can fix the drift.
//
// USAGE: node scripts/set-user-password.mjs <username> <new-password>

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(projectRoot, '.env.local'), 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];

const username = process.argv[2];
const newPwd   = process.argv[3];
if (!username || !newPwd) {
    console.error('usage: node scripts/set-user-password.mjs <username> <new-password>');
    process.exit(1);
}

const sb = createClient(
    get('VITE_SUPABASE_URL'),
    get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
);

console.log(`\nSet password: '${username}' → "${newPwd}" (len ${newPwd.length})\n` + '─'.repeat(60));

// 1. Look up users row.
const { data: row, error } = await sb
    .from('users')
    .select('id, username, auth_id')
    .ilike('username', username)
    .maybeSingle();
if (error) { console.error('users lookup:', error.message); process.exit(1); }
if (!row)  { console.error('No users row.');               process.exit(2); }
if (!row.auth_id) { console.error('users.auth_id is NULL — run backfill first.'); process.exit(3); }

console.log(`  users.id:      ${row.id}`);
console.log(`  users.auth_id: ${row.auth_id}`);

// 2. UPDATE users.password.
const { error: updErr1 } = await sb.from('users').update({ password: newPwd }).eq('id', row.id);
if (updErr1) { console.error('  ✗ users.password update failed:', updErr1.message); process.exit(4); }
console.log('  ✓ users.password updated');

// 3. UPDATE auth.users password via admin API.
const { error: updErr2 } = await sb.auth.admin.updateUserById(row.auth_id, { password: newPwd });
if (updErr2) {
    console.error('  ✗ auth.users password update failed:', updErr2.message);
    console.error('    WARNING: users.password and auth.users are now out of sync.');
    process.exit(5);
}
console.log('  ✓ auth.users password updated');

// 4. Verify with anon sign-in.
const anon = createClient(
    get('VITE_SUPABASE_URL'),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q',
    { auth: { persistSession: false } },
);
const synthetic = `${row.username.trim().toLowerCase()}@xs-internal.local`;
const { data: vdata, error: vErr } = await anon.auth.signInWithPassword({ email: synthetic, password: newPwd });
if (vErr) { console.error('  ✗ sign-in verification failed:', vErr.message); process.exit(6); }
await anon.auth.signOut().catch(() => {});
console.log(`  ✓ verified: signInWithPassword('${synthetic}', '${newPwd}') works`);
console.log('');
