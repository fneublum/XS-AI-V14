// Sales-order number generator.
//
// Format: `SO-NNNNN` — a 5-digit zero-padded sequential number that
// increments from the highest existing SO whose `orderNumber` matches
// this exact pattern. Legacy random-id orderNumbers (e.g.
// `SO-A3F9KZ`, `SO-001234`) and other variants are scanned for the
// numeric tail and considered when computing the next sequence, so a
// switchover doesn't collide with the past.
//
// Example: last SO is "SO-00792" → next is "SO-00793".

import { getSupabaseClient } from '../../services/supabase';

// Floor for the sequence — the first generated number is `STARTING_SEQ + 1`.
// Setting this to 5082 means the first auto-generated SO is "SO-05083"
// (the user-requested starting point). When existing SOs already
// exceed this floor, the higher value wins so we never go backwards.
const STARTING_SEQ = 5082;

/** Pull the trailing numeric portion out of any SO orderNumber.
 *  Returns NaN when the value doesn't end in digits. */
function extractSeq(orderNumber: string | null | undefined): number {
  if (!orderNumber) return NaN;
  const m = String(orderNumber).match(/(\d+)\s*$/);
  if (!m) return NaN;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Find the highest sequence number across existing sales-order
 *  `orderNumber` values, then return `seq + 1`. */
export async function nextSONumberSequence(): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('sales_orders')
    .select('orderNumber')
    .ilike('orderNumber', 'SO-%')
    .limit(5000);
  if (error) return STARTING_SEQ + 1;
  let max = STARTING_SEQ;
  for (const row of (data ?? []) as Array<{ orderNumber?: string }>) {
    const n = extractSeq(row.orderNumber);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Format the next sequence as `SO-NNNNN` (5-digit padding). */
export async function nextSONumber(): Promise<string> {
  const seq = await nextSONumberSequence();
  return `SO-${String(seq).padStart(5, '0')}`;
}
