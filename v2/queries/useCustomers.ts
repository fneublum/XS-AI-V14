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
  email2: string | null;
  email3: string | null;
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
  brokerName: string | null;
  brokerEmail: string | null;
}

interface Raw {
  id: string;
  companyId: string | null;
  name: string | null;
  nickname: string | null;
  taxId: string | null;
  contactPerson: string | null;
  email: string | null;
  email2: string | null;
  email3: string | null;
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
  brokerName: string | null;
  brokerEmail: string | null;
}

// Company-scoped fetch that also honours `sharedWith` so a customer
// owned by Company A but shared with Company B shows up in B's list.
// The stale comment that used to live here said the column didn't
// exist — it does, restored by 20260423190000_customers_sharedwith.sql,
// so the cross-company UI in CustomerDrawer now actually drives list
// visibility.
function scopeByCompany<Q extends { or: Function }>(q: Q, companyId: string): Q {
  if (companyId === 'ALL') return q;
  return q.or(`"companyId".eq.${companyId},"sharedWith".cs.{${companyId}}`) as Q;
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
        email2: r.email2,
        email3: r.email3,
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
        brokerName: r.brokerName ?? null,
        brokerEmail: r.brokerEmail ?? null,
      }));
    },
  );
}
