// Ports reference — `ports` table with `{ id, code, name, country,
// companyId }`. Used by PDF generators to look up the country for a
// port-of-acquisition / -destination code ("USCHS" → "USA").
//
// Scoped to the current company + 'ALL' so a tenant's custom ports
// and the shared global list both surface.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Port {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
  country: string | null;
}

export function usePorts() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<Port[]>(
    ['ports', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('ports')
        .select('id, companyId, code, name, country')
        .order('code')
        .limit(2000);
      if (currentCompanyId && currentCompanyId !== 'ALL') {
        q = q.or(`"companyId".eq.${currentCompanyId},"companyId".eq.ALL`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as Array<Partial<Port>> | null) ?? []).map(r => ({
        id: String(r.id ?? ''),
        companyId: r.companyId ?? null,
        code: String(r.code ?? ''),
        name: String(r.name ?? ''),
        country: r.country ? String(r.country).trim() : null,
      }));
    },
  );
}
