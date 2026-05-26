// Agentic console — V14-native shell over XS-agentic control-plane.
//
// Lives in V14's UI so Felipe operates the agentic platform with the
// same look-and-feel as the rest of the ERP. All data comes from the
// XS-agentic control-plane HTTP API (default http://localhost:7878).
// V14 itself is never mutated by this page — it's a thin client.
//
// `view` prop selects which sub-surface to render:
//   stream       — pending decisions + recent activity, approve/deny
//   autonomy     — per-(agent, capability) tier sliders
//   capabilities — capability registry CRUD
//   manual       — log a human-initiated action to the audit trail
//   audit        — filterable timeline of every action

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Sliders, Wrench, Pencil, ScrollText, Check, X, Trash2, RefreshCw,
  ChevronDown, ChevronRight, Link as LinkIcon,
  // Pencil is still used by CapabilitiesView (edit description button).
} from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody,
  Badge, Button, EmptyState, Input,
  Table, THead, TBody, TR, TH, TD,
} from '../primitives';
import { useToast } from '../primitives/Toast';

// Thin wrapper so call sites read like other V14 routes.
function useNotify() {
  const t = useToast();
  return {
    success: (msg: string) => t.push({ kind: 'success', title: msg }),
    error:   (msg: string) => t.push({ kind: 'error',   title: msg }),
  };
}
import { cn } from '../primitives/utils';

// ─── Config ────────────────────────────────────────────────────────────

// Default: relative URL '/xs-agentic' routes through Vite's dev proxy in
// development and through whatever reverse-proxy serves V14 in production.
// Override with window.XS_AGENTIC_URL or VITE_AGENTIC_URL for direct mode.
const CONTROL_PLANE_URL =
  (typeof window !== 'undefined' && (window as any).XS_AGENTIC_URL) ||
  import.meta.env.VITE_AGENTIC_URL ||
  '/xs-agentic';

// ─── Types ─────────────────────────────────────────────────────────────

type Tier = 'AUTO' | 'QUEUE_LOW' | 'QUEUE_HIGH' | 'NEVER_AUTO';

interface Action {
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

interface Agent { id: string; display: string; role: string; active: boolean }
interface Capability { id: string; domain: string; description: string; destructive: boolean }
interface Threshold {
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
interface AuditRow {
  id: number; ts: string; actor: string; action: string;
  subject?: string | null; detail: Record<string, any>;
}

// ─── API client ────────────────────────────────────────────────────────

async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
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

// ─── Shared helpers ────────────────────────────────────────────────────

function fmtAgo(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const ago = (Date.now() - d.getTime()) / 1000;
  if (ago < 60) return `${Math.floor(ago)}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
  return d.toLocaleString();
}

function fmtPayload(p: Record<string, any> = {}): string {
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

function fmtMoney(n: any): string {
  if (typeof n !== 'number') return String(n ?? '');
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ── Human renderers ──────────────────────────────────────────────────
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

function humanSummary(a: Action): string {
  if (typeof a.payload.summary === 'string' && a.payload.summary.trim()) return a.payload.summary;
  const t = SUMMARY_TEMPLATES[a.capability_id];
  return t ? t(a) : `${a.agent_id} proposed ${a.capability_id}.`;
}

function humanReason(a: Action): string | null {
  if (typeof a.payload.reason === 'string' && a.payload.reason.trim()) return a.payload.reason;
  return null;
}

interface Draft { subject?: string; body: string }
function humanDraft(a: Action): Draft | null {
  const d = a.payload.draft;
  if (!d) return null;
  if (typeof d === 'string') return { body: d };
  if (typeof d === 'object' && d && typeof d.body === 'string') return d as Draft;
  return null;
}

// Chips for V14 cross-references — what entities this action touches.
function refChips(a: Action): { label: string; value: string }[] {
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
  felipe: 'text-emerald-400',
  system: 'text-slate-400',
};

function AgentChip({ id }: { id: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-medium', AGENT_TONE[id] || 'text-slate-300')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {id}
    </span>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  return <Badge variant={TIER_VARIANT[tier]}>{tier}</Badge>;
}

// ─── Connection banner ─────────────────────────────────────────────────

function ConnectionBanner({ error }: { error?: string }) {
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

// ─── View: Stream ──────────────────────────────────────────────────────

function StreamView() {
  const toast = useNotify();
  const [actions, setActions] = useState<Action[]>([]);
  const [filter, setFilter] = useState<'pending' | 'today' | 'all'>('pending');
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const list = filter === 'pending'
        ? await api<Action[]>('GET', '/actions?limit=200')
        : await api<Action[]>('GET', '/actions/all?limit=500');
      const today = new Date().toISOString().slice(0, 10);
      const filtered = filter === 'today' ? list.filter(a => a.proposed_at?.startsWith(today)) : list;
      setActions(filtered);
      setError(undefined);
    } catch (e: any) { setError(e.message); }
  }, [filter]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const awaiting = useMemo(() => actions.filter(a => a.status === 'AWAITING_APPROVAL'), [actions]);
  const recent = useMemo(() => actions.filter(a => a.status !== 'AWAITING_APPROVAL'), [actions]);

  async function decide(id: string, decision: 'APPROVED' | 'DENIED') {
    try {
      await api('POST', `/actions/${encodeURIComponent(id)}/decide`, { decision, decided_by: 'felipe' });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Denied');
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function cancel(id: string) {
    if (!window.confirm('Cancel this pending action? Marked as EXPIRED.')) return;
    try { await api('POST', `/actions/${encodeURIComponent(id)}/cancel`, {}); toast.success('Canceled'); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function markExecuted(id: string) {
    try { await api('POST', `/actions/${encodeURIComponent(id)}/manually_executed`, { result: {} }); toast.success('Marked executed'); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-6">
      <ConnectionBanner error={error} />
      <div className="flex items-center gap-1.5">
        {(['pending', 'today', 'all'] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium border transition-colors',
              filter === k
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-[#1f1f1f] bg-[#0f0f0f] text-slate-400 hover:text-slate-200 hover:border-[#2a2a2a]',
            )}
          >{k}</button>
        ))}
        <Button variant="ghost" onClick={refresh} className="ml-auto">
          <RefreshCw size={14} className="mr-1" /> refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Awaiting your decision ({awaiting.length})</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {awaiting.length === 0 ? (
            <EmptyState title="No pending decisions" description="The agents are running clean. ☕" />
          ) : awaiting.map(a => (
            <DecisionCard
              key={a.id}
              action={a}
              onApprove={() => decide(a.id, 'APPROVED')}
              onDeny={() => decide(a.id, 'DENIED')}
              onCancel={() => cancel(a.id)}
            />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
        <CardBody>
          {recent.length === 0 ? (
            <EmptyState title="(quiet)" description="No recent agent activity to show." />
          ) : (
            <div className="space-y-1.5">
              {recent.slice(0, 60).map(a => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 rounded border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2 text-sm">
                  <AgentChip id={a.agent_id} />
                  <Badge variant={
                    a.status === 'EXECUTED' || a.status === 'AUTO_APPROVED' || a.status === 'APPROVED' ? 'success' :
                    a.status === 'DENIED' || a.status === 'EXPIRED' || a.status === 'FAILED' ? 'neutral' : 'info'
                  }>{a.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{humanSummary(a)}</span>
                  <code className="text-[10px] text-slate-500">{a.capability_id}</code>
                  <span className="text-xs text-slate-500">{fmtAgo(a.proposed_at)}</span>
                  {(a.status === 'APPROVED' || a.status === 'AUTO_APPROVED') && (
                    <Button variant="ghost" size="sm" onClick={() => markExecuted(a.id)} title="Mark executed (I did it myself)">
                      ✓ executed
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── DecisionCard ──────────────────────────────────────────────────────
// Human-readable card for a single pending action. Top line is a one-
// sentence summary the operator can decide on without reading the
// payload. Optional reason paragraph and draft preview expand below.

function DecisionCard({
  action, onApprove, onDeny, onCancel,
}: {
  action: Action;
  onApprove: () => void;
  onDeny: () => void;
  onCancel: () => void;
}) {
  const a = action;
  const [draftOpen, setDraftOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const summary = humanSummary(a);
  const reason = humanReason(a);
  const draft = humanDraft(a);
  const refs = refChips(a);

  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-4 transition-colors hover:border-[#2a2a2a]">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <AgentChip id={a.agent_id} />
        <TierBadge tier={a.tier_at_propose} />
        <span className="text-slate-700">·</span>
        <span>{fmtAgo(a.proposed_at)}</span>
        <code className="ml-auto text-[10px] text-slate-600">{a.capability_id}</code>
      </div>

      {/* Plain-English summary — the headline */}
      <div className="mt-2.5 text-[15px] leading-snug text-slate-100">
        {summary}
      </div>

      {/* Why */}
      {reason && (
        <div className="mt-2.5 flex gap-2 text-sm text-slate-300">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Why</span>
          <span>{reason}</span>
        </div>
      )}

      {/* Draft preview (collapsible) */}
      {draft && (
        <div className="mt-3">
          <button
            onClick={() => setDraftOpen(o => !o)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            {draftOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {draftOpen ? 'Hide draft' : 'Show draft preview'}
          </button>
          {draftOpen && (
            <div className="mt-2 rounded border border-[#1f1f1f] bg-[#141414] p-3 text-sm">
              {draft.subject && (
                <div className="mb-2 pb-2 border-b border-[#1f1f1f] text-slate-200">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Subject</span>
                  {draft.subject}
                </div>
              )}
              <div className="whitespace-pre-wrap text-slate-300">{draft.body}</div>
            </div>
          )}
        </div>
      )}

      {/* V14 reference chips */}
      {refs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {refs.map(r => (
            <span key={r.label + r.value} className="inline-flex items-center gap-1.5 rounded border border-[#1f1f1f] bg-[#141414] px-2 py-0.5 text-xs">
              <LinkIcon size={10} className="text-slate-600" />
              <span className="text-slate-500">{r.label}</span>
              <span className="font-medium text-slate-200">{r.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Raw payload (collapsible) */}
      <div className="mt-3">
        <button
          onClick={() => setRawOpen(o => !o)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
        >
          {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          raw payload
        </button>
        {rawOpen && (
          <pre className="mt-2 overflow-x-auto rounded border border-[#1f1f1f] bg-[#141414] p-2 text-[11px] text-slate-400">{JSON.stringify(a.payload, null, 2)}</pre>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1f1f1f] pt-3">
        <Button variant="primary" size="sm" onClick={onApprove}>
          <Check size={14} className="mr-1" /> Approve
        </Button>
        <Button variant="danger" size="sm" onClick={onDeny}>
          <X size={14} className="mr-1" /> Deny
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} title="Cancel — drop from queue">
          <Trash2 size={14} className="mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── View: Autonomy (thresholds) ───────────────────────────────────────

// ─── Human-friendly tier model ─────────────────────────────────────────
// Backend tier → operator-facing label + dot + 1-sentence behavior
// description. The dot is a colored circle (no emoji) so it stays
// consistent with the rest of the V14 palette.

const TIER_HUMAN: Record<Tier, {
  label: string;
  dotClass: string;
  describe: (limits: string) => string;
}> = {
  AUTO: {
    label: 'Auto',
    dotClass: 'bg-emerald-400',
    describe: () => 'The agent does this on its own. You see it in the audit log after the fact.',
  },
  QUEUE_LOW: {
    label: 'Auto within limits',
    dotClass: 'bg-sky-400',
    describe: (limits) =>
      limits
        ? `The agent does this on its own when ${limits}. Anything outside those limits is sent to you for approval.`
        : 'The agent does this on its own within set limits; outside those limits, asks you first.',
  },
  QUEUE_HIGH: {
    label: 'Always ask first',
    dotClass: 'bg-amber-400',
    describe: () => 'The agent drafts the action but always waits for your explicit approval before sending.',
  },
  NEVER_AUTO: {
    label: 'Never automatic',
    dotClass: 'bg-red-400',
    describe: () => 'The agent will never do this on its own. Always requires you to act — no shortcuts.',
  },
};

function constraintParts(c: any): string[] {
  const parts: string[] = [];
  if (typeof c?.max_amount_usd === 'number') parts.push(`the amount is at most ${fmtMoney(c.max_amount_usd)}`);
  if (typeof c?.min_customer_age_days === 'number') parts.push(`the customer has been with us for at least ${c.min_customer_age_days} days`);
  if (Array.isArray(c?.allowed_customer_ids) && c.allowed_customer_ids.length > 0) {
    parts.push(`the customer is one of: ${c.allowed_customer_ids.join(', ')}`);
  }
  return parts;
}

function joinParts(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

// ─── View: Autonomy ───────────────────────────────────────────────────

function AutonomyView() {
  const toast = useNotify();
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const [t, a, c] = await Promise.all([
        api<Threshold[]>('GET', '/thresholds'),
        api<Agent[]>('GET', '/agents'),
        api<Capability[]>('GET', '/capabilities'),
      ]);
      setThresholds(t); setAgents(a); setCaps(c); setError(undefined);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function save(t: Threshold, next: { tier: Tier; constraints: Record<string, any> }) {
    try {
      await api('POST', '/thresholds', {
        agent_id: t.agent_id, capability_id: t.capability_id,
        tier: next.tier, constraints: next.constraints,
      });
      toast.success('Saved');
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function removeThreshold(t: Threshold) {
    if (!window.confirm(`Remove ${t.agent_id}'s permission for ${t.capability_id}? The agent will no longer be allowed to propose this.`)) return;
    try {
      await api('DELETE', `/thresholds/${encodeURIComponent(t.agent_id)}/${encodeURIComponent(t.capability_id)}`);
      toast.success('Removed');
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  const capById = useMemo(() => {
    const m = new Map<string, Capability>();
    for (const c of caps) m.set(c.id, c);
    return m;
  }, [caps]);

  const byAgent = useMemo(() => {
    const map = new Map<string, Threshold[]>();
    for (const t of thresholds) {
      if (!map.has(t.agent_id)) map.set(t.agent_id, []);
      map.get(t.agent_id)!.push(t);
    }
    return map;
  }, [thresholds]);

  return (
    <div className="space-y-6">
      <ConnectionBanner error={error} />

      <Card>
        <CardBody className="text-sm text-slate-400">
          Set how much each agent is allowed to do on its own. Tighten anything you'd
          rather see first; loosen the routine stuff so they stop bothering you.
        </CardBody>
      </Card>

      {agents.map(a => {
        const rows = byAgent.get(a.id) ?? [];
        return (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle>
                <AgentChip id={a.id} />
                <span className="ml-2 text-slate-100">{a.display}</span>
                <span className="ml-2 text-xs font-normal text-slate-400">{a.role}</span>
              </CardTitle>
              <span className="text-xs text-slate-500">
                {rows.length} {rows.length === 1 ? 'permission' : 'permissions'}
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              {rows.length === 0 ? (
                <EmptyState
                  title="No permissions yet"
                  description={`${a.display} can't act on anything until you grant a capability in the Capabilities tab.`}
                />
              ) : (
                rows.map(t => (
                  <PermissionTile
                    key={t.capability_id}
                    t={t}
                    cap={capById.get(t.capability_id)}
                    onSave={save}
                    onRemove={removeThreshold}
                  />
                ))
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// ─── PermissionTile ────────────────────────────────────────────────────
// One capability granted to one agent. Shows the human description of
// the current trust level. Click "Change" to open an inline editor with
// trust-level radios and structured limit fields (no JSON).

function PermissionTile({
  t, cap, onSave, onRemove,
}: {
  t: Threshold;
  cap?: Capability;
  onSave: (t: Threshold, next: { tier: Tier; constraints: Record<string, any> }) => void;
  onRemove: (t: Threshold) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tier, setTier] = useState<Tier>(t.tier);
  const [maxAmt, setMaxAmt] = useState<string>(
    typeof t.constraints?.max_amount_usd === 'number' ? String(t.constraints.max_amount_usd) : ''
  );
  const [minAge, setMinAge] = useState<string>(
    typeof t.constraints?.min_customer_age_days === 'number' ? String(t.constraints.min_customer_age_days) : ''
  );

  // Re-seed local state when the threshold refreshes from server.
  useEffect(() => {
    setTier(t.tier);
    setMaxAmt(typeof t.constraints?.max_amount_usd === 'number' ? String(t.constraints.max_amount_usd) : '');
    setMinAge(typeof t.constraints?.min_customer_age_days === 'number' ? String(t.constraints.min_customer_age_days) : '');
  }, [t.tier, t.constraints]);

  const human = TIER_HUMAN[t.tier];
  const limits = joinParts(constraintParts(t.constraints));
  const description = cap?.description ?? t.capability_id;

  function commit() {
    const constraints: Record<string, any> = {};
    if (tier === 'QUEUE_LOW') {
      // Only QUEUE_LOW uses the structured limits — other tiers ignore them.
      if (maxAmt.trim() !== '' && !isNaN(Number(maxAmt))) constraints.max_amount_usd = Number(maxAmt);
      if (minAge.trim() !== '' && !isNaN(Number(minAge))) constraints.min_customer_age_days = Number(minAge);
      // Preserve any constraints we don't expose in the UI (e.g. allowed_customer_ids).
      for (const [k, v] of Object.entries(t.constraints ?? {})) {
        if (k !== 'max_amount_usd' && k !== 'min_customer_age_days') constraints[k] = v;
      }
    }
    onSave(t, { tier, constraints });
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#141414] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug text-slate-100">{description}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <code>{t.capability_id}</code>
            {cap?.destructive && <Badge variant="danger">destructive</Badge>}
          </div>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Change</Button>
        )}
      </div>

      {/* Current behavior — the human paragraph */}
      <div className="mt-3 flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', human.dotClass)} />
        <div className="text-sm text-slate-300">
          <span className="mr-2 font-medium text-slate-100">{human.label}.</span>
          <span>{human.describe(limits)}</span>
        </div>
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="mt-4 rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Trust level</div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['AUTO', 'QUEUE_LOW', 'QUEUE_HIGH', 'NEVER_AUTO'] as Tier[]).map(opt => {
              const h = TIER_HUMAN[opt];
              const selected = tier === opt;
              const disabled = cap?.destructive && opt === 'AUTO';
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTier(opt)}
                  className={cn(
                    'flex items-start gap-2 rounded border p-2.5 text-left transition-colors',
                    selected
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-[#1f1f1f] bg-[#141414] hover:border-[#2a2a2a]',
                    disabled && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', h.dotClass)} />
                  <span>
                    <div className="text-sm font-medium text-slate-100">{h.label}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{h.describe('your limits')}</div>
                    {disabled && (
                      <div className="mt-1 text-[11px] text-amber-400">
                        Not available — this capability is marked destructive.
                      </div>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Limits — only meaningful for QUEUE_LOW */}
          {tier === 'QUEUE_LOW' && (
            <>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Limits for "Auto within limits"</div>
              <p className="mt-1 text-xs text-slate-500">Leave a field blank to skip that condition.</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-400">Max amount (USD)</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 5000"
                    value={maxAmt}
                    onChange={e => setMaxAmt(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-400">Customer age (days)</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 180"
                    value={minAge}
                    onChange={e => setMinAge(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1f1f1f] pt-3">
            <Button variant="primary" size="sm" onClick={commit}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onRemove(t)}>
              <Trash2 size={14} className="mr-1" /> Revoke permission
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── View: Capabilities ────────────────────────────────────────────────

function CapabilitiesView() {
  const toast = useNotify();
  const [caps, setCaps] = useState<Capability[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [form, setForm] = useState({ id: '', domain: '', description: '', destructive: false });

  const refresh = useCallback(async () => {
    try { setCaps(await api<Capability[]>('GET', '/capabilities')); setError(undefined); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    if (!form.id || !form.domain || !form.description) { toast.error('id, domain, description required'); return; }
    try { await api('POST', '/capabilities', form); toast.success('added'); setForm({ id: '', domain: '', description: '', destructive: false }); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function toggleDestructive(c: Capability) {
    try { await api('PATCH', `/capabilities/${encodeURIComponent(c.id)}`, { destructive: !c.destructive }); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function editDescription(c: Capability) {
    const next = window.prompt('Edit description', c.description);
    if (next == null || next === c.description) return;
    try { await api('PATCH', `/capabilities/${encodeURIComponent(c.id)}`, { description: next }); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function remove(c: Capability) {
    if (!window.confirm(`Delete capability "${c.id}"?`)) return;
    try { await api('DELETE', `/capabilities/${encodeURIComponent(c.id)}`); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-6">
      <ConnectionBanner error={error} />

      <Card>
        <CardHeader><CardTitle>Capability registry</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>ID</TH><TH>Domain</TH><TH>Description</TH>
                <TH>Destructive</TH><TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {caps.map(c => (
                <TR key={c.id}>
                  <TD><code className="text-sm">{c.id}</code></TD>
                  <TD>{c.domain}</TD>
                  <TD className="text-slate-300">{c.description}</TD>
                  <TD>{c.destructive ? <Badge variant="danger">YES</Badge> : <Badge variant="neutral">no</Badge>}</TD>
                  <TD className="text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" onClick={() => editDescription(c)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" onClick={() => toggleDestructive(c)}>
                        toggle destructive
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(c)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add capability</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input placeholder="domain.verb" value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} />
            <Input placeholder="domain" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} />
            <Input placeholder="description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.destructive} onChange={e => setForm({ ...form, destructive: e.target.checked })} />
              destructive
            </label>
          </div>
          <div className="mt-3"><Button variant="primary" onClick={create}>Add capability</Button></div>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── View: Audit ───────────────────────────────────────────────────────

function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const qs = new URLSearchParams();
    if (actor) qs.set('actor', actor);
    if (action) qs.set('action', action);
    qs.set('limit', '300');
    try {
      setRows(await api<AuditRow[]>('GET', '/audit?' + qs.toString()));
      setError(undefined);
    } catch (e: any) { setError(e.message); }
  }, [actor, action]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-4">
      <ConnectionBanner error={error} />

      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">actor</span>
              <select value={actor} onChange={e => setActor(e.target.value)}
                className="rounded border border-[#1f1f1f] bg-[#141414] px-2 py-1.5 text-slate-200">
                <option value="">(any)</option>
                {['felipe','system','max','lara','matt','logan','sal','beth'].map(x =>
                  <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">action</span>
              <select value={action} onChange={e => setAction(e.target.value)}
                className="rounded border border-[#1f1f1f] bg-[#141414] px-2 py-1.5 text-slate-200">
                <option value="">(any)</option>
                {[
                  'proposed','awaiting','auto_approved','approved','denied','executed','manually_executed',
                  'canceled','manual','agent.created','agent.updated','agent.deleted',
                  'capability.created','capability.updated','capability.deleted',
                  'threshold.upsert','threshold.deleted',
                ].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState title="No matching entries" />
          ) : (
            <div className="divide-y divide-slate-800">
              {rows.map(r => (
                <div key={r.id} className="grid grid-cols-12 gap-3 px-4 py-2 font-mono text-xs hover:bg-[#141414]">
                  <span className="col-span-3 text-slate-500">{r.ts}</span>
                  <span className="col-span-2"><AgentChip id={r.actor} /></span>
                  <span className="col-span-2 text-emerald-300">{r.action}</span>
                  <span className="col-span-5 truncate text-slate-400">
                    {r.subject ? r.subject.slice(0, 8) + '  ' : ''}
                    {JSON.stringify(r.detail)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Main dispatcher ───────────────────────────────────────────────────

export type AgenticView = 'stream' | 'autonomy' | 'capabilities' | 'audit';

const VIEW_META: Record<AgenticView, { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; component: React.FC }> = {
  stream:       { title: 'Agent stream',         icon: Activity,    component: StreamView },
  autonomy:     { title: 'Autonomy',              icon: Sliders,     component: AutonomyView },
  capabilities: { title: 'Capability registry',  icon: Wrench,      component: CapabilitiesView },
  audit:        { title: 'Audit timeline',       icon: ScrollText,  component: AuditView },
};

export default function AgenticConsoleV2({ view = 'stream' }: { view?: AgenticView }) {
  const meta = VIEW_META[view] ?? VIEW_META.stream;
  const Icon = meta.icon;
  const View = meta.component;
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Icon size={20} className="text-emerald-400" />
        <h1 className="text-lg font-semibold text-slate-100">{meta.title}</h1>
        <span className="text-xs text-slate-500">via XS-agentic · {CONTROL_PLANE_URL}</span>
      </div>
      <View />
    </div>
  );
}
