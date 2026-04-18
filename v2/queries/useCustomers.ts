// Phase 3B — Customers query. Full v1 field parity.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type CustomerStatus = 'Active' | 'Inactive' | 'At Risk' | string;

export interface Customer {
  id: string;
  companyId: string | null;
  name: string;
  nickname: string | null;
  taxId: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  creditLimit: number | null;
  paymentTerms: string | null;
  status: CustomerStatus | null;
  totalVolumeLBS: number | null;
  lastOrderDate: string | null;
  sharedWith: string[];
  pod: string | null;
}

interface Raw {
  id: string;
  companyId: string | null;
  name: string | null;
  nickname: string | null;
  taxId: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  creditLimit: number | string | null;
  paymentTerms: string | null;
  status: string | null;
  totalVolumeLBS: number | string | null;
  lastOrderDate: string | null;
  sharedWith: string[] | null;
  pod: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  // The `customers` table does not have a `sharedWith` column in this
  // environment — previous multi-tenant sharing filter was removed to
  // stop a 400 on every Customers load.
  if (companyId === 'ALL') return q;
  return q.eq('"companyId"', companyId) as Q;
}

export function useCustomers(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Customer[]>(
    ['customers', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      // Use select=* because the live DB occasionally drifts from
      // services/schema.ts (columns added by migration but never
      // back-ported into the schema file, or vice versa). Listing
      // columns explicitly risks a 400 on the first missing field.
      let q = scopeByCompany(
        supabase.from('customers')
          .select('*')
          .order('name', { ascending: true })
          .limit(500),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,email.ilike.*${needle}*,taxId.ilike.*${needle}*,contactPerson.ilike.*${needle}*,nickname.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name ?? '—',
        nickname: r.nickname,
        taxId: r.taxId,
        contactPerson: r.contactPerson,
        email: r.email,
        phone: r.phone,
        location: r.location,
        city: r.city,
        state: r.state,
        zip: r.zip,
        country: r.country,
        creditLimit: r.creditLimit === null || r.creditLimit === undefined
          ? null : Number(r.creditLimit),
        paymentTerms: r.paymentTerms,
        status: r.status,
        totalVolumeLBS: r.totalVolumeLBS === null || r.totalVolumeLBS === undefined
          ? null : Number(r.totalVolumeLBS),
        lastOrderDate: r.lastOrderDate,
        sharedWith: r.sharedWith ?? [],
        pod: r.pod,
      }));
    },
  );
}
