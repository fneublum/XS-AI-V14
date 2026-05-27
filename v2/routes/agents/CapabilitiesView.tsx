// Capabilities view — CRUD over the capability registry.

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody,
  Badge, Button, Input,
  Table, THead, TBody, TR, TH, TD,
} from '../../primitives';
import {
  api, useNotify,
  type Capability,
  ConnectionBanner,
} from './_shared';

export default function CapabilitiesView() {
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

      {/* Capability registry */}
      <div className="rounded-[14px] border overflow-hidden"
           style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
        <div className="flex items-baseline gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
          <h2 className="b-display text-[15px] font-semibold" style={{ color: 'var(--b-text)' }}>Capability registry</h2>
          <span className="text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>{caps.length} {caps.length === 1 ? 'capability' : 'capabilities'}</span>
        </div>
        {caps.length === 0 ? (
          <div className="m-4 rounded-[10px] border-2 border-dashed p-8 text-center"
               style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
            <div className="text-[13px]" style={{ color: 'var(--b-text-mute)' }}>No capabilities yet — add one below.</div>
          </div>
        ) : (
          <div>
            {caps.map((c, i) => (
              <div
                key={c.id}
                className="grid items-center gap-3 px-5 py-3"
                style={{
                  gridTemplateColumns: 'minmax(160px, 200px) 110px 1fr auto auto',
                  borderTop: i > 0 ? '1px solid var(--b-line-soft)' : 'none',
                }}
              >
                <code className="b-mono text-[12.5px]" style={{ color: 'var(--b-teal-2)' }}>{c.id}</code>
                <span className="text-[12px] b-mono" style={{ color: 'var(--b-text-mute)' }}>{c.domain}</span>
                <span className="text-[13px] truncate" style={{ color: 'var(--b-text)' }}>{c.description}</span>
                {c.destructive ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium b-mono"
                        style={{ background: 'var(--b-rose-soft)', color: 'var(--b-rose)' }}>
                    DESTRUCTIVE
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium b-mono"
                        style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-mute)' }}>
                    safe
                  </span>
                )}
                <div className="inline-flex gap-1">
                  <button onClick={() => editDescription(c)} title="Edit description"
                          className="w-7 h-7 rounded-md flex items-center justify-center"
                          style={{ color: 'var(--b-text-mute)' }}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => toggleDestructive(c)}
                          className="text-[11px] px-2 py-1 rounded-full"
                          style={{ color: 'var(--b-text-mute)', background: 'var(--b-surface-2)' }}>
                    toggle destructive
                  </button>
                  <button onClick={() => remove(c)} title="Delete capability"
                          className="w-7 h-7 rounded-md flex items-center justify-center"
                          style={{ color: 'var(--b-rose)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add capability */}
      <div className="rounded-[14px] border p-5"
           style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
        <h2 className="b-display text-[15px] font-semibold mb-3" style={{ color: 'var(--b-text)' }}>Add capability</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input placeholder="domain.verb" value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} />
          <Input placeholder="domain" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} />
          <Input placeholder="description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--b-text-soft)' }}>
            <input type="checkbox" checked={form.destructive} onChange={e => setForm({ ...form, destructive: e.target.checked })} />
            destructive
          </label>
        </div>
        <div className="mt-4">
          <button onClick={create}
                  className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-1.5 rounded-full"
                  style={{ background: 'var(--b-teal-2)', color: 'white' }}>
            Add capability
          </button>
        </div>
      </div>
    </div>
  );
}
