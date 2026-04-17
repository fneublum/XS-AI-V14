// Phase 3B — Bookings query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Booking {
  id: string;
  bookingNumber: string;
  customer: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  equipment: string | null;
  etd: string | null;
  eta: string | null;
  status: string;
  salesOrderId: string | null;
}

interface Raw {
  id: string;
  bookingNumber: string | null;
  customer: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  equipment: string | null;
  etd: string | null;
  eta: string | null;
  status: string | null;
  salesOrderId: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useBookings(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Booking[]>(
    ['bookings', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('bookings')
          .select('id, bookingNumber, customer, vesselVoyage, pol, pod, equipment, etd, eta, status, salesOrderId, createdAt')
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`bookingNumber.ilike.*${needle}*,customer.ilike.*${needle}*,vesselVoyage.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        bookingNumber: r.bookingNumber ?? r.id,
        customer: r.customer,
        vesselVoyage: r.vesselVoyage,
        pol: r.pol,
        pod: r.pod,
        equipment: r.equipment,
        etd: r.etd,
        eta: r.eta,
        status: r.status ?? 'BOOKED',
        salesOrderId: r.salesOrderId,
      }));
    },
  );
}
