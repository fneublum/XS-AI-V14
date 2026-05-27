// Per-company INV-#### sequence generator.
//
// Each company maintains its own invoice number sequence. The earlier
// implementation scanned the entire `invoices` table without a company
// filter, so when GENRYO created its first invoice the generator
// returned EC4's next number (INV-3406 instead of INV-0001). Always
// pass the resolved companyId — the helper falls back to the legacy
// cross-company scan only when companyId is null/'ALL', which is the
// system-admin / data-import path.
//
// Format: 4-digit zero-padded suffix (INV-0001). Companies whose
// sequence already exceeds 9999 just keep growing (INV-10000+) — no
// hard cap.

import { getSupabaseClient } from '../../services/supabase';

export async function generateNextInvoiceNumber(companyId: string | null): Promise<string> {
  try {
    let q = getSupabaseClient()
      .from('invoices')
      .select('invoiceNumber, invoiceDate, createdAt, companyId')
      .order('invoiceDate', { ascending: false, nullsFirst: false })
      .order('createdAt',   { ascending: false, nullsFirst: false })
      .limit(200);
    if (companyId && companyId !== 'ALL') {
      q = q.eq('companyId', companyId);
    }
    const { data } = await q;
    const rows = (data as Array<{ invoiceNumber: string | null }> | null) ?? [];
    // Pick the highest INV-#### in the bucket, not just the most recent
    // row — protects against out-of-order edits where the latest by
    // date isn't the latest by number.
    let maxN = 0;
    for (const r of rows) {
      const m = (r.invoiceNumber ?? '').match(/^INV-(\d{1,6})$/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (n > maxN) maxN = n;
    }
    const next = maxN + 1;
    return `INV-${String(next).padStart(4, '0')}`;
  } catch {
    return 'INV-0001';
  }
}
