// Phase 3B — Commission mutations.
//
// The commission_sales_orders table holds the SO → PI → CI commission
// workflow state machine. v1's SOPICIComissions module has ~40 fields
// of editor logic; iteration one exposes the state transitions most
// users actually flip day-to-day.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export interface CommissionPatch {
  id: string;
  paymentStatus?: string;
  invoiceStatus?: string | null;
  commissionPaymentStatus?: string;
  commissionRate?: number | null;
  commissionAmount?: number;
  sellerName?: string | null;
  invoiceNumber?: string | null;
  approvedBy?: string | null;
}

export function useUpdateCommission() {
  const qc = useQueryClient();
  return useMutation<void, Error, CommissionPatch>({
    mutationFn: async (patch) => {
      const { id, ...rest } = patch;
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .update(rest)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commissions'] });
      void qc.invalidateQueries({ queryKey: ['receivables'] });
    },
  });
}

export function useDeleteCommission() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commissions'] });
      void qc.invalidateQueries({ queryKey: ['receivables'] });
    },
  });
}
