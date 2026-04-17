// Phase 3B — Invoices query (customer-facing / AR).

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  soldTo: string | null;
  billToName: string | null;
  invoiceDate: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  totalAmount: number;
  currency: string;
  soNumber: string | null;
  plNumber: string | null;
  bookingNumber: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  invoiceNumber: string | null;
  soldTo: string | null;
  billToName: string | null;
  invoiceDate: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  totalAmount: number | string | null;
  currency: string | null;
  soNumber: string | null;
  plNumber: string | null;
  bookingNumber: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useInvoices(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Invoice[]>(
    ['invoices', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('invoices')
          .select('id, invoiceNumber, soldTo, billToName, invoiceDate, paymentTerms, incoterm, totalAmount, currency, soNumber, plNumber, bookingNumber, createdAt')
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
        soldTo: r.soldTo,
        billToName: r.billToName,
        invoiceDate: r.invoiceDate,
        paymentTerms: r.paymentTerms,
        incoterm: r.incoterm,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        soNumber: r.soNumber,
        plNumber: r.plNumber,
        bookingNumber: r.bookingNumber,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
