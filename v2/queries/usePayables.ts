// Phase 3B — Payables query (supplier invoices we owe).
//
// Supplier name is carried in `shipperName` on invoices_suppliers —
// `supplier` appears in services/schema.ts but the live column doesn't
// exist. Prefer shipperName with a soldTo fallback.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Payable {
  id: string;
  invoiceNumber: string;
  supplier: string | null;
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
  shipperName: string | null;
  soldTo: string | null;
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

export function usePayables(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Payable[]>(
    ['payables', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('invoices_suppliers')
          .select('id, invoiceNumber, shipperName, soldTo, invoiceDate, paymentTerms, totalAmount, currency, qb_status, createdAt')
          .order('invoiceDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`invoiceNumber.ilike.*${needle}*,shipperName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber ?? r.id,
        supplier: r.shipperName ?? r.soldTo,
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
