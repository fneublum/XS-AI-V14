// Stream view — pending decisions + recent activity.
// The DecisionCard is internal to this view; only StreamView is exported.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, X, Trash2, RefreshCw,
  ChevronDown, ChevronRight, Link as LinkIcon,
} from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody,
  Badge, Button, EmptyState,
} from '../../primitives';
import { cn } from '../../primitives/utils';
import {
  api, useNotify,
  type Action,
  fmtAgo, humanSummary, humanReason, humanDraft, refChips,
  AgentChip, TierBadge, ConnectionBanner,
} from './_shared';

export default function StreamView() {
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
    <div className="space-y-5">
      <ConnectionBanner error={error} />

      {/* Filter pills + refresh — bento pill switcher pattern */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] uppercase tracking-[0.14em] mr-1" style={{ color: 'var(--b-text-mute)' }}>Show</span>
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)' }}>
          {(['pending', 'today', 'all'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors"
              style={{
                background: filter === k ? 'var(--b-teal-2)' : 'transparent',
                color: filter === k ? 'white' : 'var(--b-text-mute)',
              }}
            >{k}</button>
          ))}
        </div>
        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-colors"
          style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
        >
          <RefreshCw size={12} /> refresh
        </button>
      </div>

      {/* Awaiting your decision — bento section */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="b-display text-[15px] font-semibold" style={{ color: 'var(--b-text)' }}>Awaiting your decision</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium b-mono"
                style={{ background: awaiting.length > 0 ? 'var(--b-gold-soft)' : 'var(--b-surface-2)', color: awaiting.length > 0 ? 'var(--b-gold)' : 'var(--b-text-mute)' }}>
            {awaiting.length}
          </span>
        </div>
        {awaiting.length === 0 ? (
          <div className="rounded-[14px] border-2 border-dashed p-10 text-center"
               style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
            <div className="b-display text-[18px] font-semibold mb-1" style={{ color: 'var(--b-text-soft)' }}>
              No pending decisions
            </div>
            <div className="text-[13px]" style={{ color: 'var(--b-text-mute)' }}>The agents are running clean. ☕</div>
          </div>
        ) : (
          <div className="space-y-3">
            {awaiting.map(a => (
              <DecisionCard
                key={a.id}
                action={a}
                onApprove={() => decide(a.id, 'APPROVED')}
                onDeny={() => decide(a.id, 'DENIED')}
                onCancel={() => cancel(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity — compact rows */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="b-display text-[15px] font-semibold" style={{ color: 'var(--b-text)' }}>Recent activity</h2>
          <span className="text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>last 60</span>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-[14px] border-2 border-dashed p-8 text-center"
               style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
            <div className="text-[13px]" style={{ color: 'var(--b-text-mute)' }}>(quiet) — no recent agent activity to show.</div>
          </div>
        ) : (
          <div className="rounded-[14px] border overflow-hidden"
               style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface)' }}>
            {recent.slice(0, 60).map((a, i) => {
              const color = `var(--b-c-${a.agent_id}, var(--b-text-soft))`;
              const ok = a.status === 'EXECUTED' || a.status === 'AUTO_APPROVED' || a.status === 'APPROVED';
              const failed = a.status === 'DENIED' || a.status === 'EXPIRED' || a.status === 'FAILED';
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                  style={{ borderTop: i > 0 ? '1px solid var(--b-line-soft)' : 'none' }}
                >
                  <span className="w-5 h-5 rounded-md flex items-center justify-center b-display text-[10px] font-bold text-white shrink-0"
                        style={{ background: color }}>
                    {a.agent_id[0]?.toUpperCase()}
                  </span>
                  <span className="b-display font-semibold text-[12.5px]" style={{ color }}>{a.agent_id}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium b-mono"
                        style={{
                          background: ok ? 'var(--b-emerald-soft)' : failed ? 'var(--b-surface-2)' : 'var(--b-teal-soft)',
                          color: ok ? 'var(--b-emerald)' : failed ? 'var(--b-text-mute)' : 'var(--b-teal-2)',
                        }}>{a.status}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--b-text)' }}>{humanSummary(a)}</span>
                  <code className="b-mono text-[10px]" style={{ color: 'var(--b-text-faint)' }}>{a.capability_id}</code>
                  <span className="b-mono text-[10.5px]" style={{ color: 'var(--b-text-mute)' }}>{fmtAgo(a.proposed_at)}</span>
                  {(a.status === 'APPROVED' || a.status === 'AUTO_APPROVED') && (
                    <button
                      onClick={() => markExecuted(a.id)}
                      title="Mark executed (I did it myself)"
                      className="text-[11px] px-2 py-1 rounded-full font-medium"
                      style={{ background: 'var(--b-emerald-soft)', color: 'var(--b-emerald)' }}
                    >✓ executed</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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

  const agentColor = `var(--b-c-${a.agent_id}, var(--b-text-soft))`;
  return (
    <div className="rounded-[14px] border overflow-hidden"
         style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
      {/* Top stripe in the agent's color */}
      <div className="h-[3px]" style={{ background: agentColor }} />

      <div className="p-4">
        {/* Header: agent + tier + time + capability_id */}
        <div className="flex flex-wrap items-center gap-2.5 text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>
          <span className="w-5 h-5 rounded-md flex items-center justify-center b-display text-[10px] font-bold text-white"
                style={{ background: agentColor }}>
            {a.agent_id[0]?.toUpperCase()}
          </span>
          <span className="b-display font-semibold text-[12.5px]" style={{ color: agentColor }}>{a.agent_id}</span>
          <TierBadge tier={a.tier_at_propose} />
          <span style={{ color: 'var(--b-text-faint)' }}>·</span>
          <span className="b-mono">{fmtAgo(a.proposed_at)}</span>
          <code className="ml-auto b-mono text-[10.5px]" style={{ color: 'var(--b-text-faint)' }}>{a.capability_id}</code>
        </div>

        {/* The headline — what this card is asking */}
        <div className="mt-3 text-[15px] leading-snug" style={{ color: 'var(--b-text)' }}>
          {summary}
        </div>

        {/* Why */}
        {reason && (
          <div className="mt-3 rounded-[10px] p-3 text-[13px] flex gap-2"
               style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)' }}>
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>Why</span>
            <span>{reason}</span>
          </div>
        )}

        {/* Draft preview */}
        {draft && (
          <div className="mt-3">
            <button
              onClick={() => setDraftOpen(o => !o)}
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: 'var(--b-text-mute)' }}
            >
              {draftOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {draftOpen ? 'Hide draft' : 'Show draft preview'}
            </button>
            {draftOpen && (
              <div className="mt-2 rounded-[10px] border p-3 text-[13px]"
                   style={{ background: 'var(--b-surface-2)', borderColor: 'var(--b-line)' }}>
                {draft.subject && (
                  <div className="mb-2 pb-2 border-b" style={{ borderColor: 'var(--b-line)', color: 'var(--b-text)' }}>
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>Subject</span>
                    {draft.subject}
                  </div>
                )}
                <div className="whitespace-pre-wrap" style={{ color: 'var(--b-text-soft)' }}>{draft.body}</div>
              </div>
            )}
          </div>
        )}

        {/* V14 reference chips */}
        {refs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {refs.map(r => (
              <span key={r.label + r.value} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px]"
                    style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}>
                <LinkIcon size={10} style={{ color: 'var(--b-text-mute)' }} />
                <span style={{ color: 'var(--b-text-mute)' }}>{r.label}</span>
                <span className="font-medium b-mono" style={{ color: 'var(--b-text)' }}>{r.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Raw payload — collapsed by default */}
        <div className="mt-3">
          <button
            onClick={() => setRawOpen(o => !o)}
            className="inline-flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--b-text-faint)' }}
          >
            {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            raw payload
          </button>
          {rawOpen && (
            <pre className="mt-2 overflow-x-auto rounded-[10px] border p-2 text-[11px] b-mono"
                 style={{ background: 'var(--b-surface-2)', borderColor: 'var(--b-line)', color: 'var(--b-text-soft)' }}>
              {JSON.stringify(a.payload, null, 2)}
            </pre>
          )}
        </div>

        {/* Approve / Deny / Cancel */}
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--b-line-soft)' }}>
          <button
            onClick={onApprove}
            className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: 'var(--b-emerald)', color: 'white' }}
          >
            <Check size={13} /> Approve
          </button>
          <button
            onClick={onDeny}
            className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: 'var(--b-rose-soft)', color: 'var(--b-rose)' }}
          >
            <X size={13} /> Deny
          </button>
          <button
            onClick={onCancel}
            title="Cancel — drop from queue"
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full"
            style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-mute)' }}
          >
            <Trash2 size={13} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
