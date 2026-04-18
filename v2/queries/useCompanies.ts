// Phase 3B — Companies the current user can access.
//
// Reads every company row (Phase 1d will narrow via RLS). Filters down
// to the set the user is explicitly allowed to see, falling back to
// everything when `allowedCompanies` is empty/unset (matches v1
// behavior where ALL is the initial scope). Columns include the full
// address set because PDF generators read it off the Company row.

import { useAuth } from '../providers/AuthProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Company {
  id: string;
  name: string;
  nickname: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  ein: string | null;
}

interface RawCompany {
  id: string;
  name: string | null;
  nickname: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  ein: string | null;
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
        .select('*')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);

      const rows = ((data as RawCompany[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? r.id,
        nickname: r.nickname,
        address: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
        country: r.country,
        phone: r.phone,
        ein: r.ein,
      }));
      if (!allowed || allowed.length === 0) return rows;
      const allowSet = new Set(allowed);
      return rows.filter(r => allowSet.has(r.id));
    },
  );
}
