// Phase 3B — Sales orders list (full, not just recent).
//
// Supports server-side status filter + client-side search. The v1 app
// ships rich per-row items; the list view only needs the header fields
// so we project down for a light payload.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  totalAmount: number;
  currency: string;
  orderDate: string;
  createdAt: string;
  paymentTerms: string | null;
  incoterm: string | null;
  deliveryDate: string | null;
}

interface RawRow {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string | null;
  totalAmount: number | null;
  currency: string | null;
  orderDate: string | null;
  createdAt: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  deliveryDate: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export interface UseSalesOrdersOptions {
  statusFilter?: string;  // 'ALL' or specific status
  search?: string;
  limit?: number;
}

export function useSalesOrders({
  statusFilter = 'ALL',
  search = '',
  limit = 200,
}: UseSalesOrdersOptions = {}) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search.trim();

  return useSupabaseQuery<SalesOrder[]>(
    ['salesOrders', currentCompanyId, statusFilter, normalizedSearch, limit],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('sales_orders')
          .select('id, orderNumber, customerName, status, totalAmount, currency, orderDate, createdAt, paymentTerms, incoterm, deliveryDate')
          .order('createdAt', { ascending: false })
          .limit(limit),
        currentCompanyId,
      );

      if (statusFilter && statusFilter !== 'ALL') {
        q = q.eq('status', statusFilter) as typeof q;
      }

      if (normalizedSearch) {
        q = q.or(
          `orderNumber.ilike.*${normalizedSearch}*,customerName.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawRow[] | null) ?? []).map(r => ({
        id: r.id,
        orderNumber: r.orderNumber ?? r.id,
        customerName: r.customerName ?? '—',
        status: r.status ?? 'PENDING',
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        orderDate: r.orderDate ?? '',
        createdAt: r.createdAt ?? '',
        paymentTerms: r.paymentTerms,
        incoterm: r.incoterm,
        deliveryDate: r.deliveryDate,
      }));
    },
  );
}
