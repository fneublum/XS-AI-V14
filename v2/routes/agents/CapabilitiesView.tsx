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
