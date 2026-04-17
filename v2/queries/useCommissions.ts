// Phase 3B — Commissions list query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface CommissionRow {
  id: string;
  orderNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  sellerName: string | null;
  orderTotal: number;
  commissionRate: number | null;
  commissionAmount: number;
  commissionType: string | null;
  paymentStatus: string;
  commissionPaymentStatus: string;
  createdAt: string;
}

interface Raw {
  id: string;
  orderNumber: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  sellerName: string | null;
  orderTotal: number | string | null;
  commissionRate: number | string | null;
  commissionAmount: number | string | null;
  commissionType: string | null;
  paymentStatus: string | null;
  commissionPaymentStatus: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useCommissions(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<CommissionRow[]>(
    ['commissions', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('commission_sales_orders')
          .select('id, orderNumber, invoiceNumber, customerName, sellerName, orderTotal, commissionRate, commissionAmount, commissionType, paymentStatus, commissionPaymentStatus, createdAt')
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`orderNumber.ilike.*${needle}*,customerName.ilike.*${needle}*,sellerName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        orderNumber: r.orderNumber ?? r.id,
        invoiceNumber: r.invoiceNumber,
        customerName: r.customerName ?? '—',
        sellerName: r.sellerName,
        orderTotal: Number(r.orderTotal) || 0,
        commissionRate: r.commissionRate === null || r.commissionRate === undefined ? null : Number(r.commissionRate),
        commissionAmount: Number(r.commissionAmount) || 0,
        commissionType: r.commissionType,
        paymentStatus: r.paymentStatus ?? 'PENDING',
        commissionPaymentStatus: r.commissionPaymentStatus ?? 'UNPAID',
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
