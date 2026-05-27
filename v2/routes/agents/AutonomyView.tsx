// Autonomy view — per-(agent, capability) trust tier configuration.
// PermissionTile is internal; only AutonomyView is exported.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody,
  Badge, Button, EmptyState, Input,
} from '../../primitives';
import { cn } from '../../primitives/utils';
import {
  api, useNotify,
  type Tier, type Agent, type Capability, type Threshold,
  fmtMoney,
  AgentChip, ConnectionBanner,
} from './_shared';

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

export default function AutonomyView() {
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
      if (maxAmt.trim() !== '' && !isNaN(Number(maxAmt))) constraints.max_amount_usd = Number(maxAmt);
      if (minAge.trim() !== '' && !isNaN(Number(minAge))) constraints.min_customer_age_days = Number(minAge);
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

      <div className="mt-3 flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', human.dotClass)} />
        <div className="text-sm text-slate-300">
          <span className="mr-2 font-medium text-slate-100">{human.label}.</span>
          <span>{human.describe(limits)}</span>
        </div>
      </div>

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
