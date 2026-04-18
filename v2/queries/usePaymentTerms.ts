// Phase 3B — Payment Terms query.
//
// `payment_terms` is camelCase on companyId / createdAt but snake_case
// on the `num_payments` column. Installments is a JSONB array.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type PaymentEvent = 'ORDER' | 'INVOICE' | 'BL' | 'DELIVERY' | 'SIGHT';

export interface PaymentInstallment {
  payment_number: number;
  pct: number;
  days: number;
  event: PaymentEvent;
  description: string;
}

export interface PaymentTerm {
  id: string;
  companyId: string | null;
  code: string;
  description: string;
  type: 'DOMESTIC' | 'IMPORT' | 'EXPORT' | 'ALL' | string;
  method: string;
  numPayments: number;
  installments: PaymentInstallment[];
  notes: string | null;
  active: boolean;
  createdAt: string | null;
}

interface Raw {
  id: string;
  companyId: string | null;
  code: string | null;
  description: string | null;
  type: string | null;
  method: string | null;
  num_payments: number | string | null;
  installments: PaymentInstallment[] | null;
  notes: string | null;
  active: boolean | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function; or: Function }>(q: Q, companyId: string): Q {
  if (companyId === 'ALL') return q;
  // Payment terms can be shared across all companies by storing
  // companyId = 'ALL'. Surface both the current company's rows and
  // the global ones.
  return q.or(`"companyId".eq.${companyId},"companyId".eq.ALL`) as Q;
}

export function usePaymentTerms(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<PaymentTerm[]>(
    ['paymentTerms', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('payment_terms')
          .select('*')
          .order('code', { ascending: true })
          .limit(500),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`code.ilike.*${needle}*,description.ilike.*${needle}*,method.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as unknown as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        code: r.code ?? r.id,
        description: r.description ?? '—',
        type: r.type ?? 'ALL',
        method: r.method ?? '—',
        numPayments: r.num_payments === null || r.num_payments === undefined
          ? 0
          : Number(r.num_payments),
        installments: Array.isArray(r.installments) ? r.installments : [],
        notes: r.notes,
        active: r.active ?? true,
        createdAt: r.createdAt,
      }));
    },
  );
}
