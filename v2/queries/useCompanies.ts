// Phase 3B — Companies the current user can access.
//
// Reads every company row (Phase 1d will narrow via RLS). Filters down
// to the set the user is explicitly allowed to see, falling back to
// everything when `allowedCompanies` is empty/unset (matches v1
// behavior where ALL is the initial scope).

import { useAuth } from '../providers/AuthProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Company {
  id: string;
  name: string;
}

interface RawCompany {
  id: string;
  name: string | null;
}

export function useCompanies() {
  const { user } = useAuth();
  const allowed = user?.allowedCompanies;

  return useSupabaseQuery<Company[]>(
    ['companies', allowed?.join(',') ?? 'all'],
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);

      const rows = ((data as RawCompany[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? r.id,
      }));
      if (!allowed || allowed.length === 0) return rows;
      const allowSet = new Set(allowed);
      return rows.filter(r => allowSet.has(r.id));
    },
  );
}
