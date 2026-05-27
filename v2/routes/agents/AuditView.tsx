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
