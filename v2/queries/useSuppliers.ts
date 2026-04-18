// Phase 3B — Suppliers query. Full v1 field parity.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Supplier {
  id: string;
  companyId: string | null;
  name: string;
  taxId: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  categories: string[];
  rating: number | null;
  paymentTerms: string | null;
}

interface RawSupplier {
  id: string;
  companyId: string | null;
  name: string | null;
  taxId: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  categories: string[] | null;
  rating: number | string | null;
  paymentTerms: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useSuppliers(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Supplier[]>(
    ['suppliers', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('suppliers')
          .select('*')
          .order('name', { ascending: true })
          .limit(500),
        currentCompanyId,
      );

      if (needle) {
        q = q.or(
          `name.ilike.*${needle}*,email.ilike.*${needle}*,contactPerson.ilike.*${needle}*,taxId.ilike.*${needle}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawSupplier[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name ?? '—',
        taxId: r.taxId,
        contactPerson: r.contactPerson,
        email: r.email,
        phone: r.phone,
        location: r.location,
        city: r.city,
        state: r.state,
        zip: r.zip,
        country: r.country,
        categories: r.categories ?? [],
        rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
        paymentTerms: r.paymentTerms,
      }));
    },
  );
}
