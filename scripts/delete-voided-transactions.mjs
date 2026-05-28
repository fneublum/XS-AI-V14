#!/usr/bin/env node
// One-shot cleanup: permanently remove transactions whose status is
// VOIDED. They represent reversed payments that the application code
// (Cash Flow, balances views, etc.) was double-counting. With them
// gone the views simplify — no need to keep .neq('status','VOIDED')
// filters everywhere.
//
// Behaviour:
//   1. Lists every VOIDED row that will be deleted (audit before).
//   2. Probes the allocations table for any rows pointing at those
//      voided transactions and deletes them first (FK safety).
//   3. Deletes the VOIDED rows from public.transactions.
//   4. Re-queries to confirm zero remain.
//
// Run with DRY_RUN=1 to see what would happen without writing.
//
// USAGE:
//   DRY_RUN=1 node scripts/delete-voided-transactions.mjs   # plan only
//   node scripts/delete-voided-transactions.mjs              # apply
//
// SAFETY:
//   - Service role key required (gets it from .env.local).
//   - DESTRUCTIVE: voided rows are removed irrecoverably. The
//     application has been treating them as deleted anyway (filter at
//     v2/queries/useCashFlow.ts), so this is just removing the dead
//     weight. Re-runs are a no-op once the table is clean.

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
            const [, key, val] = m;
            if (process.env[key] === undefined) process.env[key] = val;
        }
    }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN      = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. via .env.local).');
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\nDelete-voided-transactions${DRY_RUN ? ' [DRY RUN]' : ''}\n` + '─'.repeat(60));

// 1. List voided rows.
const v = await sb.from('transactions')
    .select('id, txnDate, amount, kind, counterpartyName, currency, status, qbId')
    .eq('status', 'VOIDED')
    .order('txnDate', { ascending: false });
if (v.error) { console.error('list failed:', v.error.message); process.exit(1); }
const rows = v.data ?? [];
console.log(`Found ${rows.length} VOIDED transactions:`);
for (const t of rows) {
    console.log(
        ' ',
        t.id.slice(0, 16).padEnd(18),
        (t.txnDate ?? '').padEnd(12),
        String(t.kind ?? '').padEnd(13),
        String(t.amount ?? '').padStart(10),
        (t.currency ?? 'USD').padEnd(5),
        '|',
        (t.counterpartyName ?? '').slice(0, 30),
    );
}
if (rows.length === 0) {
    console.log('\nNothing to delete. Exiting cleanly.');
    process.exit(0);
}

if (DRY_RUN) {
    console.log('\nDRY RUN — no writes performed. Re-run without DRY_RUN=1 to apply.');
    process.exit(0);
}

const voidedIds = rows.map(r => r.id);

// 2. Clean up any allocation rows that reference these transactions.
// We probe with a count-only query first; if zero, we skip the delete.
// The allocations table name varies by deployment (transaction_allocations
// vs transactions_allocations), so probe both gently.
for (const tbl of ['transaction_allocations', 'transactions_allocations']) {
    const probe = await sb.from(tbl).select('*', { count: 'exact', head: true }).in('transactionId', voidedIds);
    if (probe.error) {
        // Table doesn't exist — move on.
        continue;
    }
    if ((probe.count ?? 0) > 0) {
        const del = await sb.from(tbl).delete().in('transactionId', voidedIds);
        if (del.error) {
            console.error(`\nFailed to delete allocations from ${tbl}:`, del.error.message);
            process.exit(2);
        }
        console.log(`  ✓ deleted ${probe.count} allocation rows from ${tbl}`);
    } else {
        console.log(`  ✓ no allocations to clean in ${tbl}`);
    }
}

// 3. Delete the voided transactions.
const del = await sb.from('transactions').delete().eq('status', 'VOIDED');
if (del.error) {
    console.error('\nDelete failed:', del.error.message);
    process.exit(3);
}
console.log(`\n  ✓ deleted ${rows.length} VOIDED transaction rows`);

// 4. Re-query to confirm.
const after = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'VOIDED');
console.log(`  ✓ VOIDED transactions remaining: ${after.count ?? 0}`);
console.log('');
