// Phase 3B — Union view of logistics documents.
//
// Surfaces anything with an `originalDocument` URL across the logistics
// tables (bill_landings, packing_lists, freight_quotes, bookings) so
// the user has one page to find "whatever PDF was uploaded for order X".

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface LogisticsDoc {
  id: string;
  kind: 'BL' | 'PL' | 'FQ' | 'BK';
  reference: string;
  subject: string;
  url: string | null;
  createdAt: string;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useLogisticsDocs(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim().toLowerCase() ?? '';

  return useSupabaseQuery<LogisticsDoc[]>(
    ['logisticsDocs', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();

      const blQ = scopeByCompany(
        supabase.from('bill_landings')
          .select('id, blNumber, shipper, originalDocument, createdAt')
          .not('originalDocument', 'is', null)
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(50),
        currentCompanyId,
      );
      const plQ = scopeByCompany(
        supabase.from('packing_lists')
          .select('id, plNumber, consignee, originalDocument, createdAt')
          .not('originalDocument', 'is', null)
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(50),
        currentCompanyId,
      );
      const fqQ = scopeByCompany(
        supabase.from('freight_quotes')
          .select('id, agentName, originPort, destinationPort, originalDocument, validUntil')
          .not('originalDocument', 'is', null)
          .order('validUntil', { ascending: false, nullsFirst: false })
          .limit(50),
        currentCompanyId,
      );
      const bkQ = scopeByCompany(
        supabase.from('bookings')
          .select('id, bookingNumber, customer, originalDocument, createdAt')
          .not('originalDocument', 'is', null)
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(50),
        currentCompanyId,
      );

      const [bl, pl, fq, bk] = await Promise.all([blQ, plQ, fqQ, bkQ]);

      const rows: LogisticsDoc[] = [];

      for (const r of (bl.data as Array<{ id: string; blNumber: string | null; shipper: string | null; originalDocument: string | null; createdAt: string | null }> | null) ?? []) {
        rows.push({
          id: `bl.${r.id}`,
          kind: 'BL',
          reference: r.blNumber ?? r.id,
          subject: r.shipper ?? '—',
          url: r.originalDocument,
          createdAt: r.createdAt ?? '',
        });
      }
      for (const r of (pl.data as Array<{ id: string; plNumber: string | null; consignee: string | null; originalDocument: string | null; createdAt: string | null }> | null) ?? []) {
        rows.push({
          id: `pl.${r.id}`,
          kind: 'PL',
          reference: r.plNumber ?? r.id,
          subject: r.consignee ?? '—',
          url: r.originalDocument,
          createdAt: r.createdAt ?? '',
        });
      }
      for (const r of (fq.data as Array<{ id: string; agentName: string | null; originPort: string | null; destinationPort: string | null; originalDocument: string | null; validUntil: string | null }> | null) ?? []) {
        rows.push({
          id: `fq.${r.id}`,
          kind: 'FQ',
          reference: r.agentName ?? r.id,
          subject: `${r.originPort ?? '—'} → ${r.destinationPort ?? '—'}`,
          url: r.originalDocument,
          createdAt: r.validUntil ?? '',
        });
      }
      for (const r of (bk.data as Array<{ id: string; bookingNumber: string | null; customer: string | null; originalDocument: string | null; createdAt: string | null }> | null) ?? []) {
        rows.push({
          id: `bk.${r.id}`,
          kind: 'BK',
          reference: r.bookingNumber ?? r.id,
          subject: r.customer ?? '—',
          url: r.originalDocument,
          createdAt: r.createdAt ?? '',
        });
      }

      const filtered = needle
        ? rows.filter(r =>
            r.reference.toLowerCase().includes(needle)
            || r.subject.toLowerCase().includes(needle)
            || r.kind.toLowerCase().includes(needle),
          )
        : rows;

      filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

      return filtered.slice(0, 200);
    },
  );
}
