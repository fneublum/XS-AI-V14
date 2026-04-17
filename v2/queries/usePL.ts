// Phase 3B — Profit & Loss summary.
//
// Derived from existing tables:
//   revenue = sum(invoices.totalAmount)
//   cogs    = sum(invoices_suppliers.totalAmount)
//   freight = sum(freight_quotes.rate) where status = 'ACCEPTED' (best effort)
//   margin  = revenue - cogs - freight
//
// Phase 3C will add a proper ledger + period filters. This is the
// stepping-stone: see your top-line vs spend in one view.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface PLSummary {
  revenue: number;
  cogs: number;
  freight: number;
  grossMargin: number;
  grossMarginPct: number | null;
  invoiceCount: number;
  supplierInvoiceCount: number;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function usePL() {
  const { currentCompanyId } = useCompany();

  return useSupabaseQuery<PLSummary>(
    ['pl', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      const invQ = scopeByCompany(
        supabase.from('invoices').select('totalAmount'),
        currentCompanyId,
      );
      const supInvQ = scopeByCompany(
        supabase.from('invoices_suppliers').select('totalAmount'),
        currentCompanyId,
      );
      const freightQ = scopeByCompany(
        supabase.from('freight_quotes').select('rate, status'),
        currentCompanyId,
      );

      const [inv, supInv, freight] = await Promise.all([invQ, supInvQ, freightQ]);

      const sum = (rows: Array<{ totalAmount: number | string | null }> | null) =>
        (rows ?? []).reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const sumRates = (rows: Array<{ rate: number | string | null; status: string | null }> | null) =>
        (rows ?? [])
          .filter(r => (r.status ?? '').toUpperCase().includes('ACCEPT'))
          .reduce((s, r) => s + (Number(r.rate) || 0), 0);

      const revenue = sum(inv.data as Array<{ totalAmount: number | string | null }> | null);
      const cogs = sum(supInv.data as Array<{ totalAmount: number | string | null }> | null);
      const freightSpent = sumRates(freight.data as Array<{ rate: number | string | null; status: string | null }> | null);
      const grossMargin = revenue - cogs - freightSpent;

      return {
        revenue,
        cogs,
        freight: freightSpent,
        grossMargin,
        grossMarginPct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
        invoiceCount: (inv.data ?? []).length,
        supplierInvoiceCount: (supInv.data ?? []).length,
      };
    },
  );
}
