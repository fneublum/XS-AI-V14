#!/usr/bin/env node
// Verification harness for the GENRYO PO numbering logic.
//
// Runs the SAME logic that v2/lib/poNumber.ts uses (inlined here so it
// can run as a plain node script without TypeScript), against the real
// companies and purchase_orders tables. Confirms that for every company
// whose name starts with GENRYO, the next PO id comes out as
// PO-GEN-NNNN — and that for non-GENRYO companies it's still the legacy
// PO-NNNNNXX format.
//
// Read-only. Anon key. Safe to re-run.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://qfskvevighylzzmyiwre.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// --- Inline copies of the poNumber.ts logic (kept in sync manually). ---
const STARTING_SEQ   = 791;
const SEQ_PATTERN    = /^PO-(\d{5})[A-Z]{2}$/;
const GENRYO_FLOOR   = 147;
const GENRYO_PAD     = 4;
const GENRYO_PATTERN = /^PO-GEN-(\d+)$/;

function supplierPrefix(supplierName) {
    const letters = String(supplierName ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
    return (letters.slice(0, 2) || 'XX').padEnd(2, 'X');
}

async function isGenryoCompany(companyId) {
    if (!companyId) return false;
    const { data, error } = await supabase
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .maybeSingle();
    if (error || !data) return false;
    return String(data.name ?? '').trim().toUpperCase().startsWith('GENRYO');
}

async function nextPONumberSequence() {
    const { data, error } = await supabase
        .from('purchase_orders')
        .select('id')
        .ilike('id', 'PO-%')
        .limit(5000);
    if (error) return STARTING_SEQ + 1;
    let max = STARTING_SEQ;
    for (const row of data ?? []) {
        const m = String(row.id ?? '').match(SEQ_PATTERN);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return max + 1;
}

async function nextGenryoPOSequence() {
    const { data, error } = await supabase
        .from('purchase_orders')
        .select('id')
        .ilike('id', 'PO-GEN-%')
        .limit(5000);
    if (error) return GENRYO_FLOOR + 1;
    let max = GENRYO_FLOOR;
    for (const row of data ?? []) {
        const m = String(row.id ?? '').match(GENRYO_PATTERN);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return max + 1;
}

async function nextPONumber(supplierName, companyId) {
    if (await isGenryoCompany(companyId)) {
        const seq = await nextGenryoPOSequence();
        return `PO-GEN-${String(seq).padStart(GENRYO_PAD, '0')}`;
    }
    const seq = await nextPONumberSequence();
    const padded = String(seq).padStart(5, '0');
    return `PO-${padded}${supplierPrefix(supplierName)}`;
}

// --- Harness ---

const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name')
    .order('name');

if (error) { console.error('FAIL:', error.message); process.exit(1); }

console.log('\nGENRYO PO numbering — verification\n' + '─'.repeat(60));

let failures = 0;
let genryoChecked = 0;
let nonGenryoChecked = 0;

for (const c of companies ?? []) {
    const id = c.id;
    const name = c.name ?? '';
    const isGenryo = name.trim().toUpperCase().startsWith('GENRYO');
    const next = await nextPONumber('KLYTO PLASTICS', id);
    const looksGenryo = /^PO-GEN-\d{4}$/.test(next);
    const looksDefault = /^PO-\d{5}[A-Z]{2}$/.test(next);
    const expectedShape = isGenryo ? looksGenryo : looksDefault;

    if (isGenryo) genryoChecked++; else nonGenryoChecked++;
    if (!expectedShape) failures++;

    console.log(
        `${expectedShape ? '✓' : '✗'} ${name.padEnd(28)}  next → ${next}` +
        (isGenryo ? '   (expect PO-GEN-NNNN)' : '   (expect PO-NNNNNXX)')
    );
}

console.log('─'.repeat(60));
console.log(`GENRYO companies checked:     ${genryoChecked}`);
console.log(`non-GENRYO companies checked: ${nonGenryoChecked}`);
console.log(`failures:                     ${failures}`);

// Also report what GENRYO POs are already in the DB and what the next
// number is going to be — the user asked for PO-GEN-0148, but the
// screenshot showed a PO-GEN-0145 already exists. So next should be 0146
// based on observed max OR 0148 based on floor, whichever is larger.
const { data: existingGenryo } = await supabase
    .from('purchase_orders')
    .select('id')
    .ilike('id', 'PO-GEN-%')
    .order('id');
const ns = (existingGenryo ?? []).map(r => {
    const m = String(r.id).match(GENRYO_PATTERN);
    return m ? parseInt(m[1], 10) : null;
}).filter(n => n !== null);

console.log('');
console.log('Existing PO-GEN-NNNN rows in DB:');
for (const r of existingGenryo ?? []) console.log(`  ${r.id}`);
console.log(`max observed: ${ns.length ? Math.max(...ns) : '(none)'}`);
console.log(`floor:        ${GENRYO_FLOOR + 1}`);
console.log(`→ next: ${`PO-GEN-${String(Math.max(GENRYO_FLOOR, ns.length ? Math.max(...ns) : 0) + 1).padStart(GENRYO_PAD, '0')}`}`);

process.exit(failures === 0 ? 0 : 2);
