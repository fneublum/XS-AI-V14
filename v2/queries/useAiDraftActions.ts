// Approve / Reject an AI-draft row.
//
// Used on packing_lists and invoices rows where `ai_status='ai_draft'`.
// Approve flips ai_status → 'approved'; Reject → 'rejected' (kept for
// audit but greyed out / hidden from default views).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export type AiDraftTable = 'packing_lists' | 'invoices';

interface DecideArgs {
  table: AiDraftTable;
  rowId: string;
  decision: 'approve' | 'reject';
}

export function useAiDraftAction(opts?: { onSuccess?: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ table, rowId, decision }: DecideArgs) => {
      const supabase = getSupabaseClient();
      const ai_status = decision === 'approve' ? 'approved' : 'rejected';
      const { error } = await supabase
        .from(table)
        .update({ ai_status })
        .eq('id', rowId);
      if (error) throw new Error(error.message);
      return { table, rowId, ai_status };
    },
    onSuccess: (_data, vars) => {
      // Invalidate the relevant list query
      if (vars.table === 'packing_lists') {
        qc.invalidateQueries({ queryKey: ['packingLists'] });
        qc.invalidateQueries({ queryKey: ['logisticsDocs'] });
      } else {
        qc.invalidateQueries({ queryKey: ['invoices'] });
      }
      opts?.onSuccess?.();
    },
  });
}
