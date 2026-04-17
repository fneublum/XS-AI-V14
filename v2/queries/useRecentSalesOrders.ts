// Phase 3B — Recent sales orders feed.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface SalesOrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  totalAmount: number;
  orderDate: string;
}

interface RawRow {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string | null;
  totalAmount: number | null;
  orderDate: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useRecentSalesOrders(limit = 8) {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<SalesOrderListItem[]>(
    ['recentSalesOrders', currentCompanyId, limit],
    async () => {
      const supabase = getSupabaseClient();
      const q = scopeByCompany(
        supabase
          .from('sales_orders')
          .select('id, orderNumber, customerName, status, totalAmount, orderDate, createdAt')
          .order('createdAt', { ascending: false })
          .limit(limit),
        currentCompanyId,
      );

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawRow[] | null) ?? []).map(r => ({
        id: r.id,
        orderNumber: r.orderNumber ?? r.id,
        customerName: r.customerName ?? '—',
        status: r.status ?? 'PENDING',
        totalAmount: Number(r.totalAmount) || 0,
        orderDate: r.orderDate ?? r.createdAt ?? '',
      }));
    },
  );
}
