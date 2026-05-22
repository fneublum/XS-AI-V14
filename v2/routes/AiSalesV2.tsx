// AI Sales Agent — autonomous proposal orchestrator.
//
// Drafts B2B proposals, renders them to PDF, and dispatches via email
// and/or WhatsApp to three audiences: internal sales reps, existing
// customers, and prospects. Prospects receive WhatsApp only per product
// spec; sales reps and customers can receive both channels. Two modes:
// Review (draft → approve → send) and Auto (send immediately after
// drafting).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Mail, MessageCircle, Send, XCircle, FileText, Users, UserPlus, UserCheck, RefreshCw, Sparkles } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody,
  Button, Badge, Input, EmptyState, Skeleton, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useAuth } from '../providers/AuthProvider';
import { useCustomers } from '../queries/useCustomers';
import { useUsers } from '../queries/useUsers';
import { getSupabaseClient } from '../../services/supabase';
import {
  draftProposal,
  sendProposal,
  approveProposal,
  dismissProposal,
  listProposals,
  listProspects,
  createProspect,
  resolveAgentIdentity,
  targetFromCustomer,
  targetFromProspect,
  targetFromSalesRep,
  type ProposalTarget,
} from '../../services/aiSalesAgentService';
import { generateProposalPdf } from '../services/pdf/proposalPdf';
import { SalesSuggestionsPanel } from '../components/SalesSuggestionsPanel';
import type {
  AiSalesProposal,
  Prospect,
  SalesProposalAudience,
  SalesProposalChannel,
  SalesProposalMode,
} from '../../types';

type TargetOption = {
  key: string;
  label: string;
  sublabel?: string;
  target: ProposalTarget;
};

const audienceLabel: Record<SalesProposalAudience, string> = {
  sales_rep: 'Sales Reps',
  customer: 'Customers',
  prospect: 'Prospects',
};

const statusTone: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  dismissed: 'neutral',
};

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  sending: 'Sending…',
  sent: 'Sent',
  failed: 'Failed',
  dismissed: 'Dismissed',
};

const AiSalesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const { user } = useAuth();

  const [audience, setAudience] = useState<SalesProposalAudience>('customer');
  const [intent, setIntent] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [channel, setChannel] = useState<SalesProposalChannel>('both');
  const [busy, setBusy] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [autoAckSeen, setAutoAckSeen] = useState(false);

  // Wizard step: 1 = Pick recipient, 2 = Add context, 3 = Done.
  // Persisted only in component state — a refresh resets to step 1.
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [pickerOpen, setPickerOpen] = useState(false); // manual recipient disclosure
  const [lastQueuedId, setLastQueuedId] = useState<string | null>(null);

  const resetWizard = useCallback(() => {
    setSelectedKey(null);
    setIntent('');
    setAudience('customer');
    setPickerOpen(false);
    setLastQueuedId(null);
    setWizardStep(1);
  }, []);

  // Target data.
  const customers = useCustomers();
  const users = useUsers();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectLoading, setProspectLoading] = useState(false);

  // Queue.
  const [proposals, setProposals] = useState<AiSalesProposal[]>([]);
  const [proposalLoading, setProposalLoading] = useState(false);

  const loadProspects = useCallback(async () => {
    setProspectLoading(true);
    try {
      setProspects(await listProspects(currentCompanyId));
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Could not load prospects', description: err?.message });
    } finally {
      setProspectLoading(false);
    }
  }, [currentCompanyId, toast]);

  const loadProposals = useCallback(async () => {
    setProposalLoading(true);
    try {
      setProposals(await listProposals({ companyId: currentCompanyId }));
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Could not load proposals', description: err?.message });
    } finally {
      setProposalLoading(false);
    }
  }, [currentCompanyId, toast]);

  useEffect(() => { void loadProspects(); }, [loadProspects]);
  useEffect(() => { void loadProposals(); }, [loadProposals]);

  const targetOptions: TargetOption[] = useMemo(() => {
    if (audience === 'customer') {
      return (customers.data ?? []).map(c => ({
        key: `cust-${c.id}`,
        label: c.name,
        sublabel: [c.contactPerson, c.email].filter(Boolean).join(' · '),
        target: targetFromCustomer(c as any),
      }));
    }
    if (audience === 'sales_rep') {
      return (users.data ?? [])
        .filter(u => u.role?.toLowerCase().includes('sales') || u.role?.toLowerCase().includes('manager') || u.role?.toLowerCase().includes('admin'))
        .map(u => ({
          key: `rep-${u.id}`,
          label: u.name,
          sublabel: [u.role, u.email].filter(Boolean).join(' · '),
          target: targetFromSalesRep({
            id: u.id,
            name: u.name,
            username: u.username,
            email: u.email ?? '',
            phone: u.phone ?? undefined,
            role: (u.role as any) ?? 'User',
            avatarInitials: '',
            allowedCompanies: u.allowedCompanies,
            allowedModules: u.allowedModules,
          } as any),
        }));
    }
    return prospects.map(p => ({
      key: `pros-${p.id}`,
      label: p.name,
      sublabel: [p.companyName, p.phone].filter(Boolean).join(' · '),
      target: targetFromProspect(p),
    }));
  }, [audience, customers.data, users.data, prospects]);

  // When audience switches to prospect, force WhatsApp-only. When the
  // selected key is stale after an audience switch, clear it.
  useEffect(() => {
    if (audience === 'prospect' && channel !== 'whatsapp') setChannel('whatsapp');
    setSelectedKey(null);
  }, [audience]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTarget = useMemo(
    () => targetOptions.find(o => o.key === selectedKey)?.target ?? null,
    [targetOptions, selectedKey],
  );

  const handleDraft = async (mode: SalesProposalMode) => {
    if (!selectedTarget) {
      toast.push({ kind: 'warning', title: 'Pick a recipient first' });
      return;
    }
    if (!intent.trim()) {
      toast.push({ kind: 'warning', title: 'Describe the proposal intent' });
      return;
    }
    // Channel sanity: prospects are WhatsApp-only and need a phone.
    const effectiveChannel: SalesProposalChannel =
      audience === 'prospect' ? 'whatsapp' : channel;
    if ((effectiveChannel === 'email' || effectiveChannel === 'both') && !selectedTarget.recipientEmail) {
      toast.push({ kind: 'warning', title: 'Recipient has no email on file' });
      return;
    }
    if ((effectiveChannel === 'whatsapp' || effectiveChannel === 'both') && !selectedTarget.recipientPhone) {
      toast.push({ kind: 'warning', title: 'Recipient has no phone on file' });
      return;
    }

    setBusy(true);
    try {
      const proposal = await draftProposal({
        target: selectedTarget,
        intent: intent.trim(),
        channel: effectiveChannel,
        mode,
        companyId: currentCompanyId === 'ALL' ? (user?.allowedCompanies?.[0] ?? 'EC4') : currentCompanyId,
        createdBy: user?.id,
      });
      toast.push({
        kind: 'success',
        title: mode === 'auto' ? 'Drafted — sending now' : 'Draft ready for review',
      });
      await loadProposals();
      setLastQueuedId(proposal.id ?? null);
      setWizardStep(3);
      if (mode === 'auto') await handleSend(proposal);
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Draft failed', description: err?.message });
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (proposal: AiSalesProposal) => {
    try {
      // Render PDF when email is in the mix.
      let pdfAttachment: { name: string; base64: string } | undefined;
      if (proposal.channel === 'email' || proposal.channel === 'both') {
        const identity = await resolveAgentIdentity(proposal.companyId);
        const company = await fetchCompany(proposal.companyId);
        const doc = generateProposalPdf(proposal, { company, identity, logoUrl: null });
        const dataUri = doc.output('datauristring');
        const base64 = dataUri.split(',')[1] ?? '';
        pdfAttachment = {
          name: `Proposal-${proposal.id}.pdf`,
          base64,
        };
      }
      const res = await sendProposal(proposal, { pdfAttachment });
      if (res.errors.length > 0) {
        toast.push({
          kind: res.emailSent || res.whatsappSent ? 'warning' : 'error',
          title: res.emailSent || res.whatsappSent ? 'Sent with warnings' : 'Send failed',
          description: res.errors.join('; '),
        });
      } else {
        toast.push({ kind: 'success', title: 'Proposal sent' });
      }
      await loadProposals();
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Send failed', description: err?.message });
      await loadProposals();
    }
  };

  const handleApproveAndSend = async (proposal: AiSalesProposal) => {
    try {
      await approveProposal(proposal.id);
      await handleSend({ ...proposal, status: 'approved' });
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Approve failed', description: err?.message });
    }
  };

  const handleDismiss = async (proposal: AiSalesProposal) => {
    try {
      await dismissProposal(proposal.id);
      toast.push({ kind: 'info', title: 'Dismissed' });
      await loadProposals();
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Dismiss failed', description: err?.message });
    }
  };

  // Quick-add a prospect inline.
  const [newProspectOpen, setNewProspectOpen] = useState(false);
  const [newProspect, setNewProspect] = useState({ name: '', companyName: '', phone: '' });
  const handleCreateProspect = async () => {
    if (!newProspect.name.trim() || !newProspect.phone.trim()) {
      toast.push({ kind: 'warning', title: 'Name and phone are required' });
      return;
    }
    try {
      await createProspect({
        companyId: currentCompanyId === 'ALL' ? (user?.allowedCompanies?.[0] ?? 'EC4') : currentCompanyId,
        name: newProspect.name.trim(),
        companyName: newProspect.companyName.trim() || null,
        phone: newProspect.phone.trim(),
        email: null,
        country: null,
        source: 'manual',
        stage: 'new',
        notes: null,
        assignedTo: user?.id ?? null,
      });
      setNewProspect({ name: '', companyName: '', phone: '' });
      setNewProspectOpen(false);
      toast.push({ kind: 'success', title: 'Prospect added' });
      await loadProspects();
    } catch (err: any) {
      toast.push({ kind: 'error', title: 'Could not add prospect', description: err?.message });
    }
  };

  return (
    <div className="max-w-[1200px]">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">AI Sales Agent</h1>
            <Badge variant="info">autonomous</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Drafts professional proposals and dispatches by email + WhatsApp to sales reps, customers, and prospects.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { void loadProposals(); void loadProspects(); }}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12px]"
        >
          <RefreshCw size={13} className="mr-1.5" /> Refresh
        </Button>
      </div>

      {/* ── Wizard ────────────────────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader>
          <div className="flex items-center justify-between w-full gap-3">
            <CardTitle>
              {wizardStep === 1 && 'Step 1 · Pick a recipient'}
              {wizardStep === 2 && 'Step 2 · Add context'}
              {wizardStep === 3 && 'Step 3 · Done'}
            </CardTitle>
            <StepIndicator current={wizardStep} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Step 1 — Pick recipient ──────────────────────────── */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <SalesSuggestionsPanel
                onDraft={({ customerId, customerName, intent: prefilled }) => {
                  setAudience('customer');
                  if (customerId) {
                    setSelectedKey(`cust-${customerId}`);
                  } else {
                    const byName = (customers.data ?? []).find(c =>
                      c.name?.trim().toLowerCase() === customerName.trim().toLowerCase());
                    if (byName) setSelectedKey(`cust-${byName.id}`);
                  }
                  setIntent(prefilled);
                  setWizardStep(2);
                }}
              />

              {/* Manual picker disclosure */}
              <div className="border-t border-[#1a1a1a] pt-3">
                <button
                  type="button"
                  onClick={() => setPickerOpen(v => !v)}
                  className="text-[12px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1"
                >
                  {pickerOpen ? '▾' : '▸'} Or pick someone not in the suggestions
                </button>
                {pickerOpen && (
                  <div className="mt-3 space-y-3 p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                    <div className="flex items-center gap-1 p-1 rounded-md bg-[#0a0a0a] border border-[#1f1f1f] w-fit">
                      {(['sales_rep', 'customer', 'prospect'] as const).map(a => (
                        <button
                          key={a}
                          onClick={() => { setAudience(a); setSelectedKey(null); }}
                          className={`h-7 px-3 text-[12px] rounded-[4px] font-medium transition-colors ${
                            audience === a
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161616]'
                          }`}
                        >
                          {a === 'sales_rep' && <Users size={12} className="inline mr-1.5 -mt-0.5" />}
                          {a === 'customer' && <UserCheck size={12} className="inline mr-1.5 -mt-0.5" />}
                          {a === 'prospect' && <UserPlus size={12} className="inline mr-1.5 -mt-0.5" />}
                          {audienceLabel[a]}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-start gap-2">
                      <select
                        value={selectedKey ?? ''}
                        onChange={e => setSelectedKey(e.target.value || null)}
                        className="h-9 flex-1 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 text-[13px] text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <option value="">— Choose a {audienceLabel[audience].slice(0, -1).toLowerCase()} —</option>
                        {targetOptions.map(o => (
                          <option key={o.key} value={o.key}>
                            {o.label}{o.sublabel ? ` — ${o.sublabel}` : ''}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={!selectedKey}
                        onClick={() => setWizardStep(2)}
                        className="h-9 px-3 text-[12.5px] bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
                      >
                        Continue →
                      </Button>
                    </div>
                    {audience === 'prospect' && (
                      <div className="text-[11.5px] text-slate-500">
                        Prospects can be reached by WhatsApp only.
                        <Button variant="link" onClick={() => setNewProspectOpen(v => !v)}
                          className="ml-2 text-[11.5px] text-indigo-400 hover:text-indigo-300">
                          + Add prospect
                        </Button>
                      </div>
                    )}
                    {newProspectOpen && audience === 'prospect' && (
                      <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <Input placeholder="Contact name *" value={newProspect.name}
                            onChange={e => setNewProspect(p => ({ ...p, name: e.target.value }))} />
                          <Input placeholder="Company" value={newProspect.companyName}
                            onChange={e => setNewProspect(p => ({ ...p, companyName: e.target.value }))} />
                          <Input placeholder="Phone *" value={newProspect.phone}
                            onChange={e => setNewProspect(p => ({ ...p, phone: e.target.value }))} />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setNewProspectOpen(false)}
                            className="h-7 px-3 text-[12px] text-slate-400 hover:text-slate-200">
                            Cancel
                          </Button>
                          <Button size="sm" onClick={handleCreateProspect}
                            className="h-7 px-3 text-[12px] bg-indigo-600 hover:bg-indigo-500">
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — Add context ─────────────────────────────── */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              {/* Recipient summary */}
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10.5px] uppercase tracking-wider text-slate-500 mb-1">Recipient</div>
                <div className="text-[13.5px] text-slate-100 font-medium">
                  {selectedTarget?.recipientName ?? '—'}
                </div>
                <div className="text-[11.5px] text-slate-500 mt-0.5">
                  {[selectedTarget?.recipientEmail, selectedTarget?.recipientPhone].filter(Boolean).join(' · ') || 'No contact on file'}
                </div>
              </div>

              {/* Channel */}
              <div>
                <label className="text-[12px] font-medium text-slate-300 block mb-2">Channel</label>
                <div className="flex items-center gap-2">
                  <ChannelPill
                    icon={<Mail size={12} />}
                    label="Email"
                    active={(channel === 'email' || channel === 'both') && audience !== 'prospect'}
                    disabled={audience === 'prospect'}
                    onClick={() => setChannel(c => c === 'email' ? 'both' : c === 'both' ? 'whatsapp' : 'email')}
                  />
                  <ChannelPill
                    icon={<MessageCircle size={12} />}
                    label="WhatsApp"
                    active={channel === 'whatsapp' || channel === 'both' || audience === 'prospect'}
                    onClick={() => {
                      if (audience === 'prospect') return;
                      setChannel(c => c === 'whatsapp' ? 'both' : c === 'both' ? 'email' : 'whatsapp');
                    }}
                  />
                </div>
              </div>

              {/* Intent */}
              <div>
                <label htmlFor="intent" className="text-[12px] font-medium text-slate-300 block mb-2">
                  What should the proposal say?
                  <span className="ml-2 text-[10.5px] font-normal normal-case text-slate-500">
                    Pre-filled from purchase history when picked from a suggestion. Edit freely.
                  </span>
                </label>
                <textarea
                  id="intent"
                  rows={8}
                  value={intent}
                  onChange={e => setIntent(e.target.value)}
                  placeholder="e.g. Introduce our Q3 LDPE grades at 5% below current FOB Santos, emphasize 30-day lead time and consolidated container option."
                  className="w-full rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>

              {/* Footer actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-[#1a1a1a]">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setWizardStep(1)}
                  className="h-8 px-3 text-[12.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  ← Back
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !selectedTarget || !intent.trim()}
                  onClick={() => (autoAckSeen ? handleDraft('auto') : setConfirmAuto(true))}
                  className="h-8 px-3 text-[12.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  Auto-send
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !selectedTarget || !intent.trim()}
                  loading={busy}
                  onClick={() => handleDraft('review')}
                  className="h-8 px-3 text-[12.5px] bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500"
                >
                  <Sparkles size={13} className="mr-1.5" /> Generate draft
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 — Done ─────────────────────────────────────── */}
          {wizardStep === 3 && (
            <div className="text-center py-6 space-y-3">
              <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 items-center justify-center">
                <CheckCircle2 size={22} className="text-emerald-400" />
              </div>
              <div className="text-[15px] text-slate-100 font-medium">Draft created</div>
              <div className="text-[12.5px] text-slate-500 max-w-md mx-auto">
                The proposal is ready in <span className="text-slate-300">Recent proposals</span> below.
                Open it to review the AI-written email, approve, and send.
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={resetWizard}
                  className="h-8 px-3 text-[12.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  Draft another
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    document.getElementById('recent-proposals')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="h-8 px-3 text-[12.5px] bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  Review draft ↓
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Recent proposals ──────────────────────────────────── */}
      <div id="recent-proposals" className="mb-5">

        {/* ── Queue ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Recent proposals</CardTitle>
            <Badge variant="neutral" dot>{proposals.length}</Badge>
          </CardHeader>
          <CardBody className="space-y-3 max-h-[680px] overflow-auto">
            {proposalLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : proposals.length === 0 ? (
              <EmptyState
                title="No proposals yet"
                description="Pick a customer above and click Generate draft to start."
              />
            ) : (
              proposals.map(p => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onApproveAndSend={() => handleApproveAndSend(p)}
                  onDismiss={() => handleDismiss(p)}
                />
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmAuto}
        onOpenChange={setConfirmAuto}
        title="Auto-send without review?"
        tone="neutral"
        confirmLabel="Yes, auto-send"
        description="The agent will draft and immediately dispatch without showing you the text first. You can always fall back to 'Draft for review' instead."
        onConfirm={() => {
          setAutoAckSeen(true);
          setConfirmAuto(false);
          void handleDraft('auto');
        }}
      />
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────

const ChannelPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, active, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`h-7 px-2.5 inline-flex items-center gap-1.5 text-[11.5px] rounded-md border transition-colors ${
      disabled
        ? 'bg-[#0a0a0a] text-slate-600 border-[#1f1f1f] cursor-not-allowed'
        : active
        ? 'bg-indigo-600/15 text-indigo-300 border-indigo-500/40'
        : 'bg-[#0f0f0f] text-slate-400 border-[#1f1f1f] hover:bg-[#161616]'
    }`}
  >
    {icon}{label}
  </button>
);

const StepIndicator: React.FC<{ current: 1 | 2 | 3 }> = ({ current }) => {
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: 'Pick' },
    { n: 2, label: 'Context' },
    { n: 3, label: 'Done' },
  ];
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div
            className={
              s.n === current
                ? 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 font-medium'
                : s.n < current
                ? 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                : 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#0f0f0f] text-slate-500 border border-[#1f1f1f]'
            }
          >
            <span className="font-mono tabular-nums">{s.n}</span>
            <span className="uppercase tracking-wider">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <span className={s.n < current ? 'text-emerald-500' : 'text-slate-700'}>→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const ProposalRow: React.FC<{
  proposal: AiSalesProposal;
  onApproveAndSend: () => void;
  onDismiss: () => void;
}> = ({ proposal, onApproveAndSend, onDismiss }) => {
  // Auto-expand actionable proposals so the AI-written draft is
  // immediately visible — the most common need after step 3. Sent /
  // dismissed rows collapse to keep the queue scannable.
  const canAct = proposal.status === 'pending_approval' || proposal.status === 'draft' || proposal.status === 'failed';
  const [open, setOpen] = useState(canAct);
  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={statusTone[proposal.status] ?? 'neutral'}>
              {statusLabel[proposal.status] ?? proposal.status}
            </Badge>
            <Badge variant="neutral">{proposal.channel}</Badge>
            <span className="text-[11px] text-slate-500">{new Date(proposal.createdAt).toLocaleString()}</span>
          </div>
          <div className="text-[13px] font-medium text-slate-100 truncate">
            {proposal.recipientName}
          </div>
          <div className="text-[11.5px] text-slate-500 truncate">
            {proposal.subject ?? proposal.intent}
          </div>
        </div>
        <Bot size={14} className="text-indigo-400 mt-1 shrink-0" />
      </div>

      <button
        onClick={() => setOpen(v => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-slate-400 hover:text-slate-200"
      >
        <span className="inline-block w-2.5 text-center">{open ? '▾' : '▸'}</span>
        {open ? 'Hide draft' : 'Show draft'}
      </button>

      {open && (
        <div className="mt-2 p-2.5 rounded border border-[#1f1f1f] bg-[#0a0a0a] text-[12px] text-slate-300 whitespace-pre-wrap max-h-52 overflow-auto">
          {proposal.body ?? '(empty)'}
          {proposal.whatsappPreview && (
            <>
              <div className="mt-2 pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 uppercase tracking-wider">WhatsApp version</div>
              <div>{proposal.whatsappPreview}</div>
            </>
          )}
          {proposal.errorMessage && (
            <div className="mt-2 pt-2 border-t border-red-500/30 text-[11px] text-red-400">
              Error: {proposal.errorMessage}
            </div>
          )}
        </div>
      )}

      {canAct && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            onClick={onApproveAndSend}
            className="h-7 px-2.5 text-[11.5px] bg-emerald-600 hover:bg-emerald-500"
          >
            <CheckCircle2 size={12} className="mr-1" />
            {proposal.status === 'failed' ? 'Retry send' : 'Approve & send'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="h-7 px-2.5 text-[11.5px] text-slate-400 hover:text-slate-200"
          >
            <XCircle size={12} className="mr-1" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────

async function fetchCompany(companyId: string) {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
  return (data as any) ?? undefined;
}

export default AiSalesV2;
