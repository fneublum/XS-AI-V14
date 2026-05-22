// Banks belong to a company. The `banks` table uses snake_case columns
// and lets Postgres auto-generate `id` (uuid) and `created_at` — so the
// generic useEntityInsert/Update helpers don't fit and we drive the
// mutations directly here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export interface Bank {
  id: string;
  company_id: string;
  code: string | null;
  name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  swift_code: string | null;
  wire: string | null;
  routing: string | null;
  account_number: string | null;
}

export type BankInput = Omit<Bank, 'id'> & { id?: string };

export function useCompanyBanks(companyId: string | null) {
  return useQuery<Bank[]>({
    enabled: !!companyId,
    queryKey: ['banks', 'byCompany', companyId],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('banks')
        .select('*')
        .eq('company_id', companyId!)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as Bank[] | null) ?? [];
    },
  });
}

export function useInsertBank() {
  const qc = useQueryClient();
  return useMutation<Bank, Error, BankInput>({
    mutationFn: async (row) => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('banks').insert(row).select().single();
      if (error) throw new Error(error.message);
      return data as Bank;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['banks'] }); },
  });
}

export function useUpdateBank() {
  const qc = useQueryClient();
  return useMutation<Bank, Error, { id: string } & Partial<Bank>>({
    mutationFn: async ({ id, ...patch }) => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('banks').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data as Bank;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['banks'] }); },
  });
}

export function useDeleteBank() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('banks').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['banks'] }); },
  });
}
