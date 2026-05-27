// Audit view — filterable timeline of every action the control-plane recorded.

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardBody, EmptyState } from '../../primitives';
import {
  api,
  type AuditRow,
  AgentChip, ConnectionBanner,
} from './_shared';

export default function AuditView() {
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
    <div className="space-y-5">
      <ConnectionBanner error={error} />

      {/* Filters — bento card with native selects styled inline */}
      <div className="rounded-[14px] border p-4"
           style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>Actor</span>
            <select value={actor} onChange={e => setActor(e.target.value)}
              className="rounded-[10px] px-3 py-2 text-[13px] focus:outline-none focus:ring-2"
              style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}>
              <option value="">(any)</option>
              {['felipe','system','max','lara','matt','logan','sal','beth'].map(x =>
                <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>Action</span>
            <select value={action} onChange={e => setAction(e.target.value)}
              className="rounded-[10px] px-3 py-2 text-[13px] focus:outline-none focus:ring-2"
              style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}>
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
      </div>

      {/* Audit rows */}
      {rows.length === 0 ? (
        <div className="rounded-[14px] border-2 border-dashed p-10 text-center"
             style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
          <div className="b-display text-[16px] font-semibold mb-1" style={{ color: 'var(--b-text-soft)' }}>
            No matching entries
          </div>
          <div className="text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>
            Try different filters, or check back once an agent acts.
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border overflow-hidden"
             style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
          {rows.map((r, i) => {
            const color = `var(--b-c-${r.actor}, var(--b-text-soft))`;
            return (
              <div
                key={r.id}
                className="grid items-center gap-3 px-4 py-2.5 text-[12px]"
                style={{
                  gridTemplateColumns: '160px 28px auto 1fr auto',
                  borderTop: i > 0 ? '1px solid var(--b-line-soft)' : 'none',
                }}
              >
                <span className="b-mono text-[11px]" style={{ color: 'var(--b-text-mute)' }}>{r.ts}</span>
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center b-display text-[10px] font-bold text-white"
                  style={{ background: color }}
                >
                  {r.actor[0]?.toUpperCase()}
                </span>
                <span className="b-display font-semibold text-[12px]" style={{ color }}>{r.actor}</span>
                <span className="min-w-0 flex items-center gap-2">
                  <code className="b-mono text-[11.5px]" style={{ color: 'var(--b-teal-2)' }}>{r.action}</code>
                  <span className="truncate" style={{ color: 'var(--b-text-mute)' }}>
                    {r.subject ? <span className="b-mono">{r.subject.slice(0, 12)}</span> : null}
                    {r.subject && '  '}
                    {JSON.stringify(r.detail)}
                  </span>
                </span>
                <span className="b-mono text-[10.5px]" style={{ color: 'var(--b-text-faint)' }}>#{r.id}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
