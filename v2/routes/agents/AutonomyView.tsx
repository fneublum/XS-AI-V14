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
    <div className="space-y-5">
      <ConnectionBanner error={error} />

      {/* Intro hint — bento info card */}
      <div className="rounded-[14px] p-4 text-[13px] flex gap-3"
           style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] shrink-0 pt-0.5"
              style={{ color: 'var(--b-teal-2)' }}>How to use</span>
        <span>
          Set how much each agent is allowed to do on its own. Tighten anything you'd
          rather see first; loosen the routine stuff so they stop bothering you.
        </span>
      </div>

      {/* Beth is Ana Paula's personal assistant (gmail/gcal scope) and
        * doesn't propose business actions through the queue — omit her
        * here so the Autonomy view stays focused on operational agents. */}
      {agents.filter(a => a.id !== 'beth').map(a => {
        const rows = byAgent.get(a.id) ?? [];
        const color = `var(--b-c-${a.id}, var(--b-text-soft))`;
        return (
          <div key={a.id} className="rounded-[14px] border overflow-hidden"
               style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
            {/* Top stripe in agent color */}
            <div className="h-[3px]" style={{ background: color }} />
            {/* Header row */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
              <span className="w-7 h-7 rounded-lg flex items-center justify-center b-display text-[12px] font-bold text-white"
                    style={{ background: color }}>
                {a.id[0]?.toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="b-display text-[15px] font-semibold" style={{ color }}>{a.display}</div>
                <div className="text-[11.5px] truncate" style={{ color: 'var(--b-text-mute)' }}>{a.role}</div>
              </div>
              <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium b-mono"
                    style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-mute)' }}>
                {rows.length} {rows.length === 1 ? 'permission' : 'permissions'}
              </span>
            </div>
            <div className="p-4 space-y-3">
              {rows.length === 0 ? (
                <div className="rounded-[10px] border-2 border-dashed p-6 text-center"
                     style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
                  <div className="b-display text-[14px] font-semibold mb-1" style={{ color: 'var(--b-text-soft)' }}>
                    No permissions yet
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--b-text-mute)' }}>
                    {a.display} can't act on anything until you grant a capability in the Capabilities tab.
                  </div>
                </div>
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
            </div>
          </div>
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
    <div className="rounded-[12px] border p-4"
         style={{ background: 'var(--b-surface-2)', borderColor: 'var(--b-line)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] leading-snug" style={{ color: 'var(--b-text)' }}>{description}</div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <code className="b-mono" style={{ color: 'var(--b-text-mute)' }}>{t.capability_id}</code>
            {cap?.destructive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium b-mono"
                    style={{ background: 'var(--b-rose-soft)', color: 'var(--b-rose)' }}>destructive</span>
            )}
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
                  className="b-display text-[12px] font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--b-surface)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line-bold)' }}>
            Change
          </button>
        )}
      </div>

      {/* Current behaviour — the human paragraph */}
      <div className="mt-3 flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', human.dotClass)} />
        <div className="text-[13px]" style={{ color: 'var(--b-text-soft)' }}>
          <span className="mr-1.5 font-medium" style={{ color: 'var(--b-text)' }}>{human.label}.</span>
          <span>{human.describe(limits)}</span>
        </div>
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="mt-4 rounded-[10px] p-3 border"
             style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>Trust level</div>
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
                    'flex items-start gap-2 rounded-[10px] border p-2.5 text-left transition-colors',
                    disabled && 'opacity-40 cursor-not-allowed',
                  )}
                  style={{
                    background: selected ? 'var(--b-teal-soft)' : 'var(--b-surface-2)',
                    borderColor: selected ? 'var(--b-teal-2)' : 'var(--b-line)',
                  }}
                >
                  <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', h.dotClass)} />
                  <span>
                    <div className="text-[13px] font-medium" style={{ color: 'var(--b-text)' }}>{h.label}</div>
                    <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>{h.describe('your limits')}</div>
                    {disabled && (
                      <div className="mt-1 text-[10.5px]" style={{ color: 'var(--b-gold)' }}>
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
              <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>
                Limits for "Auto within limits"
              </div>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>Leave a field blank to skip that condition.</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[12.5px]">
                  <span style={{ color: 'var(--b-text-mute)' }}>Max amount (USD)</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 5000"
                    value={maxAmt}
                    onChange={e => setMaxAmt(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px]">
                  <span style={{ color: 'var(--b-text-mute)' }}>Customer age (days)</span>
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

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--b-line-soft)' }}>
            <button onClick={commit}
                    className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full"
                    style={{ background: 'var(--b-teal-2)', color: 'white' }}>
              Save
            </button>
            <button onClick={() => setEditing(false)}
                    className="text-[12px] px-3 py-1.5 rounded-full"
                    style={{ color: 'var(--b-text-mute)' }}>
              Cancel
            </button>
            <span className="flex-1" />
            <button onClick={() => onRemove(t)}
                    className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full"
                    style={{ background: 'var(--b-rose-soft)', color: 'var(--b-rose)' }}>
              <Trash2 size={12} /> Revoke permission
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
