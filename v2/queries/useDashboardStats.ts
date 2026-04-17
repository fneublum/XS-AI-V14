// Phase 3B — Dashboard stat aggregates.
//
// Computes:
//   - revenue       sum(items.total) across sales_orders in range
//   - orderCount    count(sales_orders in range)
//   - customerCount count(customers visible to the user)
//   - pending       sum(totalAmount) of invoices with status != 'PAID'
//
// Company scoping: when `companyId === 'ALL'`, reads every row the anon
// policy permits; otherwise filters by the camelCase `"companyId"`
// column that v1 uses.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type DashboardRange = '7d' | '30d' | '90d';

export interface DashboardStats {
  revenue: number;
  orderCount: number;
  customerCount: number;
  pending: number;
  revenueDeltaPct: number | null;
  orderDelta: number | null;
}

const rangeToDays: Record<DashboardRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

function since(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

interface SalesOrderRow {
  totalAmount: number | null;
  createdAt: string | null;
}

interface InvoiceRow {
  totalAmount: number | null;
  invoiceStatus: string | null;
}

export function useDashboardStats(range: DashboardRange = '30d') {
  const { currentCompanyId } = useCompany();
  const days = rangeToDays[range];

  return useSupabaseQuery<DashboardStats>(
    ['dashboardStats', currentCompanyId, range],
    async () => {
      const supabase = getSupabaseClient();
      const windowStart = since(days);
      const prevStart = since(days * 2);

      const ordersCurrentQ = scopeByCompany(
        supabase.from('sales_orders')
          .select('totalAmount, createdAt')
          .gte('createdAt', windowStart),
        currentCompanyId,
      );
      const ordersPrevQ = scopeByCompany(
        supabase.from('sales_orders')
          .select('totalAmount, createdAt')
          .gte('createdAt', prevStart)
          .lt('createdAt', windowStart),
        currentCompanyId,
      );
      const customersQ = scopeByCompany(
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        currentCompanyId,
      );
      const invoicesQ = scopeByCompany(
        supabase.from('invoices').select('totalAmount, invoiceStatus'),
        currentCompanyId,
      );

      const [ordersCur, ordersPrev, customers, invoices] = await Promise.all([
        ordersCurrentQ, ordersPrevQ, customersQ, invoicesQ,
      ]);

      const sumTotals = (rows: SalesOrderRow[] | null) =>
        (rows ?? []).reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);

      const revenue = sumTotals(ordersCur.data as SalesOrderRow[] | null);
      const revenuePrev = sumTotals(ordersPrev.data as SalesOrderRow[] | null);
      const orderCount = (ordersCur.data as SalesOrderRow[] | null)?.length ?? 0;
      const orderCountPrev = (ordersPrev.data as SalesOrderRow[] | null)?.length ?? 0;

      const pending = ((invoices.data as InvoiceRow[] | null) ?? [])
        .filter(r => (r.invoiceStatus ?? '').toUpperCase() !== 'PAID')
        .reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);

      return {
        revenue,
        orderCount,
        customerCount: customers.count ?? 0,
        pending,
        revenueDeltaPct: revenuePrev > 0
          ? ((revenue - revenuePrev) / revenuePrev) * 100
          : null,
        orderDelta: orderCount - orderCountPrev,
      };
    },
  );
}
