// Probe what's reachable about auth config via service role / SQL.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(projectRoot, '.env.local'), 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];

const url = get('VITE_SUPABASE_URL');
const key = get('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key, { auth: { persistSession: false } });

// 1. Try to query auth.config (if it exists and is readable).
console.log('\nProbing auth.config via PostgREST...');
const { data: cfg, error: cfgErr } = await sb.from('config').select('*').limit(5);
console.log('  result:', cfgErr ? `ERR: ${cfgErr.message}` : JSON.stringify(cfg));

// 2. Try schema=auth.
console.log('\nProbing schema=auth via PostgREST headers...');
const sbAuth = createClient(url, key, {
    db: { schema: 'auth' },
    auth: { persistSession: false },
});
const { data: cfg2, error: cfg2Err } = await sbAuth.from('config').select('*').limit(5);
console.log('  result:', cfg2Err ? `ERR: ${cfg2Err.message}` : JSON.stringify(cfg2));

// 3. Use GoTrue admin endpoints directly. The /admin/users endpoint
//    works with service-role; the /admin/settings endpoint may also work.
const gotrueResp = await fetch(`${url}/auth/v1/admin/settings`, {
    headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
    },
});
console.log('\nGoTrue /admin/settings:', gotrueResp.status, gotrueResp.statusText);
if (gotrueResp.ok) {
    const text = await gotrueResp.text();
    console.log('  body (first 600 chars):', text.slice(0, 600));
}
