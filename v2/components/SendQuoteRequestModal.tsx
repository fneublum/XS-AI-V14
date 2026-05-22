// RFQ ("Send Quote Request") — V2 port of the v1 Send Quote workflow.
//
// Lets the user pick a route + container type + pickup/delivery details
// and a set of cargo agents, then for each selected agent:
//   1. Sends an HTML email via the user's signed-in Outlook or Gmail
//      account (services/emailService.ts).
//   2. Creates a PENDING freight_quotes row for that agent so the
//      "Freight Quotes" table immediately shows what's in flight.
//
// V1 reference: pages/FreightQuotes.tsx → handleSendQuoteEmails().

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, Send, Mail, Search, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCargoAgents, CargoAgent } from '../queries/useCargoAgents';
import { usePorts, Port } from '../queries/usePorts';
import { useEntityInsert } from '../queries/useEntityMutations';
import { nextFQNumber } from '../lib/fqNumber';
import { sendEmail } from '../../services/emailService';
import {
  getAccountFor, getGoogleAccount, initializeMsal,
} from '../../services/smailAuth';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'route' | 'preview';

const FREIGHT_TYPES = [
  { value: 'PORT_PORT', label: 'Port to Port' },
  { value: 'DOOR_DOOR', label: 'Door to Door' },
  { value: 'PORT_DOOR', label: 'Port to Door' },
  { value: 'DOOR_PORT', label: 'Door to Port' },
];

const CONTAINER_TYPES = ['20DC', '40DC', '40HC'];

const labelFreightType = (v: string): string =>
  FREIGHT_TYPES.find(t => t.value === v)?.label ?? v.replace(/_/g, ' to ');

const labelContainer = (v: string): string =>
  v === '20DC' ? "20' Dry" : v === '40DC' ? "40' Dry" : v === '40HC' ? "40' HC" : v;

const inputCls =
  'w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] ' +
  'rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-none ' +
  'focus:border-indigo-500';

export const SendQuoteRequestModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const agentsQ = useCargoAgents();
  const portsQ = usePorts();

  const [step, setStep] = useState<Step>('route');
  const [originPortId, setOriginPortId] = useState('');
  const [destPortId, setDestPortId] = useState('');
  const [freightType, setFreightType] = useState('PORT_PORT');
  const [pickup, setPickup] = useState('');
  const [delivery, setDelivery] = useState('');
  const [containerType, setContainerType] = useState('40DC');

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agentSearch, setAgentSearch] = useState('');

  const [ccEmails, setCcEmails] = useState<string[]>(['felipe@ec4.enterprises']);
  const [newCc, setNewCc] = useState('');

  const [sending, setSending] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  // Surfaces which mailbox we'll actually send from. The send-strategy
  // picker in emailService.ts prefers Outlook "automation" account
  // (e.g. ai.agent@ec4.enterprises) over "my" account, then falls back
  // to Gmail. Users often check the wrong Sent folder otherwise, so we
  // show this on the preview step.
  const [senderHint, setSenderHint] = useState<string | null>(null);

  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    idPrefix: 'FQ',
    withCreatedAt: false,
  });

  // Reset state when the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep('route');
    setOriginPortId('');
    setDestPortId('');
    setFreightType('PORT_PORT');
    setPickup('');
    setDelivery('');
    setContainerType('40DC');
    setSelectedAgents(new Set());
    setAgentSearch('');
    setCcEmails(['felipe@ec4.enterprises']);
    setNewCc('');
    setResultMsg(null);
    setSending(false);
    // Resolve which mailbox would actually send. Mirrors the strategy
    // order in services/emailService.ts so the hint matches reality.
    (async () => {
      try { await initializeMsal(); } catch { /* non-fatal */ }
      const auto = getAccountFor('automation');
      const mine = getAccountFor('my');
      const gmail = getGoogleAccount();
      const out = auto?.username || mine?.username;
      if (out) {
        setSenderHint(`Outlook · ${out}`);
      } else if (gmail?.email) {
        setSenderHint(`Gmail · ${gmail.email}`);
      } else {
        setSenderHint(null);
      }
    })();
  }, [open]);

  const ports = portsQ.data ?? [];
  const agents = agentsQ.data ?? [];

  const originPort = useMemo<Port | undefined>(
    () => ports.find(p => p.id === originPortId),
    [ports, originPortId],
  );
  const destPort = useMemo<Port | undefined>(
    () => ports.find(p => p.id === destPortId),
    [ports, destPortId],
  );

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    const list = q
      ? agents.filter(a =>
          a.name.toLowerCase().includes(q) ||
          (a.email ?? '').toLowerCase().includes(q) ||
          (a.country ?? '').toLowerCase().includes(q))
      : agents;
    // Agents missing an email come last — they can't actually be sent
    // to but we still show them so the user notices the gap.
    return [...list].sort((a, b) => {
      const aHas = a.email ? 1 : 0;
      const bHas = b.email ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.name.localeCompare(b.name);
    });
  }, [agents, agentSearch]);

  const toggleAgent = (id: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedAgents(new Set([
      ...selectedAgents,
      ...filteredAgents.filter(a => a.email).map(a => a.id),
    ]));
  };
  const clearSelected = () => setSelectedAgents(new Set());

  const addCc = () => {
    const v = newCc.trim();
    if (!v || ccEmails.includes(v)) { setNewCc(''); return; }
    setCcEmails([...ccEmails, v]);
    setNewCc('');
  };
  const removeCc = (e: string) => setCcEmails(ccEmails.filter(x => x !== e));

  const subject = useMemo(() => {
    const o = originPort ? `${originPort.name} (${originPort.code})` : 'N/A';
    const d = destPort ? `${destPort.name} (${destPort.code})` : 'N/A';
    return `Quote Request — ${o} → ${d} | ${labelFreightType(freightType)}`;
  }, [originPort, destPort, freightType]);

  const buildHtml = (agentName: string): string => {
    const o = originPort ? `${originPort.name} (${originPort.code})` : 'N/A';
    const d = destPort ? `${destPort.name} (${destPort.code})` : 'N/A';
    const svc = labelFreightType(freightType);
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e293b; border-bottom: 2px solid #10b981; padding-bottom: 8px;">Freight Quote Request</h2>
        <p>Dear <strong>${agentName}</strong>,</p>
        <p>We kindly request a freight quotation for the following route:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Service Type</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${svc}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Origin</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${o}</td>
          </tr>
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Destination</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${d}</td>
          </tr>
          ${pickup ? `<tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Pick Up</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${pickup}</td></tr>` : ''}
          ${delivery ? `<tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Delivery</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${delivery}</td></tr>` : ''}
          <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Equipment</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${labelContainer(containerType)}</td></tr>
        </table>
        <p>Please provide your best rate, transit time, free time, and any applicable surcharges at your earliest convenience.</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">Sent from XS — X-Solution AI Business Platform.</p>
      </div>
    `;
  };

  // Step transitions.
  const goPreview = () => {
    if (!originPort || !destPort) {
      toast.push({ kind: 'warning', title: 'Origin and destination required' });
      return;
    }
    if (selectedAgents.size === 0) {
      toast.push({ kind: 'warning', title: 'Pick at least one agent' });
      return;
    }
    setStep('preview');
  };

  // The send phase. Loops through selected agents, sends each one, and
  // writes a PENDING freight_quotes row for each successful send so the
  // table mirrors what's "in flight". Failures don't roll back the rows
  // that succeeded — partial success is a valid end-state for RFQs.
  const sendAll = async () => {
    if (sending) return;
    setSending(true);
    setResultMsg(null);

    const companyId = currentCompanyId && currentCompanyId !== 'ALL'
      ? currentCompanyId : '';

    let okCount = 0;
    let failCount = 0;
    const errs: string[] = [];
    let lastProviderMsg: string | null = null;

    for (const agentId of selectedAgents) {
      const agent = agents.find(a => a.id === agentId);
      if (!agent?.email) {
        failCount++;
        errs.push(`${agent?.name || agentId}: no email`);
        continue;
      }
      try {
        const result = await sendEmail({
          to: [agent.email],
          cc: ccEmails.filter(Boolean),
          subject,
          htmlBody: buildHtml(agent.name),
        });
        if (result.success) lastProviderMsg = result.message;
        if (!result.success) {
          failCount++;
          errs.push(`${agent.name}: ${result.message}`);
          continue;
        }
        okCount++;
        // Create a PENDING quote row so it shows up in the table.
        let id: string;
        try { id = await nextFQNumber(); }
        catch { id = `FQ-${Date.now().toString(36)}`; }
        try {
          await insert.mutateAsync({
            id,
            company_id: companyId || null,
            agent_name: agent.name,
            freight_type: freightType,
            origin_port: originPort!.name,
            origin_port_code: originPort!.code,
            destination_port: destPort!.name,
            destination_port_code: destPort!.code,
            pickup_location: pickup || null,
            delivery_location: delivery || null,
            container_type: containerType,
            container_count: 1,
            currency: 'USD',
            is_all_in: true,
            valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            status: 'PENDING',
            date_added: new Date().toISOString().slice(0, 10),
          });
        } catch (rowErr) {
          // Email already left — surface the row write failure but
          // count the send as a partial success.
          errs.push(`${agent.name}: emailed but row not saved — ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      } catch (e) {
        failCount++;
        errs.push(`${agent.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const senderTail = lastProviderMsg ? ` · ${lastProviderMsg}` : '';
    if (failCount === 0) {
      setResultMsg(
        `Sent to ${okCount} agent${okCount === 1 ? '' : 's'} · ` +
        `${okCount} PENDING quote${okCount === 1 ? '' : 's'} created${senderTail}. ` +
        `Check the Sent folder of the account above.`,
      );
      toast.push({
        kind: 'success',
        title: 'Quote requests sent',
        description: lastProviderMsg
          ? `${okCount} agent${okCount === 1 ? '' : 's'} · ${lastProviderMsg}`
          : `${okCount} agent${okCount === 1 ? '' : 's'}`,
      });
      // Stay open a few seconds so the user can read which mailbox sent.
      setTimeout(() => onOpenChange(false), 3500);
    } else {
      setResultMsg(`${okCount} sent · ${failCount} failed${senderTail}: ${errs.join(' · ')}`);
      toast.push({
        kind: failCount > okCount ? 'error' : 'warning',
        title: 'Some sends failed',
        description: errs.slice(0, 2).join(' · '),
      });
    }
    setSending(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[5%] -translate-x-1/2 z-50 w-[min(96vw,720px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
              <Mail size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                Send Quote Request
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                {step === 'route'
                  ? 'Pick a route + agents — we email each agent and create a PENDING quote per agent.'
                  : 'Review and send. Each agent is sent individually.'}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto space-y-4">
            {step === 'route' && (
              <>
                {/* Route */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Origin port *</label>
                    <select
                      value={originPortId}
                      onChange={e => setOriginPortId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— Select origin —</option>
                      {ports.map(p => (
                        <option key={p.id} value={p.id}>{p.code} · {p.name}{p.country ? `, ${p.country}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Destination port *</label>
                    <select
                      value={destPortId}
                      onChange={e => setDestPortId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— Select destination —</option>
                      {ports.map(p => (
                        <option key={p.id} value={p.id}>{p.code} · {p.name}{p.country ? `, ${p.country}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Service</label>
                    <select
                      value={freightType}
                      onChange={e => setFreightType(e.target.value)}
                      className={inputCls}
                    >
                      {FREIGHT_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Equipment</label>
                    <select
                      value={containerType}
                      onChange={e => setContainerType(e.target.value)}
                      className={inputCls}
                    >
                      {CONTAINER_TYPES.map(c => (
                        <option key={c} value={c}>{labelContainer(c)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Pickup (optional)</label>
                    <input
                      value={pickup}
                      onChange={e => setPickup(e.target.value)}
                      placeholder="City, ZIP, address"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Delivery (optional)</label>
                    <input
                      value={delivery}
                      onChange={e => setDelivery(e.target.value)}
                      placeholder="City, ZIP, address"
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Agents */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      Agents to email * <span className="text-slate-600 normal-case tracking-normal font-normal">({selectedAgents.size} selected)</span>
                    </label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button type="button" onClick={selectAllVisible} className="text-indigo-300 hover:text-indigo-200">
                        Select all visible
                      </button>
                      <span className="text-slate-700">·</span>
                      <button type="button" onClick={clearSelected} className="text-slate-400 hover:text-slate-200">
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="relative mb-2">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      value={agentSearch}
                      onChange={e => setAgentSearch(e.target.value)}
                      placeholder="Filter agents by name, email, country"
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                  <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] max-h-[220px] overflow-y-auto divide-y divide-[#161616]">
                    {agentsQ.isLoading && (
                      <div className="px-3 py-4 text-center text-[12px] text-slate-500">Loading agents…</div>
                    )}
                    {!agentsQ.isLoading && filteredAgents.length === 0 && (
                      <div className="px-3 py-4 text-center text-[12px] text-slate-500">No agents match.</div>
                    )}
                    {filteredAgents.map(a => {
                      const checked = selectedAgents.has(a.id);
                      const noEmail = !a.email;
                      return (
                        <label
                          key={a.id}
                          className={
                            'flex items-center gap-2.5 px-3 py-2 text-[12px] cursor-pointer ' +
                            (checked ? 'bg-indigo-500/5' : 'hover:bg-[#141414]') +
                            (noEmail ? ' opacity-50 cursor-not-allowed' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={noEmail}
                            onChange={() => toggleAgent(a.id)}
                            className="accent-indigo-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-slate-200 truncate">{a.name}</div>
                            <div className="text-[11px] text-slate-500 truncate font-mono">
                              {a.email || 'no email on file'}{a.country ? ` · ${a.country}` : ''}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* CC */}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">CC on every email</label>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {ccEmails.map(e => (
                      <span key={e} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] bg-[#141414] border border-[#1f1f1f] text-slate-300 font-mono">
                        {e}
                        <button type="button" onClick={() => removeCc(e)} className="text-slate-500 hover:text-rose-300">
                          <Trash2 size={10} />
                        </button>
                      </span>
                    ))}
                    {ccEmails.length === 0 && (
                      <span className="text-[11.5px] text-slate-600">No CCs</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={newCc}
                      onChange={e => setNewCc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
                      placeholder="add@example.com"
                      className={inputCls}
                    />
                    <Button
                      size="sm" type="button" onClick={addCc}
                      className="bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 h-7 px-2"
                    >
                      <Plus size={12} />
                    </Button>
                  </div>
                </div>
              </>
            )}

            {step === 'preview' && (
              <>
                <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2 text-[12px] space-y-1">
                  <div>
                    <span className="text-slate-500 inline-block w-16">From:</span>
                    <span className="text-indigo-200 font-mono">
                      {senderHint ?? <span className="text-rose-300 font-sans">⚠ No account connected — connect Outlook or Gmail in Settings → Email Integration</span>}
                    </span>
                  </div>
                  <div><span className="text-slate-500 inline-block w-16">Subject:</span> <span className="text-slate-200">{subject}</span></div>
                  <div><span className="text-slate-500 inline-block w-16">Agents:</span> <span className="text-slate-200">{selectedAgents.size}</span></div>
                  <div><span className="text-slate-500 inline-block w-16">CC:</span> <span className="text-slate-300 font-mono">{ccEmails.join(', ') || '—'}</span></div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Sent emails appear in the Sent folder of <span className="text-slate-300 font-mono">{senderHint?.split('·')[1]?.trim() ?? 'the connected mailbox'}</span> — not your personal inbox unless that's the connected account.
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Email preview (rendered for one agent — each send is personalised)</label>
                  <div
                    className="rounded-md border border-[#1f1f1f] bg-white p-3 max-h-[260px] overflow-y-auto text-[12.5px]"
                    style={{ color: '#0f172a' }}
                    dangerouslySetInnerHTML={{
                      __html: buildHtml(
                        agents.find(a => selectedAgents.has(a.id))?.name ?? '[Agent]',
                      ),
                    }}
                  />
                </div>
                {resultMsg && (
                  <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2 text-[12px] text-slate-300">
                    {resultMsg}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center gap-2 justify-end">
            {step === 'route' && (
              <>
                <Button
                  size="sm" variant="secondary"
                  onClick={() => onOpenChange(false)}
                  className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={goPreview}
                  disabled={!originPortId || !destPortId || selectedAgents.size === 0}
                  className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 h-7 px-3 text-[12px] font-medium rounded-md"
                >
                  Preview email
                </Button>
              </>
            )}
            {step === 'preview' && (
              <>
                <Button
                  size="sm" variant="secondary"
                  onClick={() => setStep('route')}
                  disabled={sending}
                  className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={sendAll}
                  disabled={sending}
                  className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 h-7 px-3 text-[12px] font-medium rounded-md"
                >
                  {sending
                    ? <><Loader2 size={12} className="animate-spin" /> Sending…</>
                    : <><Send size={12} /> Send to {selectedAgents.size} agent{selectedAgents.size === 1 ? '' : 's'}</>}
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
