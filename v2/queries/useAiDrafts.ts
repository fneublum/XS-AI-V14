// AI Drafts inbox — unified view of every PL + CI row that Hermes
// auto-ingested and is waiting for user review.
//
// Pulls from packing_lists + invoices in parallel, normalizes to a single
// shape so the route can render them in one table with consistent actions.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type AiDraftSource = 'PL' | 'CI';

export interface AiDraft {
  id: string;
  source: AiDraftSource;
  /** Display key — plNumber for PL, invoiceNumber for CI */
  docNumber: string;
  shipper: string | null;
  consignee: string | null;
  /** Document date — invoiceDate for CI, date for PL */
  date: string | null;
  sourcePdfPath: string | null;
  extractedAt: string | null;
  extractedBy: string | null;
  companyId: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useAiDrafts() {
  const { currentCompanyId } = useCompany();

  return useSupabaseQuery<AiDraft[]>(
    ['aiDrafts', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();

      const plQ = scopeByCompany(
        sb.from('packing_lists')
          .select('id, plNumber, shipper, consignee, date, ai_source_pdf_path, ai_extracted_at, ai_extracted_by, companyId')
          .eq('ai_status', 'ai_draft')
          .order('ai_extracted_at', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      const ciQ = scopeByCompany(
        sb.from('invoices')
          .select('id, invoiceNumber, shipper, consignee, date, invoiceDate, ai_source_pdf_path, ai_extracted_at, ai_extracted_by, companyId')
          .eq('ai_status', 'ai_draft')
          .order('ai_extracted_at', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );

      const [plRes, ciRes] = await Promise.all([plQ, ciQ]);
      if (plRes.error) throw new Error(plRes.error.message);
      if (ciRes.error) throw new Error(ciRes.error.message);

      const pl: AiDraft[] = ((plRes.data as any[]) ?? []).map(r => ({
        id: r.id,
        source: 'PL' as const,
        docNumber: r.plNumber ?? r.id,
        shipper: r.shipper,
        consignee: r.consignee,
        date: r.date,
        sourcePdfPath: r.ai_source_pdf_path,
        extractedAt: r.ai_extracted_at,
        extractedBy: r.ai_extracted_by,
        companyId: r.companyId,
      }));

      const ci: AiDraft[] = ((ciRes.data as any[]) ?? []).map(r => ({
        id: r.id,
        source: 'CI' as const,
        docNumber: r.invoiceNumber ?? r.id,
        shipper: r.shipper,
        consignee: r.consignee,
        date: r.invoiceDate ?? r.date,
        sourcePdfPath: r.ai_source_pdf_path,
        extractedAt: r.ai_extracted_at,
        extractedBy: r.ai_extracted_by,
        companyId: r.companyId,
      }));

      // Newest-first across both sources
      return [...pl, ...ci].sort((a, b) =>
        (b.extractedAt ?? '').localeCompare(a.extractedAt ?? ''),
      );
    },
  );
}
