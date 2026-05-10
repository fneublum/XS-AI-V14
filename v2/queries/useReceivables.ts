// Phase 3B — Receivables query.
//
// Reads the `invoices` table (same source as v1 FinanceReceivables).
// Receivables = customer invoices owed to us; the commission pipeline
// previously wired here was the wrong source.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Receivable {
  id: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string | null;
  paymentTerms: string | null;
  totalAmount: number;
  currency: string;
  qbStatus: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  invoiceNumber: string | null;
  soldTo: string | null;
  billToName: string | null;
  invoiceDate: string | null;
  paymentTerms: string | null;
  totalAmount: number | string | null;
  currency: string | null;
  qb_status: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useReceivables(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Receivable[]>(
    ['receivables', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('invoices')
          .select('id, invoiceNumber, soldTo, billToName, invoiceDate, paymentTerms, totalAmount, currency, qb_status, createdAt')
          .order('invoiceDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`invoiceNumber.ilike.*${needle}*,soldTo.ilike.*${needle}*,billToName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber ?? r.id,
        customerName: r.soldTo ?? r.billToName ?? '—',
        invoiceDate: r.invoiceDate,
        paymentTerms: r.paymentTerms,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        qbStatus: r.qb_status ?? null,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
