// Hermes Document Audit query + mutations.
//
// The `bl_audits` table is fed by the Hermes Agent running on Felipe's
// Mac mini (which writes via the Supabase service-role key, bypassing
// RLS). XS-AI reads the rows here and writes back three columns:
//   * correction_authorized   — Hermes polls this; flips a sent flag
//   * correction_dismissed    — accept BL as-is, no email
//   * correction_edit_body    — user-edited replacement body
//
// See /Users/felipeneublum/Desktop/XS-AI-Document-Audit-Menu-Briefing.md

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export type BlAuditStatus =
  | 'green'
  | 'yellow'
  | 'red'
  | 'pending'
  | 'broken_linkage'
  | 'resolved';

export type IssueSeverity = 'red' | 'yellow';

export interface BlAuditIssue {
  severity: IssueSeverity;
  field: string;
  ci: string | null;
  pl: string | null;
  bl: string | null;
  note: string;
}

/**
 * Per-field correction the user explicitly approved in the audit modal.
 * Currently appended to bl_audits.applied_corrections (JSONB array) for
 * audit trail. In a follow-up Hermes will read this list and apply each
 * correction to the underlying CI / PL row in XS-AI.
 */
export interface AppliedCorrection {
  field: string;                   // e.g. "net_weight"
  doc: 'CI' | 'PL';                // which document gets corrected
  old_value: string | null;        // what was missing/wrong (likely null)
  new_value: string;               // approved value
  approved_at: string;             // ISO timestamp
  approved_by?: string | null;     // user email when known
}

export interface BlAudit {
  bl_number: string;
  deal_name: string | null;
  company: string | null;
  status: BlAuditStatus;
  audited_at: string;
  hold_risk_count: number;
  warn_count: number;
  issues_json: BlAuditIssue[];
  correction_email_draft_id: string | null;
  correction_email_sent_at: string | null;
  correction_carrier: string | null;
  correction_authorized: boolean;
  correction_dismissed: boolean;
  correction_edit_body: string | null;
  last_carrier_reply_at: string | null;
  resolved_at: string | null;
  notes: string | null;
  report_log_path: string | null;
  applied_corrections: AppliedCorrection[];
  // Denormalized document headers (populated by Hermes Agent on each
  // audit run; partially backfilled from issues_json for existing rows
  // — see 20260522210000_bl_audits_denormalize_doc_headers.sql).
  shipper: string | null;
  consignee: string | null;
  invoice_number: string | null;
  bl_date: string | null; // ISO date 'YYYY-MM-DD'
}

export interface UseBlAuditsOptions {
  status?: BlAuditStatus | 'ALL';
  company?: string | 'ALL';
  /** YYYY-MM-DD cutoff; rows with audited_at >= cutoff are returned. */
  sinceIso?: string | null;
  search?: string;
}

export function useBlAudits(opts: UseBlAuditsOptions = {}) {
  const { status = 'ALL', company = 'ALL', sinceIso = null, search = '' } = opts;
  return useQuery<BlAudit[]>({
    queryKey: ['blAudits', status, company, sinceIso, search.trim()],
    queryFn: async () => {
      const sb = getSupabaseClient();
      let q = sb.from('bl_audits')
        .select('*')
        .order('audited_at', { ascending: false })
        .limit(500);
      if (status !== 'ALL') q = q.eq('status', status);
      if (company !== 'ALL') q = q.eq('company', company);
      if (sinceIso) q = q.gte('audited_at', sinceIso);
      const needle = search.trim();
      if (needle) {
        q = q.or(
          `bl_number.ilike.*${needle}*,deal_name.ilike.*${needle}*,correction_carrier.ilike.*${needle}*`,
        );
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Partial<BlAudit>>).map(r => ({
        bl_number: r.bl_number ?? '',
        deal_name: r.deal_name ?? null,
        company: r.company ?? null,
        status: (r.status as BlAuditStatus) ?? 'pending',
        audited_at: r.audited_at ?? '',
        hold_risk_count: Number(r.hold_risk_count ?? 0),
        warn_count: Number(r.warn_count ?? 0),
        issues_json: Array.isArray(r.issues_json) ? (r.issues_json as BlAuditIssue[]) : [],
        applied_corrections: Array.isArray((r as Record<string, unknown>).applied_corrections)
          ? ((r as Record<string, unknown>).applied_corrections as AppliedCorrection[])
          : [],
        correction_email_draft_id: r.correction_email_draft_id ?? null,
        correction_email_sent_at: r.correction_email_sent_at ?? null,
        correction_carrier: r.correction_carrier ?? null,
        correction_authorized: !!r.correction_authorized,
        correction_dismissed: !!r.correction_dismissed,
        correction_edit_body: r.correction_edit_body ?? null,
        last_carrier_reply_at: r.last_carrier_reply_at ?? null,
        resolved_at: r.resolved_at ?? null,
        notes: r.notes ?? null,
        report_log_path: r.report_log_path ?? null,
        shipper:        ((r as Record<string, unknown>).shipper as string | null) ?? null,
        consignee:      ((r as Record<string, unknown>).consignee as string | null) ?? null,
        invoice_number: ((r as Record<string, unknown>).invoice_number as string | null) ?? null,
        bl_date:        ((r as Record<string, unknown>).bl_date as string | null) ?? null,
      }));
    },
  });
}

/** Patch a single audit row. Used by the Authorize / Edit / Dismiss
 *  actions; Hermes polls these columns and acts on them. */
export function useBlAuditPatch() {
  const qc = useQueryClient();
  return useMutation<void, Error, { bl_number: string; patch: Partial<BlAudit> }>({
    mutationFn: async ({ bl_number, patch }) => {
      const sb = getSupabaseClient();
      const { error } = await sb.from('bl_audits').update(patch).eq('bl_number', bl_number);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['blAudits'] });
    },
  });
}
