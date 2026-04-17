// Phase 3B — Purchase orders list.
//
// Schema comes from services/schema.ts:606. The real table uses `id` as
// the PO number, and `supplierName` / `orderDate` (not vendor/date).

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface PurchaseOrder {
  id: string;
  supplierName: string;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  totalAmount: number;
  currency: string;
}

interface RawRow {
  id: string;
  supplierName: string | null;
  status: string | null;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  totalAmount: number | null;
  currency: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function usePurchaseOrders(search?: string) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search?.trim() ?? '';

  return useSupabaseQuery<PurchaseOrder[]>(
    ['purchaseOrders', currentCompanyId, normalizedSearch],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('purchase_orders')
          .select('id, supplierName, status, orderDate, expectedDeliveryDate, paymentTerms, totalAmount, currency')
          .order('orderDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );

      if (normalizedSearch) {
        q = q.or(
          `id.ilike.*${normalizedSearch}*,supplierName.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawRow[] | null) ?? []).map(r => ({
        id: r.id,
        supplierName: r.supplierName ?? '—',
        status: r.status ?? 'PENDING',
        orderDate: r.orderDate ?? '',
        expectedDeliveryDate: r.expectedDeliveryDate,
        paymentTerms: r.paymentTerms,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
      }));
    },
  );
}
