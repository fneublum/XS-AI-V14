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
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <AgentChip id={a.agent_id} />
        <TierBadge tier={a.tier_at_propose} />
        <span className="text-slate-700">·</span>
        <span>{fmtAgo(a.proposed_at)}</span>
        <code className="ml-auto text-[10px] text-slate-600">{a.capability_id}</code>
      </div>

      <div className="mt-2.5 text-[15px] leading-snug text-slate-100">
        {summary}
      </div>

      {reason && (
        <div className="mt-2.5 flex gap-2 text-sm text-slate-300">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Why</span>
          <span>{reason}</span>
        </div>
      )}

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
