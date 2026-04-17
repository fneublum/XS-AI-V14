// Phase 3B — Shared entity UPDATE + INSERT helpers.
//
// Each drawer uses `useEntityUpdate` for edit mode and `useEntityInsert`
// for create mode. Both invalidate the list query keys passed in so the
// UI reflects the change without manual refetch.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

interface MutationConfig {
  table: string;
  listQueryKeys: string[];
}

export function useEntityUpdate<Patch extends { id: string }>({
  table, listQueryKeys,
}: MutationConfig) {
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

interface InsertConfig extends MutationConfig {
  /** Prefix for generated primary keys (e.g. 'CUST' → 'CUST-{ts}-{rand}') */
  idPrefix: string;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function useEntityInsert<Fields extends Record<string, unknown>>({
  table, listQueryKeys, idPrefix,
}: InsertConfig) {
  const qc = useQueryClient();
  return useMutation<string, Error, Fields>({
    mutationFn: async (fields) => {
      const supabase = getSupabaseClient();
      const id = newId(idPrefix);
      const { error } = await supabase.from(table).insert({
        id,
        createdAt: new Date().toISOString(),
        ...fields,
      });
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: () => {
      for (const key of listQueryKeys) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useEntityDelete({
  table, listQueryKeys,
}: MutationConfig) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      for (const key of listQueryKeys) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

// Legacy alias — some older code imported useEntityMutation for UPDATE.
export const useEntityMutation = useEntityUpdate;
