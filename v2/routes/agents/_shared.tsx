// Shared types, API client, and presentational helpers for the
// Agents Console sub-views (Stream / Autonomy / Capabilities / Audit).
// Lives here instead of in the dispatcher so each view file stays
// focused on its own concern.

import React from 'react';
import { Card, CardBody, Badge } from '../../primitives';
import { useToast } from '../../primitives/Toast';
import { cn } from '../../primitives/utils';
import { useCompany } from '../../providers/CompanyProvider';
import { useCompanies } from '../../queries/useCompanies';

// ─── Company-scoped agent roster ───────────────────────────────────
// GENRYO only uses Gem (the ERP-data agent) today; the rest of the
// HERMES persona team is EC4-specific. Returns the predicate so each
// sub-view can filter its own list. Other companies see everyone.
export function useAllowedAgentIds(): (id: string) => boolean {
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const name = (companies.data ?? []).find(c => c.id === currentCompanyId)?.name ?? '';
  const isGenryo = name.toUpperCase().includes('GENRYO');
  return React.useCallback(
    (id: string) => (isGenryo ? id === 'gem' : true),
    [isGenryo],
  );
}

// ─── Notify ────────────────────────────────────────────────────────────

export function useNotify() {
  const t = useToast();
  return {
    success: (msg: string) => t.push({ kind: 'success', title: msg }),
    error:   (msg: string) => t.push({ kind: 'error',   title: msg }),
  };
}

// ─── Config ────────────────────────────────────────────────────────────

// Default: relative URL '/xs-agentic' routes through Vite's dev proxy in
// development and through whatever reverse-proxy serves V14 in production.
// Override with window.XS_AGENTIC_URL or VITE_AGENTIC_URL for direct mode.
export const CONTROL_PLANE_URL =
  (typeof window !== 'undefined' && (window as any).XS_AGENTIC_URL) ||
  import.meta.env.VITE_AGENTIC_URL ||
  '/xs-agentic';

// ─── Types ─────────────────────────────────────────────────────────────

export type Tier = 'AUTO' | 'QUEUE_LOW' | 'QUEUE_HIGH' | 'NEVER_AUTO';

export interface Action {
  id: string;
  agent_id: string;
  capability_id: string;
  payload: Record<string, any>;
  v14_refs: Record<string, any>;
  status: string;
  tier_at_propose: Tier;
  proposed_at: string;
  decided_at?: string | null;
  decided_by?: string | null;
  executed_at?: string | null;
  exec_result?: any;
  auto_approve_at?: string | null;
}

export interface Agent { id: string; display: string; role: string; active: boolean }
export interface Capability { id: string; domain: string; description: string; destructive: boolean }
export interface Threshold {
  agent_id: string;
  capability_id: string;
  agent_display: string;
  capability_description: string;
  destructive: boolean;
  tier: Tier;
  constraints: Record<string, any>;
  updated_at: string;
  updated_by?: string;
}
export interface AuditRow {
  id: number; ts: string; actor: string; action: string;
  subject?: string | null; detail: Record<string, any>;
}

// ─── API client ────────────────────────────────────────────────────────

export async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(CONTROL_PLANE_URL + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-actor': 'felipe' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(data?.error ?? text ?? `${res.status} ${res.statusText}`);
  return data as T;
}

// ─── Formatters ────────────────────────────────────────────────────────

export function fmtAgo(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const ago = (Date.now() - d.getTime()) / 1000;
  if (ago < 60) return `${Math.floor(ago)}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
  return d.toLocaleString();
}

export function fmtPayload(p: Record<string, any> = {}): string {
  const parts: string[] = [];
  if (p.customer_id) parts.push(`customer=${p.customer_id}`);
  if (p.amount_usd !== undefined) parts.push(`$${p.amount_usd}`);
  if (p.customer_age_days !== undefined) parts.push(`age=${p.customer_age_days}d`);
  for (const [k, v] of Object.entries(p)) {
    if (['customer_id', 'amount_usd', 'customer_age_days', 'summary', 'reason', 'draft'].includes(k)) continue;
    parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return parts.join(' · ');
}

export function fmtMoney(n: any): string {
  if (typeof n !== 'number') return String(n ?? '');
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ─── Human renderers ───────────────────────────────────────────────────
// Each capability gets a template that builds a plain-English one-liner
// from the payload. If the proposing agent supplied `payload.summary`,
// that wins — agents can write better context than a static template.

type SummaryFn = (a: Action) => string;
const SUMMARY_TEMPLATES: Record<string, SummaryFn> = {
  'ar.send_followup': a => {
    const ref = a.v14_refs.invoice_id ?? a.payload.invoice_id;
    const inv = ref ? ` on invoice ${ref}` : '';
    return `Send a payment follow-up to ${a.payload.customer_id} for ${fmtMoney(a.payload.amount_usd)}${inv}.`;
  },
  'ar.send_statement': a =>
    `Send a current AR statement to ${a.payload.customer_id}.`,
  'shipment.notify_eta_change': a =>
    `Notify ${a.payload.customer_id} that the ETA shifted from ${a.payload.old_eta} to ${a.payload.new_eta}.`,
  'rfq.draft_proforma': a =>
    `Draft a proforma for ${a.payload.customer_id} — ${a.payload.product ?? ''} ${fmtMoney(a.payload.amount_usd)}.`,
  'rfq.send_proforma': a =>
    `Send a proforma to ${a.payload.customer_id} — ${a.payload.product ?? ''} ${fmtMoney(a.payload.amount_usd)}.`,
  'email.send_reply': a =>
    `Reply to an email${a.payload.subject ? ` (subject: "${a.payload.subject}")` : ''}.`,
  'finance.move_money': a =>
    `Move ${fmtMoney(a.payload.amount_usd)} to ${a.payload.destination ?? '?'}.`,
};

export function humanSummary(a: Action): string {
  if (typeof a.payload.summary === 'string' && a.payload.summary.trim()) return a.payload.summary;
  const t = SUMMARY_TEMPLATES[a.capability_id];
  return t ? t(a) : `${a.agent_id} proposed ${a.capability_id}.`;
}

export function humanReason(a: Action): string | null {
  if (typeof a.payload.reason === 'string' && a.payload.reason.trim()) return a.payload.reason;
  return null;
}

export interface Draft { subject?: string; body: string }
export function humanDraft(a: Action): Draft | null {
  const d = a.payload.draft;
  if (!d) return null;
  if (typeof d === 'string') return { body: d };
  if (typeof d === 'object' && d && typeof d.body === 'string') return d as Draft;
  return null;
}

// Chips for V14 cross-references — what entities this action touches.
export function refChips(a: Action): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const friendly: Record<string, string> = {
    customer_id: 'Customer',
    invoice_id:  'Invoice',
    booking_id:  'Booking',
    bl_id:       'BL',
    rfq_id:      'RFQ',
    so_id:       'SO',
    po_id:       'PO',
  };
  for (const [k, v] of Object.entries(a.v14_refs ?? {})) {
    out.push({ label: friendly[k] ?? k, value: String(v) });
  }
  return out;
}

// ─── Tier + agent presentational ───────────────────────────────────────

type BadgeVariant = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

const TIER_VARIANT: Record<Tier, BadgeVariant> = {
  AUTO: 'success',
  QUEUE_LOW: 'info',
  QUEUE_HIGH: 'warning',
  NEVER_AUTO: 'danger',
};

const AGENT_TONE: Record<string, string> = {
  max:    'text-violet-300',
  lara:   'text-pink-300',
  matt:   'text-emerald-300',
  logan:  'text-sky-300',
  sal:    'text-amber-300',
  beth:   'text-rose-300',
  gem:    'text-indigo-300',
  felipe: 'text-emerald-400',
  system: 'text-slate-400',
};

export function AgentChip({ id }: { id: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-medium', AGENT_TONE[id] || 'text-slate-300')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {id}
    </span>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <Badge variant={TIER_VARIANT[tier]}>{tier}</Badge>;
}

// ─── Connection banner ─────────────────────────────────────────────────

export function ConnectionBanner({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardBody className="text-sm text-red-300">
        XS-agentic control-plane unreachable at <code className="text-red-200">{CONTROL_PLANE_URL}</code>.
        Start it with <code className="text-red-200">cd ~/Desktop/XS-agentic/services/control-plane && PORT=7878 npm start</code>.
        Details: {error}
      </CardBody>
    </Card>
  );
}
