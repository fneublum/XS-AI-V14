// Phase 3B — Customers list query.
//
// Supersedes the Phase 3A stub. Uses the same `useSupabaseQuery` helper
// as every other v2 query — one swap-point when TanStack Query lands.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  pod: string | null;
  paymentTerms: string | null;
  lastOrderDate: string | null;
}

interface RawCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  pod: string | null;
  paymentTerms: string | null;
  lastOrderDate: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useCustomers(search?: string) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search?.trim() ?? '';

  return useSupabaseQuery<Customer[]>(
    ['customers', currentCompanyId, normalizedSearch],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('customers')
          .select('id, name, email, phone, country, city, pod, paymentTerms, lastOrderDate')
          .order('name', { ascending: true })
          .limit(200),
        currentCompanyId,
      );

      if (normalizedSearch) {
        // ilike on name OR email — Supabase doesn't support OR on .ilike
        // directly in the JS client without .or(). Use .or() with both.
        q = q.or(
          `name.ilike.*${normalizedSearch}*,email.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawCustomer[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? '—',
        email: r.email,
        phone: r.phone,
        country: r.country,
        city: r.city,
        pod: r.pod,
        paymentTerms: r.paymentTerms,
        lastOrderDate: r.lastOrderDate,
      }));
    },
  );
}
