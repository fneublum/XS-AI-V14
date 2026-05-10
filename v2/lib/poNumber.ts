// Purchase-order number generator.
//
// Format: `PO-NNNNNXX`
//   NNNNN — 5-digit zero-padded sequential number, starts at 00792 the
//           first time a formatted PO is created. Subsequent calls
//           increment from the highest existing PO whose id matches
//           this exact pattern. Legacy random-id POs are ignored.
//   XX    — first two letters of the supplier name, uppercased, with
//           non-alpha characters stripped. Padded with 'X' if the
//           supplier has fewer than two letters (or is empty).
//
// Example: KLYTO PLASTICS → "PO-00792KL"

import { getSupabaseClient } from '../../services/supabase';

const STARTING_SEQ = 791; // so the FIRST generated number is 792.
const SEQ_PATTERN  = /^PO-(\d{5})[A-Z]{2}$/;

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

/** End-to-end: read max sequence + format with supplier prefix. */
export async function nextPONumber(supplierName: string | null | undefined): Promise<string> {
  const seq = await nextPONumberSequence();
  const padded = String(seq).padStart(5, '0');
  return `PO-${padded}${supplierPrefix(supplierName)}`;
}
