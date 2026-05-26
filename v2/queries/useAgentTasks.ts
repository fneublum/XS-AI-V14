// Phase 14.18 — Agent Tasks: unified activity feed for everything HERMES
// agents have touched across the ERP.
//
// Sources (joined client-side, ordered by recency):
//   bookings        — status='AVAILABLE' (agent-created via erp.ocr_and_save_booking)
//   invoices        — ai_extracted_by='hermes' (Lara/Matt ingestion)
//   packing_lists   — ai_extracted_by='hermes' (Lara/Logan ingestion)
//   bill_landings   — DRAFT rows with createdAt in window (Lara/Logan ingestion)
//   bl_audits       — audited_at IS NOT NULL OR correction_email_sent_at OR applied_corrections (Logan)
//
// We don't have a single activity_log table that captures every agent
// move yet — this query stitches the same view by reading recency
// markers off the affected business tables.

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type AgentTaskKind =
  | 'booking_ingested'
  | 'invoice_ingested'
  | 'packing_list_ingested'
  | 'bl_ingested'
  | 'bl_audited'
  | 'correction_applied'
  | 'correction_emailed';

export interface AgentTask {
  id: string;                  // synthetic — table:rowId
  timestamp: string;           // ISO
  kind: AgentTaskKind;
  agent: string;               // best-guess inferred from kind
  title: string;               // one-line headline (e.g. "Booking 271230293")
  subtitle: string;            // secondary (e.g. customer · POL→POD)
  entityTable: 'bookings' | 'invoices' | 'packing_lists' | 'bill_landings' | 'bl_audits';
  entityId: string;
  status?: string;             // optional badge color hint
}

interface BookingRow {
  id: string;
  bookingNumber: string;
  customer: string | null;
  pol: string | null;
  pod: string | null;
  createdAt: string | null;
  status: string | null;
}
interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  supplier: string | null;
  soldTo: string | null;
  totalAmount: number | null;
  currency: string | null;
  ai_extracted_at: string | null;
  createdAt: string | null;
  ai_status: string | null;
}
interface PackingListRow {
  id: string;
  plNumber: string;
  shipper: string | null;
  consignee: string | null;
  ai_extracted_at: string | null;
  createdAt: string | null;
  ai_status: string | null;
}
interface BlRow {
  id: string;
  blNumber: string;
  shipper: string | null;
  consignee: string | null;
  portLoading: string | null;
  portDischarge: string | null;
  createdAt: string | null;
  status: string | null;
}
interface AuditRow {
  bl_number: string;
  deal_name: string | null;
  status: string | null;
  audited_at: string | null;
  correction_email_sent_at: string | null;
  applied_corrections: unknown[] | null;
  hold_risk_count: number | null;
  warn_count: number | null;
}

const N = 25;   // per-source cap; final list is sorted then truncated

export function useAgentTasks(limit = 60) {
  return useSupabaseQuery<AgentTask[]>(
    ['agentTasks', limit],
    async () => {
      const supabase = getSupabaseClient();

      // Run all 5 queries in parallel — each capped, then merged.
      const [bookings, invoices, packingLists, bls, audits] = await Promise.all([
        supabase.from('bookings')
          .select('id, bookingNumber, customer, pol, pod, createdAt, status')
          .eq('status', 'AVAILABLE')
          .order('createdAt', { ascending: false })
          .limit(N),

        supabase.from('invoices')
          .select('id, invoiceNumber, supplier, soldTo, totalAmount, currency, ai_extracted_at, createdAt, ai_status')
          .eq('ai_extracted_by', 'hermes')
          .order('ai_extracted_at', { ascending: false, nullsFirst: false })
          .limit(N),

        supabase.from('packing_lists')
          .select('id, plNumber, shipper, consignee, ai_extracted_at, createdAt, ai_status')
          .eq('ai_extracted_by', 'hermes')
          .order('ai_extracted_at', { ascending: false, nullsFirst: false })
          .limit(N),

        supabase.from('bill_landings')
          .select('id, blNumber, shipper, consignee, portLoading, portDischarge, createdAt, status')
          .eq('status', 'DRAFT')
          .order('createdAt', { ascending: false })
          .limit(N),

        supabase.from('bl_audits')
          .select('bl_number, deal_name, status, audited_at, correction_email_sent_at, applied_corrections, hold_risk_count, warn_count')
          .order('audited_at', { ascending: false, nullsFirst: false })
          .limit(N),
      ]);

      const tasks: AgentTask[] = [];

      // Agent ownership is inferred from which HERMES profile most
      // commonly originates each kind of write (see ORCHESTRATION.md).
      // Once we add an explicit agent_audit_log table we'll read this
      // from there instead of guessing.

      for (const r of (bookings.data ?? []) as BookingRow[]) {
        if (!r.createdAt) continue;
        tasks.push({
          id: `bookings:${r.id}`,
          timestamp: r.createdAt,
          kind: 'booking_ingested',
          agent: 'Lara',
          title: `#${r.bookingNumber}`,
          subtitle: [r.customer, [r.pol, r.pod].filter(Boolean).join('→')].filter(Boolean).join(' · '),
          entityTable: 'bookings',
          entityId: r.id,
          status: r.status ?? undefined,
        });
      }

      for (const r of (invoices.data ?? []) as InvoiceRow[]) {
        const ts = r.ai_extracted_at ?? r.createdAt;
        if (!ts) continue;
        const amt = r.totalAmount ? `${r.currency ?? 'USD'} ${r.totalAmount.toLocaleString()}` : '';
        tasks.push({
          id: `invoices:${r.id}`,
          timestamp: ts,
          kind: 'invoice_ingested',
          agent: 'Lara',
          title: r.invoiceNumber,
          subtitle: [r.supplier ?? r.soldTo, amt].filter(Boolean).join(' · '),
          entityTable: 'invoices',
          entityId: r.id,
          status: r.ai_status ?? undefined,
        });
      }

      for (const r of (packingLists.data ?? []) as PackingListRow[]) {
        const ts = r.ai_extracted_at ?? r.createdAt;
        if (!ts) continue;
        tasks.push({
          id: `packing_lists:${r.id}`,
          timestamp: ts,
          kind: 'packing_list_ingested',
          agent: 'Lara',
          title: r.plNumber,
          subtitle: [r.shipper, r.consignee].filter(Boolean).join(' → '),
          entityTable: 'packing_lists',
          entityId: r.id,
          status: r.ai_status ?? undefined,
        });
      }

      for (const r of (bls.data ?? []) as BlRow[]) {
        if (!r.createdAt) continue;
        tasks.push({
          id: `bill_landings:${r.id}`,
          timestamp: r.createdAt,
          kind: 'bl_ingested',
          agent: 'Logan',
          title: r.blNumber,
          subtitle: [r.shipper, [r.portLoading, r.portDischarge].filter(Boolean).join('→')].filter(Boolean).join(' · '),
          entityTable: 'bill_landings',
          entityId: r.id,
          status: r.status ?? undefined,
        });
      }

      for (const r of (audits.data ?? []) as AuditRow[]) {
        const hasApplied = Array.isArray(r.applied_corrections) && r.applied_corrections.length > 0;
        const hasEmail = !!r.correction_email_sent_at;
        const hasAudit = !!r.audited_at;

        // Surface the strongest signal first; only one row per audit.
        if (hasApplied) {
          tasks.push({
            id: `bl_audits:${r.bl_number}:applied`,
            timestamp: r.audited_at ?? new Date().toISOString(),
            kind: 'correction_applied',
            agent: 'Logan',
            title: r.bl_number,
            subtitle: [r.deal_name, `${r.applied_corrections!.length} field(s)`].filter(Boolean).join(' · '),
            entityTable: 'bl_audits',
            entityId: r.bl_number,
            status: r.status ?? undefined,
          });
        } else if (hasEmail) {
          tasks.push({
            id: `bl_audits:${r.bl_number}:emailed`,
            timestamp: r.correction_email_sent_at!,
            kind: 'correction_emailed',
            agent: 'Logan',
            title: r.bl_number,
            subtitle: r.deal_name ?? '',
            entityTable: 'bl_audits',
            entityId: r.bl_number,
            status: r.status ?? undefined,
          });
        } else if (hasAudit) {
          const issues = (r.hold_risk_count ?? 0) + (r.warn_count ?? 0);
          tasks.push({
            id: `bl_audits:${r.bl_number}:audited`,
            timestamp: r.audited_at!,
            kind: 'bl_audited',
            agent: 'Logan',
            title: r.bl_number,
            subtitle: [r.deal_name, issues ? `${issues} issue(s)` : 'no issues'].filter(Boolean).join(' · '),
            entityTable: 'bl_audits',
            entityId: r.bl_number,
            status: r.status ?? undefined,
          });
        }
      }

      // Sort by timestamp desc, then truncate.
      tasks.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return tasks.slice(0, limit);
    },
  );
}
