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
    if (['customer_id', 'amount_usd', 'customer_age_days'].includes(k)) continue;
    parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return parts.join(' · ');
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
    <Card className="border-red-700/40 bg-red-900/10">
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
      <div className="flex items-center gap-2">
        {(['pending', 'today', 'all'] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === k ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400 hover:text-slate-200',
            )}
          >{k}</button>
        ))}
        <Button variant="ghost" onClick={refresh} className="ml-auto">
          <RefreshCw size={14} className="mr-1" /> refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Awaiting your decision ({awaiting.length})</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {awaiting.length === 0 ? (
            <EmptyState title="No pending decisions" description="The agents are running clean. ☕" />
          ) : awaiting.map(a => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <AgentChip id={a.agent_id} />
                  <TierBadge tier={a.tier_at_propose} />
                  <code className="text-sm text-slate-200">{a.capability_id}</code>
                  <span className="text-xs text-slate-500">{fmtAgo(a.proposed_at)}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-slate-400">{fmtPayload(a.payload)}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => decide(a.id, 'APPROVED')}>
                  <Check size={14} className="mr-1" /> Approve
                </Button>
                <Button variant="danger" size="sm" onClick={() => decide(a.id, 'DENIED')}>
                  <X size={14} className="mr-1" /> Deny
                </Button>
                <Button variant="ghost" onClick={() => cancel(a.id)} title="Cancel — drop from queue">
                  ⌫
                </Button>
              </div>
            </div>
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
                <div key={a.id} className="flex items-center gap-3 rounded border border-slate-800 px-3 py-2 text-sm">
                  <AgentChip id={a.agent_id} />
                  <TierBadge tier={a.tier_at_propose} />
                  <code className="text-xs text-slate-300">{a.capability_id}</code>
                  <Badge variant={
                    a.status === 'EXECUTED' || a.status === 'AUTO_APPROVED' || a.status === 'APPROVED' ? 'success' :
                    a.status === 'DENIED' || a.status === 'EXPIRED' || a.status === 'FAILED' ? 'neutral' : 'info'
                  }>{a.status}</Badge>
                  <span className="ml-auto font-mono text-xs text-slate-500">{fmtPayload(a.payload)}</span>
                  <span className="text-xs text-slate-500">{fmtAgo(a.proposed_at)}</span>
                  {(a.status === 'APPROVED' || a.status === 'AUTO_APPROVED') && (
                    <Button variant="ghost" onClick={() => markExecuted(a.id)} title="Mark executed (I did it myself)">
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

// ─── View: Autonomy (thresholds) ───────────────────────────────────────

function AutonomyView() {
  const toast = useNotify();
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        api<Threshold[]>('GET', '/thresholds'),
        api<Agent[]>('GET', '/agents'),
      ]);
      setThresholds(t); setAgents(a); setError(undefined);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function setTier(t: Threshold, tier: Tier) {
    try {
      await api('POST', '/thresholds', {
        agent_id: t.agent_id, capability_id: t.capability_id, tier, constraints: t.constraints,
      });
      toast.success(`${t.agent_id} · ${t.capability_id} → ${tier}`);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function saveConstraints(t: Threshold, raw: string) {
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { toast.error('constraints must be valid JSON'); return; }
    try {
      await api('POST', '/thresholds', {
        agent_id: t.agent_id, capability_id: t.capability_id, tier: t.tier, constraints: parsed,
      });
      toast.success('constraints saved');
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function removeThreshold(t: Threshold) {
    if (!window.confirm(`Remove ${t.agent_id} · ${t.capability_id}?`)) return;
    try {
      await api('DELETE', `/thresholds/${encodeURIComponent(t.agent_id)}/${encodeURIComponent(t.capability_id)}`);
      toast.success('removed');
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

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
      {agents.map(a => {
        const rows = byAgent.get(a.id) ?? [];
        return (
          <Card key={a.id}>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>
                <AgentChip id={a.id} /> <span className="ml-2">{a.display}</span>
                <span className="ml-2 text-xs text-slate-400">{a.role}</span>
              </CardTitle>
              <span className="text-xs text-slate-500">{rows.length} capabilities</span>
            </CardHeader>
            <CardBody>
              {rows.length === 0 ? (
                <EmptyState title="No capabilities granted" description="Grant one from the Capabilities tab." />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {rows.map(t => <ThresholdTile key={t.capability_id} t={t} onTier={setTier} onSave={saveConstraints} onRemove={removeThreshold} />)}
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function ThresholdTile({
  t, onTier, onSave, onRemove,
}: {
  t: Threshold;
  onTier: (t: Threshold, tier: Tier) => void;
  onSave: (t: Threshold, raw: string) => void;
  onRemove: (t: Threshold) => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(t.constraints, null, 2));
  useEffect(() => { setRaw(JSON.stringify(t.constraints, null, 2)); }, [t.constraints]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <code className="text-sm text-slate-200">{t.capability_id}</code>
        {t.destructive && <Badge variant="danger">DESTRUCTIVE</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(['AUTO', 'QUEUE_LOW', 'QUEUE_HIGH', 'NEVER_AUTO'] as Tier[]).map(tier => (
          <button
            key={tier}
            onClick={() => onTier(t, tier)}
            className={cn(
              'rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide',
              t.tier === tier
                ? tier === 'AUTO' ? 'bg-emerald-500 text-emerald-950' :
                  tier === 'QUEUE_LOW' ? 'bg-sky-500 text-sky-950' :
                  tier === 'QUEUE_HIGH' ? 'bg-amber-500 text-amber-950' :
                  'bg-red-500 text-red-950'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200',
            )}
          >{tier}</button>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-slate-500">constraints (JSON):</div>
      <textarea
        value={raw}
        onChange={e => setRaw(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200"
      />
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => onSave(t, raw)}>save constraints</Button>
        <Button variant="ghost" size="sm" onClick={() => onRemove(t)}>
          <Trash2 size={14} />
        </Button>
      </div>
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

// ─── View: Manual action ───────────────────────────────────────────────

function ManualView() {
  const toast = useNotify();
  const [caps, setCaps] = useState<Capability[]>([]);
  const [form, setForm] = useState({
    capability_id: '', customer_id: '', amount_usd: '', note: '',
  });
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<Capability[]>('GET', '/capabilities')
      .then(setCaps).catch(e => setError(e.message));
  }, []);

  async function submit() {
    if (!form.capability_id) { toast.error('pick a capability'); return; }
    const payload: Record<string, any> = {};
    if (form.customer_id) payload.customer_id = form.customer_id;
    if (form.amount_usd) payload.amount_usd = Number(form.amount_usd);
    if (form.note) payload.note = form.note;
    try {
      await api('POST', '/actions/manual', {
        capability_id: form.capability_id, payload, status: 'EXECUTED',
      });
      toast.success('Manual action logged');
      setForm({ capability_id: '', customer_id: '', amount_usd: '', note: '' });
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-6">
      <ConnectionBanner error={error} />

      <Card>
        <CardHeader><CardTitle>Log a manual action</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-slate-400">
            Use this when YOU did something an agent could have done — sent a follow-up by hand,
            closed an order, paid a vendor. Logging it keeps the audit trail complete and lets the
            agents see "Felipe already handled this" so they don't do it again.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">capability</span>
              <select
                value={form.capability_id}
                onChange={e => setForm({ ...form, capability_id: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
              >
                <option value="">— select —</option>
                {caps.map(c => <option key={c.id} value={c.id}>{c.id} — {c.description}</option>)}
              </select>
            </label>
            <Input placeholder="customer_id (e.g. PATEX)" value={form.customer_id}
              onChange={e => setForm({ ...form, customer_id: e.target.value })} />
            <Input placeholder="amount_usd" type="number" value={form.amount_usd}
              onChange={e => setForm({ ...form, amount_usd: e.target.value })} />
            <Input placeholder="note (optional)" value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="mt-4">
            <Button variant="primary" onClick={submit}>Log as EXECUTED by felipe</Button>
          </div>
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
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200">
                <option value="">(any)</option>
                {['felipe','system','max','lara','matt','logan','sal','beth'].map(x =>
                  <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">action</span>
              <select value={action} onChange={e => setAction(e.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200">
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
                <div key={r.id} className="grid grid-cols-12 gap-3 px-4 py-2 font-mono text-xs hover:bg-slate-900/40">
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

export type AgenticView = 'stream' | 'autonomy' | 'capabilities' | 'manual' | 'audit';

const VIEW_META: Record<AgenticView, { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; component: React.FC }> = {
  stream:       { title: 'Agent stream',         icon: Activity,    component: StreamView },
  autonomy:     { title: 'Autonomy thresholds',  icon: Sliders,     component: AutonomyView },
  capabilities: { title: 'Capability registry',  icon: Wrench,      component: CapabilitiesView },
  manual:       { title: 'Log a manual action',  icon: Pencil,      component: ManualView },
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
