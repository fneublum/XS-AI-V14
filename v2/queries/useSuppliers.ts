// Phase 3B — Suppliers list query.
//
// Columns pulled from services/schema.ts:65 — note the real suppliers
// table does NOT have `poa` or `lastOrderDate`. We surface rating +
// categories instead.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  categories: string[] | null;
  rating: number | null;
  paymentTerms: string | null;
}

interface RawSupplier {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  categories: string[] | null;
  rating: number | string | null;
  paymentTerms: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useSuppliers(search?: string) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search?.trim() ?? '';

  return useSupabaseQuery<Supplier[]>(
    ['suppliers', currentCompanyId, normalizedSearch],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('suppliers')
          .select('id, name, email, phone, country, city, categories, rating, paymentTerms')
          .order('name', { ascending: true })
          .limit(200),
        currentCompanyId,
      );

      if (normalizedSearch) {
        q = q.or(
          `name.ilike.*${normalizedSearch}*,email.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawSupplier[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? '—',
        email: r.email,
        phone: r.phone,
        country: r.country,
        city: r.city,
        categories: r.categories,
        rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
        paymentTerms: r.paymentTerms,
      }));
    },
  );
}
