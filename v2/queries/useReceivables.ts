// Phase 3B — Receivables query.
//
// Reads commission_sales_orders where paymentStatus is not 'PAID' — the
// commission pipeline is where the invoice/payment lifecycle lives in
// this schema (the plain `invoices` table has no paymentStatus column).

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Receivable {
  id: string;
  orderNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  orderTotal: number;
  paymentStatus: string;
  invoiceStatus: string | null;
  deliveryDate: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  orderNumber: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  orderTotal: number | string | null;
  paymentStatus: string | null;
  invoiceStatus: string | null;
  deliveryDate: string | null;
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
        supabase.from('commission_sales_orders')
          .select('id, orderNumber, invoiceNumber, customerName, orderTotal, paymentStatus, invoiceStatus, deliveryDate, createdAt')
          .neq('paymentStatus', 'PAID')
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`orderNumber.ilike.*${needle}*,invoiceNumber.ilike.*${needle}*,customerName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        orderNumber: r.orderNumber ?? r.id,
        invoiceNumber: r.invoiceNumber,
        customerName: r.customerName ?? '—',
        orderTotal: Number(r.orderTotal) || 0,
        paymentStatus: r.paymentStatus ?? 'PENDING',
        invoiceStatus: r.invoiceStatus,
        deliveryDate: r.deliveryDate,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
