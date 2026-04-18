// Phase 3B — Sales order mutations (legacy shim).
//
// The v2 drawer now uses `useEntityUpdate` directly with the full
// SalesOrder schema. This helper stays around for a narrow patch path
// (status / terms / incoterm / deliveryDate) and is called from quick
// actions outside the drawer.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export interface SalesOrderPatch {
  id: string;
  status?: string;
  paymentTerms?: string | null;
  incoterm?: string | null;
  deliveryDate?: string | null;
}

export function useUpdateSalesOrder() {
  const qc = useQueryClient();

  return useMutation<void, Error, SalesOrderPatch>({
    mutationFn: async (patch) => {
      const supabase = getSupabaseClient();
      const { id, ...rest } = patch;
      const { error } = await supabase
        .from('sales_orders')
        .update(rest)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['salesOrders'] });
      void qc.invalidateQueries({ queryKey: ['recentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });
}
