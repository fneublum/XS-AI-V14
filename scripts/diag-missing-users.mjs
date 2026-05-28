import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(projectRoot, '.env.local'), 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];

const sb = createClient(
    get('VITE_SUPABASE_URL'),
    get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
);

const { count } = await sb.from('users').select('*', { count: 'exact', head: true });
console.log('total count from server:', count);

const { data } = await sb.from('users').select('id, username, password, auth_id').order('username');
console.log('returned rows:', data?.length);
console.log('usernames:', data?.map(u => u.username).join(' | '));

for (const m of ['doris', 'ivan', 'Jamil', 'shannon', 'teresa', 'xs']) {
    const { data: r } = await sb.from('users')
        .select('id, username, password, auth_id, role')
        .ilike('username', m)
        .maybeSingle();
    console.log(`  ${m}:`, r
        ? `id=${r.id} role=${r.role} pwdLen=${(r.password ?? '').length} auth_id=${r.auth_id ? r.auth_id.slice(0, 8) : 'NULL'}`
        : 'NOT FOUND'
    );
}
