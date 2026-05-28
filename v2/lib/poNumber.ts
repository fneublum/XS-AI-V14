// Purchase-order number generator.
//
// Two formats, selected by the owning company:
//
//   GENRYO  → `PO-GEN-NNNN`
//             NNNN — 4-digit zero-padded sequential number; floor 0148
//             so the first generated PO is `PO-GEN-0148`. Subsequent
//             calls increment by 1 from the highest existing matching id.
//
//   default → `PO-NNNNNXX`
//             NNNNN — 5-digit zero-padded sequential, starts at 00792.
//             XX    — first two letters of the supplier name (uppercased,
//                     non-alpha stripped, padded with 'X'). Legacy random-id
//                     POs are ignored when computing the next sequence.
//
// Example (default): KLYTO PLASTICS → "PO-00792KL"
// Example (GENRYO):  any supplier  → "PO-GEN-0148"

import { getSupabaseClient } from '../../services/supabase';

const STARTING_SEQ = 791; // so the FIRST generated default number is 792.
const SEQ_PATTERN  = /^PO-(\d{5})[A-Z]{2}$/;

// GENRYO-specific tuning. Kept as constants so a future migration to
// settings table is a single-symbol change.
const GENRYO_FLOOR    = 147; // first generated GENRYO PO is 148.
const GENRYO_PAD      = 4;   // 4-digit zero-pad → 0148, 0149, …, 9999.
const GENRYO_PATTERN  = /^PO-GEN-(\d+)$/;

/** Strip non-letters, take the first two characters, uppercase, pad
 *  with 'X' if needed. */
export function supplierPrefix(supplierName: string | null | undefined): string {
  const letters = String(supplierName ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 2) || 'XX').padEnd(2, 'X');
}

/** Find the highest sequence number across existing PO ids matching
 *  the formatted pattern, then return `seq + 1`. Returns STARTING_SEQ + 1
 *  (i.e. 792) when no formatted PO exists yet. */
export async function nextPONumberSequence(): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id')
    .ilike('id', 'PO-%')
    .limit(5000);
  if (error) {
    // Fall back to the starting sequence — better to issue PO-00792XX
    // than to block PO creation when the lookup fails.
    return STARTING_SEQ + 1;
  }
  let max = STARTING_SEQ;
  for (const row of (data ?? []) as Array<{ id?: string }>) {
    const m = String(row.id ?? '').match(SEQ_PATTERN);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

/** Probe the companies table to see whether the owning company is
 *  GENRYO. Returns false on any error (network, RLS, missing row) so a
 *  flaky lookup degrades gracefully to the default PO format rather
 *  than blocking creation. */
async function isGenryoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  if (error || !data) return false;
  // Use startsWith, not strict equality — the real company row is named
  // "GENRYO INTERNATIONAL" (verified against the companies table on
  // 2026-05-28), and future legal-entity rename variants like
  // "GENRYO LLC" should keep working too.
  return String((data as { name?: string }).name ?? '').trim().toUpperCase().startsWith('GENRYO');
}

/** Find the highest GENRYO PO sequence used so far. Same shape as
 *  nextPONumberSequence but matches `PO-GEN-NNNN` instead of
 *  `PO-NNNNNXX`. Floors at GENRYO_FLOOR so the first generated number
 *  is GENRYO_FLOOR + 1 (i.e., 148) regardless of historical state. */
export async function nextGenryoPOSequence(): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id')
    .ilike('id', 'PO-GEN-%')
    .limit(5000);
  if (error) return GENRYO_FLOOR + 1;
  let max = GENRYO_FLOOR;
  for (const row of (data ?? []) as Array<{ id?: string }>) {
    const m = String(row.id ?? '').match(GENRYO_PATTERN);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

/** End-to-end: pick the right format based on the owning company, then
 *  return the next PO id.
 *
 *  - `supplierName` is only used for the default supplier-prefix format.
 *  - `companyId` is optional; if omitted, GENRYO detection is skipped
 *    and the default format is used (preserves the original 1-arg
 *    callers' behaviour). Pass it when the call site knows the company. */
export async function nextPONumber(
  supplierName: string | null | undefined,
  companyId?: string | null,
): Promise<string> {
  if (await isGenryoCompany(companyId)) {
    const seq = await nextGenryoPOSequence();
    return `PO-GEN-${String(seq).padStart(GENRYO_PAD, '0')}`;
  }
  const seq = await nextPONumberSequence();
  const padded = String(seq).padStart(5, '0');
  return `PO-${padded}${supplierPrefix(supplierName)}`;
}
