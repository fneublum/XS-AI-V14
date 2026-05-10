// Freight-quote id generator.
//
// Format: `FQ-NNNN` — a 4-digit zero-padded sequential number that
// increments from the highest existing freight_quotes.id matching this
// pattern. Legacy random-base36 ids (e.g. `FQ-mohjoa50-XYZ`) are
// scanned for trailing digits when present, so a switchover doesn't
// collide with the past.
//
// Example: last FQ is "FQ-0042" → next is "FQ-0043".

import { getSupabaseClient } from '../../services/supabase';

const STARTING_SEQ = 0; // first generated number is 1 → "FQ-0001" if no prior FQs

/** Pull the trailing numeric portion out of an id. NaN when absent. */
function extractSeq(id: string | null | undefined): number {
  if (!id) return NaN;
  const m = String(id).match(/(\d+)\s*$/);
  if (!m) return NaN;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Return the next sequential number across freight_quotes ids. */
export async function nextFQNumberSequence(): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('freight_quotes')
    .select('id')
    .ilike('id', 'FQ-%')
    .limit(5000);
  if (error) return STARTING_SEQ + 1;
  let max = STARTING_SEQ;
  for (const row of (data ?? []) as Array<{ id?: string }>) {
    const n = extractSeq(row.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Format the next sequence as `FQ-NNNN` (4-digit padding). */
export async function nextFQNumber(): Promise<string> {
  const seq = await nextFQNumberSequence();
  return `FQ-${String(seq).padStart(4, '0')}`;
}
