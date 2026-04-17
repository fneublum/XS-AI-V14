// Phase 3B — Shared entity PATCH mutation helper.
//
// Each drawer (Customer, Supplier, Invoice, PO) used its own tiny
// mutation hook — they all do the same thing: UPDATE on a table,
// invalidate a list query, surface errors. This helper unifies them.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

interface EntityMutationConfig<Patch extends { id: string }> {
  table: string;
  listQueryKeys: string[];   // queryKey[0] values to invalidate on success
}

export function useEntityMutation<Patch extends { id: string }>({
  table, listQueryKeys,
}: EntityMutationConfig<Patch>) {
  const qc = useQueryClient();

  return useMutation<void, Error, Patch>({
    mutationFn: async (patch) => {
      const { id, ...rest } = patch;
      const supabase = getSupabaseClient();
      const { error } = await supabase.from(table).update(rest).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      for (const key of listQueryKeys) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
