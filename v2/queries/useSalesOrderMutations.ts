// Phase 3B — Sales order mutations.
//
// Only the minimal subset of fields the Drawer editor exposes. Phase 3C
// will add full items[] editing + commission splits; this pilot proves
// the mutation + cache-invalidation path.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import { SalesOrder } from './useSalesOrders';

export interface SalesOrderPatch {
  id: string;
  status?: string;
  paymentTerms?: string | null;
  incoterm?: string | null;
  deliveryDate?: string | null;
}

export function useUpdateSalesOrder() {
  const qc = useQueryClient();

  return useMutation<SalesOrder, Error, SalesOrderPatch>({
    mutationFn: async (patch) => {
      const supabase = getSupabaseClient();
      const { id, ...rest } = patch;
      const { data, error } = await supabase
        .from('sales_orders')
        .update(rest)
        .eq('id', id)
        .select('id, orderNumber, customerName, status, totalAmount, currency, orderDate, createdAt, paymentTerms, incoterm, deliveryDate')
        .single();
      if (error) throw new Error(error.message);

      return {
        id: data.id,
        orderNumber: data.orderNumber ?? data.id,
        customerName: data.customerName ?? '—',
        status: data.status ?? 'PENDING',
        totalAmount: Number(data.totalAmount) || 0,
        currency: data.currency ?? 'USD',
        orderDate: data.orderDate ?? '',
        createdAt: data.createdAt ?? '',
        paymentTerms: data.paymentTerms,
        incoterm: data.incoterm,
        deliveryDate: data.deliveryDate,
      };
    },
    onSuccess: () => {
      // Invalidate every sales-order list + dashboard stats so the UI
      // reflects the change without requiring a manual refresh.
      void qc.invalidateQueries({ queryKey: ['salesOrders'] });
      void qc.invalidateQueries({ queryKey: ['recentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });
}
