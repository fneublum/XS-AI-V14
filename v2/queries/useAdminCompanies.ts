// Phase 3B — Admin Companies full query.
//
// Distinct from v2/queries/useCompanies.ts (which narrows to the user's
// allowed_company_ids for the sidebar switcher). This surfaces every
// company the caller can see + all metadata for the admin table.

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface CompanyAdminRow {
  id: string;
  name: string;
  nickname: string | null;
  city: string | null;
  country: string | null;
  ein: string | null;
  phone: string | null;
}

interface Raw {
  id: string;
  name: string | null;
  nickname: string | null;
  city: string | null;
  country: string | null;
  ein: string | null;
  phone: string | null;
}

export function useAdminCompanies(search?: string) {
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<CompanyAdminRow[]>(
    ['adminCompanies', needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('companies')
        .select('id, name, nickname, city, country, ein, phone')
        .order('name', { ascending: true })
        .limit(200);

      if (needle) {
        q = q.or(`name.ilike.*${needle}*,nickname.ilike.*${needle}*,country.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? r.id,
        nickname: r.nickname,
        city: r.city,
        country: r.country,
        ein: r.ein,
        phone: r.phone,
      }));
    },
  );
}
