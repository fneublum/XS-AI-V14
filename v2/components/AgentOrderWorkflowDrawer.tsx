// Agent Sales Orders — tabbed workflow drawer (6 stages).
//
// Proposal → Offer → Proforma → Invoiced → Unpaid commission → Paid commission.
//
// Table map (all reads/writes stay inside the commission_* family —
// sales_orders and invoices are NOT used):
//   - Proposal / Offer / Paid commission → commission_sales_orders (master)
//   - Proforma                           → commissions_proformas (per-order rows)
//   - Invoiced                           → commission_customer_invoices (per-order rows)
//   - Unpaid commission                  → writes back to commission_sales_orders
//                                          (commissionInvoice{Number,Date,PdfUrl})
//                                          and uploads a PDF to the
//                                          `commission-invoices` storage bucket.
//
// The master `status` column drives the pipeline stage — each tab's
// save action bumps it to the stage it just completed.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, FileSignature, FileCheck, Receipt, HandCoins,
  Sparkles, Mail, Eye, Download, Loader2, Check, Plus,
  CheckCircle2, ExternalLink, Trash2, Pencil, Languages,
} from 'lucide-react';
import {
  Drawer, Button, Badge, EmptyState, FormField, Label, Input,
} from '../primitives';
import { cn } from '../primitives/utils';
import { useToast } from '../primitives/Toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';
import { AiUploadModal } from './AiUploadModal';
import { SupabaseSelectField } from './SupabaseSelectField';
import { formatMoney } from '../lib/formatMoney';
import { formatDate } from '../lib/formatDate';
import {
  stageLabel, type CommissionType,
  calcCommissionAmount, commissionTypeLabel,
} from '../lib/agentPipelineStage';
import type { AgentLineItem, AgentOrderRow } from '../queries/useAgentSalesOrders';
import { PROPOSAL_PROMPT, normalizeProposal, parseProposalXlsx, type ProposalDraft } from '../lib/agentProposalSpec';
import { CUSTOMER_INV_PROMPT, type CustomerInvoiceDraft } from '../lib/agentInvoiceSpec';
import { generateCommissionInvoicePdf, pdfToBlob } from '../services/pdf/commissionInvoicePdf';
import { generateAgentOfferPdf } from '../services/pdf/agentOfferPdf';
import { translateDescriptions } from '../services/agentTranslation';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { usePaymentTerms } from '../queries/usePaymentTerms';
import { usePorts } from '../queries/usePorts';

type TabId =
  | 'proposal'
  | 'offer'
  | 'proforma'
  | 'invoiced'
  | 'unpaid_commission'
  | 'paid_commission';

interface TabSpec {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  done: (r: AgentOrderRow) => boolean;
}

const STAGE_RANK: Record<string, number> = {
  PROPOSAL:           0,
  OFFER:              1,
  PROFORMA:           2,
  INVOICED:           3,
  UNPAID_COMMISSION:  4,
  PAID_COMMISSION:    5,
};

const isAtOrBeyond = (r: AgentOrderRow, target: string): boolean =>
  (STAGE_RANK[r.stage] ?? 0) >= (STAGE_RANK[target] ?? 0);

const TABS: TabSpec[] = [
  // Display labels are flipped from the internal IDs — internal
  // 'proposal' (supplier-incoming) is shown as "Offer", and internal
  // 'offer' (our outgoing customer document) is shown as "Proposal".
  { id: 'proposal',          label: 'Offer',             icon: FileText,      done: r => isAtOrBeyond(r, 'OFFER') || r.items.length > 0 || !!r.originalDocumentUrl },
  { id: 'offer',             label: 'Proposal',          icon: FileSignature, done: r => isAtOrBeyond(r, 'PROFORMA') || r.hasOffer },
  { id: 'proforma',          label: 'Proforma',          icon: FileCheck,     done: r => isAtOrBeyond(r, 'INVOICED') || r.hasProforma },
  { id: 'invoiced',          label: 'Invoiced',          icon: Receipt,       done: r => isAtOrBeyond(r, 'UNPAID_COMMISSION') || r.hasCustomerInvoice },
  { id: 'unpaid_commission', label: 'Unpaid commission', icon: HandCoins,     done: r => isAtOrBeyond(r, 'PAID_COMMISSION') || !!r.commissionInvoicePdfUrl },
  { id: 'paid_commission',   label: 'Paid commission',   icon: CheckCircle2,  done: r => r.stage === 'PAID_COMMISSION' },
];

interface Props {
  order: AgentOrderRow | null;
  onOpenChange: (open: boolean) => void;
}

// Map the order's current pipeline stage to its drawer tab so opening
// an invoiced row lands on the Invoiced tab instead of always Proposal.
const STAGE_TO_TAB: Record<string, TabId> = {
  PROPOSAL:          'proposal',
  OFFER:             'offer',
  PROFORMA:          'proforma',
  INVOICED:          'invoiced',
  UNPAID_COMMISSION: 'unpaid_commission',
  PAID_COMMISSION:   'paid_commission',
};

export const AgentOrderWorkflowDrawer: React.FC<Props> = ({ order, onOpenChange }) => {
  const [tab, setTab] = useState<TabId>('proposal');

  useEffect(() => {
    if (order?.id) setTab(STAGE_TO_TAB[order.stage] ?? 'proposal');
  }, [order?.id, order?.stage]);

  return (
    <Drawer
      open={!!order}
      onOpenChange={onOpenChange}
      title={order ? `${order.orderNumber} · ${order.customerName}` : 'Agent Sales Order'}
      description={order
        ? `${stageLabel[order.stage]} · Seller: ${order.sellerName} · ${formatMoney(order.orderTotal)}`
        : undefined}
      widthClass="w-[min(96vw,860px)]"
    >
      {order && (
        <div className="space-y-4">
          <TabBar tabs={TABS} active={tab} onSelect={setTab} order={order} />

          <div className="min-h-[320px]">
            {tab === 'proposal'          && <ProposalTab         order={order} />}
            {tab === 'offer'             && <OfferTab            order={order} />}
            {tab === 'proforma'          && <ProformaTab         order={order} />}
            {tab === 'invoiced'          && <InvoicedTab         order={order} />}
            {tab === 'unpaid_commission' && <UnpaidCommissionTab order={order} />}
            {tab === 'paid_commission'   && <PaidCommissionTab   order={order} />}
          </div>
        </div>
      )}
    </Drawer>
  );
};

// ── Chrome ──────────────────────────────────────────────────────

const TabBar: React.FC<{
  tabs: TabSpec[];
  active: TabId;
  order: AgentOrderRow;
  onSelect: (id: TabId) => void;
}> = ({ tabs, active, order, onSelect }) => (
  <div className="flex items-center gap-1 overflow-x-auto border-b border-[#1f1f1f] -mx-1 px-1">
    {tabs.map(t => {
      const Icon = t.icon;
      const done = t.done(order);
      const isActive = active === t.id;
      return (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-2 text-[12px] whitespace-nowrap border-b-2 transition-colors',
            isActive
              ? 'border-indigo-500 text-slate-100'
              : 'border-transparent text-slate-500 hover:text-slate-200',
          )}
        >
          <Icon size={12} className={cn(done && !isActive ? 'text-emerald-500' : '')} />
          {t.label}
          {done && !isActive && <Check size={10} className="text-emerald-500" />}
        </button>
      );
    })}
  </div>
);

// ── Shared helpers ──────────────────────────────────────────────

const AGENT_INV_BUCKET = 'commission-invoices';

// Standard Incoterms 2020 — there's no master table, so this is the
// canonical static list used by every dropdown in the drawer.
const INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'] as const;
const UNIT_OPTIONS = ['Lbs', 'Kgs', 'MT', 'Bags', 'Bales', 'Pcs', 'Sets'] as const;

// Coerce whatever the OCR / supplier wrote into the canonical option
// the <select> can render — matches case-insensitively and normalizes
// common spelling variants (KG → Kgs, LB → Lbs, MTON → MT, etc).
export function normalizeUnit(raw: string | undefined | null): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Lbs';
  const u = s.toLowerCase();
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return 'Lbs';
  if (u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilos' || u === 'kilogram' || u === 'kilograms') return 'Kgs';
  if (u === 'mt' || u === 'mton' || u === 'tonne' || u === 'tonnes' || u === 'ton' || u === 'tons' || u === 'metric ton' || u === 'metric tons') return 'MT';
  if (u === 'bag' || u === 'bags') return 'Bags';
  if (u === 'bale' || u === 'bales') return 'Bales';
  if (u === 'pc' || u === 'pcs' || u === 'piece' || u === 'pieces') return 'Pcs';
  if (u === 'set' || u === 'sets') return 'Sets';
  // Title-case any other token so it at least renders cleanly even if
  // it doesn't match a canonical option.
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const StaticSelect: React.FC<{
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}> = ({ value, options, onChange, placeholder, mono }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={cn(
      'w-full h-8 text-[12.5px] bg-[#111111] border border-[#1f1f1f] text-slate-200',
      'rounded px-2 outline-none focus-visible:border-indigo-500',
      mono && 'font-mono',
    )}
  >
    <option value="">{placeholder ?? '—'}</option>
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);

function useCsoUpdate() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; patch: Record<string, unknown> }>({
    mutationFn: async ({ id, patch }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['commissions'] });
    },
  });
}

function useInvalidateAgent() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
    void qc.invalidateQueries({ queryKey: ['commissions_proformas_for_order'] });
    void qc.invalidateQueries({ queryKey: ['commission_customer_invoices_for_order'] });
  };
}

// ── Tab: Proposal ───────────────────────────────────────────────

// Resolve buyer's country from the customers table by name match.
function useBuyerCountry(customerName: string): string | null {
  const customers = useCustomers();
  return useMemo(() => {
    const needle = (customerName ?? '').trim().toLowerCase();
    if (!needle) return null;
    const match = (customers.data ?? []).find(
      c => (c.name ?? '').trim().toLowerCase() === needle,
    );
    const country = (match?.country ?? '').trim();
    return country || null;
  }, [customers.data, customerName]);
}

// Translation handlers for the Proposal line items table. Persists
// translations into each item's `customerDescription` field, debounces
// auto-translate when the buyer is picked, and exposes per-row /
// bulk handlers for the table UI.
function useProposalTranslation(
  form: EditableOrderFormState,
  setForm: (f: EditableOrderFormState) => void,
  customerName: string,
) {
  const toast = useToast();
  const targetCountry = useBuyerCountry(customerName);
  const [translatingRows, setTranslatingRows] = useState<Set<number>>(() => new Set());
  const [translatingAll, setTranslatingAll] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const translateRow = async (i: number) => {
    if (!targetCountry) return;
    const it = formRef.current.items[i];
    const desc = (it?.description || it?.productName || '').trim();
    if (!desc) return;
    setTranslatingRows(prev => { const n = new Set(prev); n.add(i); return n; });
    try {
      const [translated] = await translateDescriptions([desc], targetCountry);
      if (translated) {
        const cur = formRef.current;
        const nextItems = cur.items.map((row, idx) =>
          idx === i ? { ...row, customerDescription: translated } : row,
        );
        setForm({ ...cur, items: nextItems });
      } else {
        toast.push({ kind: 'warning', title: 'Translation unavailable',
          description: 'Sign in or try again — Gemini returned no result.' });
      }
    } finally {
      setTranslatingRows(prev => { const n = new Set(prev); n.delete(i); return n; });
    }
  };

  const translateAll = async () => {
    if (!targetCountry) return;
    const cur = formRef.current;
    const targets: Array<{ idx: number; desc: string }> = [];
    cur.items.forEach((it, idx) => {
      const desc = (it.description || it.productName || '').trim();
      if (desc) targets.push({ idx, desc });
    });
    if (targets.length === 0) return;
    setTranslatingAll(true);
    try {
      const translations = await translateDescriptions(targets.map(t => t.desc), targetCountry);
      if (translations.length === 0) {
        toast.push({ kind: 'warning', title: 'Translation unavailable',
          description: 'Sign in or try again — Gemini returned no result.' });
        return;
      }
      const map = new Map<number, string>();
      targets.forEach((t, k) => { if (translations[k]) map.set(t.idx, translations[k]); });
      const latest = formRef.current;
      const nextItems = latest.items.map((row, idx) =>
        map.has(idx) ? { ...row, customerDescription: map.get(idx)! } : row,
      );
      setForm({ ...latest, items: nextItems });
    } finally {
      setTranslatingAll(false);
    }
  };

  // Auto-translate items missing customerDescription whenever the
  // buyer changes (debounced 1s). Skips silently when no country is
  // resolvable so the user isn't blocked.
  const lastCountryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetCountry) return;
    if (lastCountryRef.current === targetCountry) return;
    lastCountryRef.current = targetCountry;
    const t = setTimeout(() => {
      const cur = formRef.current;
      const targets: Array<{ idx: number; desc: string }> = [];
      cur.items.forEach((it, idx) => {
        if (it.customerDescription) return;
        const desc = (it.description || it.productName || '').trim();
        if (desc) targets.push({ idx, desc });
      });
      if (targets.length === 0) return;
      setTranslatingAll(true);
      void translateDescriptions(targets.map(t2 => t2.desc), targetCountry)
        .then(translations => {
          if (translations.length === 0) return;
          const map = new Map<number, string>();
          targets.forEach((t2, k) => { if (translations[k]) map.set(t2.idx, translations[k]); });
          const latest = formRef.current;
          const nextItems = latest.items.map((row, idx) =>
            map.has(idx) ? { ...row, customerDescription: map.get(idx)! } : row,
          );
          setForm({ ...latest, items: nextItems });
        })
        .finally(() => setTranslatingAll(false));
    }, 1000);
    return () => clearTimeout(t);
  }, [targetCountry, setForm]);

  return { targetCountry, translateRow, translateAll, translatingRows, translatingAll };
}

// Read-only summary of a Proposal stage row. The proposal IS the
// supplier's document — by design the user cannot edit it here. To
// make pricing changes / translate / send to the customer, click
// "Prepare Offer" on the list page (or use the Offer tab once the
// row has advanced).
const ProposalTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const Field: React.FC<{ label: string; children: React.ReactNode; mono?: boolean }> = ({ label, children, mono }) => (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className={cn('text-[12.5px] text-slate-200', mono && 'font-mono')}>{children}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">Supplier offer — read-only</div>
          <div className="text-[12.5px] text-slate-400">
            This is the original document received from the supplier. Click
            <strong> Prepare Proposal </strong> on the list to make pricing /
            translation edits in the Proposal tab.
          </div>
        </div>
        <Badge variant={order.items.length > 0 ? 'success' : 'neutral'} dot>
          {order.items.length > 0 ? `${order.items.length} items` : 'Empty'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3">
        <Field label="Seller">{order.sellerName || '—'}</Field>
        <Field label="Customer">{order.customerName || '—'}</Field>
        <Field label="Incoterm" mono>{order.incoterm || '—'}</Field>
        <Field label="Payment terms">{order.paymentTerms || '—'}</Field>
        <Field label="POD" mono>{order.pod || '—'}</Field>
        <Field label="Delivery date" mono>{order.deliveryDate || '—'}</Field>
      </div>

      {order.items.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">
            Line items ({order.items.length})
          </div>
          <div className="rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f]">
            <div className="grid grid-cols-[1fr_90px_60px_110px_110px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              <div>Description</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Unit</div>
              <div className="text-right">Unit price</div>
              <div className="text-right">Total</div>
            </div>
            {order.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_60px_110px_110px] gap-2 px-2 py-1.5 text-[11.5px] items-center">
                <div className="text-slate-200 truncate" title={it.description ?? it.productName ?? ''}>
                  {it.description || it.productName || '—'}
                </div>
                <div className="text-slate-300 font-mono tabular-nums text-right">{(it.quantity ?? 0).toLocaleString('en-US')}</div>
                <div className="text-slate-400 font-mono text-right">{it.unit ?? 'Lbs'}</div>
                <div className="text-slate-300 font-mono tabular-nums text-right">{formatMoney(it.unitPrice ?? 0)}</div>
                <div className="text-slate-100 font-mono tabular-nums text-right">{formatMoney(it.total ?? 0)}</div>
              </div>
            ))}
            <div className="px-2 py-1.5 text-[12px] text-right">
              <span className="text-slate-500 mr-2">Total</span>
              <span className="text-slate-100 font-mono tabular-nums font-semibold">{formatMoney(order.orderTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {order.originalDocumentUrl && (
        <div className="pt-1">
          <a href={order.originalDocumentUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] rounded-md border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            <ExternalLink size={12} /> View original document
          </a>
        </div>
      )}
    </div>
  );
};

// ── Tab: Offer ──────────────────────────────────────────────────
// Editable form over commission_sales_orders — updates items, prices,
// payment terms, incoterm. Download / email a nicely-formatted PDF.
// "Confirm offer" bumps the master row status to OFFER.

const OfferTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const toast = useToast();
  const update = useCsoUpdate();
  const invalidate = useInvalidateAgent();

  const [form, setForm] = useEditableOrder(order);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const translation = useProposalTranslation(form, setForm, form.customerName);

  const patch = buildPatchFromForm(form);
  const totalAmount = patch.orderTotal as number;

  const saveForm = async (nextStatus: string, successLabel: string) => {
    await update.mutateAsync({
      id: order.id,
      patch: { ...patch, status: nextStatus },
    });
    invalidate();
    toast.push({ kind: 'success', title: successLabel });
  };

  const docNumber = `OFF-${order.orderNumber}`;
  const docDate = new Date().toISOString().slice(0, 10);

  const previewPdf = () => {
    const doc = generateAgentOfferPdf({
      order: { ...order, ...patch, items: form.items } as AgentOrderRow,
      kind: 'OFFER', docNumber, docDate,
    });
    window.open(URL.createObjectURL(doc.output('blob')), '_blank');
  };

  const downloadPdf = () => {
    const doc = generateAgentOfferPdf({
      order: { ...order, ...patch, items: form.items } as AgentOrderRow,
      kind: 'OFFER', docNumber, docDate,
    });
    doc.save(`${docNumber}.pdf`);
  };

  const emailOffer = () => {
    setEmailDraft({
      to: '',
      subject: `Proposal ${docNumber} — ${order.customerName}`,
      body: [
        `Dear ${order.customerName},`,
        '',
        `Please find our proposal ${docNumber} attached. Total: ${formatMoney(totalAmount)}`
        + ` under ${form.incoterm || 'standard'} incoterms, ${form.paymentTerms || 'standard payment terms'}.`,
        '',
        'We look forward to your feedback.',
      ].join('\n'),
      contextLabel: `Proposal · ${order.orderNumber}`,
    });
    // Auto-mark sent when the user opens the email composer from the
    // Offer tab — only flips a SAVED row, never overwrites APPROVED /
    // REJECTED.
    const s = (order.status ?? '').toUpperCase();
    if (s === '' || s === 'OFFER' || s === 'OFFER_SAVED') {
      void update.mutateAsync({ id: order.id, patch: { status: 'OFFER_SENT' } })
        .then(() => invalidate())
        .catch(() => { /* best-effort */ });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">Proposal to customer</div>
          <div className="text-[12.5px] text-slate-400">
            Prepare the proposal we send to <strong>{order.customerName}</strong> — edit
            products, volumes, prices, terms. Send by email or download the PDF.
            Save writes directly to <code>commission_sales_orders</code>.
          </div>
        </div>
        {(() => {
          const s = (order.status ?? '').toUpperCase();
          if (s === 'OFFER_APPROVED') return <Badge variant="success" dot>Approved</Badge>;
          if (s === 'OFFER_REJECTED') return <Badge variant="warning" dot>Rejected</Badge>;
          if (s === 'OFFER_SENT')     return <Badge variant="info"    dot>Sent</Badge>;
          if (s === 'OFFER_SAVED' || s === 'OFFER') return <Badge variant="neutral" dot>Saved</Badge>;
          return <Badge variant="neutral" dot>Draft</Badge>;
        })()}
      </div>

      <EditableOrderForm form={form} setForm={setForm} totalAmount={totalAmount}
        sellerSource={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }}
        translation={translation} />

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button size="sm"
          onClick={() => saveForm('OFFER_SAVED', 'Proposal saved').catch((e) =>
            toast.push({ kind: 'error', title: 'Save failed', description: e.message }))}
          disabled={update.isPending} loading={update.isPending}
          className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px]">
          <CheckCircle2 size={12} className="mr-1.5" /> Save proposal
        </Button>
        <Button size="sm" onClick={previewPdf}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Eye size={12} className="mr-1.5" /> Preview PDF
        </Button>
        <Button size="sm" onClick={downloadPdf}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Download size={12} className="mr-1.5" /> Download
        </Button>
        <Button size="sm" onClick={emailOffer}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Mail size={12} className="mr-1.5" /> Email
        </Button>
      </div>

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={o => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </div>
  );
};

// ── Tab: Proforma ───────────────────────────────────────────────
// Same editable form as the Offer tab PLUS commission rate capture.
// Finalize saves the master row (status = PROFORMA) AND inserts a
// row into `commissions_proformas` for document history.

interface StoredProforma {
  id: string;
  pi_number: string | null;
  pi_date: string | null;
  seller: string | null;
  buyer: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  pod: string | null;
  items: unknown;
  total: number | null;
  status: string | null;
  created_at: string | null;
}

export const COMMISSION_TYPES: CommissionType[] = ['PERCENT', 'PER_LBS', 'PER_KGS'];

const ProformaTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const toast = useToast();
  const update = useCsoUpdate();
  const invalidate = useInvalidateAgent();

  const [form, setForm] = useEditableOrder(order);
  const [cType, setCType] = useState<CommissionType>(order.commissionType ?? 'PERCENT');
  const [cRate, setCRate] = useState(order.commissionRate == null ? '' : String(order.commissionRate));

  useEffect(() => {
    setCType(order.commissionType ?? 'PERCENT');
    setCRate(order.commissionRate == null ? '' : String(order.commissionRate));
  }, [order.id]);

  const patch = buildPatchFromForm(form);
  const totalAmount = patch.orderTotal as number;
  const totalQty    = patch.totalQuantity as number;

  const rateNum = cRate.trim() === '' ? null : Number(cRate);
  const rateValid = rateNum === null || (Number.isFinite(rateNum) && rateNum >= 0);
  const itemUnit = form.items.find(i => (i.unit ?? '').trim())?.unit ?? null;
  const commissionAmount = rateNum !== null
    ? calcCommissionAmount(cType, rateNum, totalAmount, totalQty, itemUnit)
    : order.commissionAmount;

  const stored = useQuery<StoredProforma[]>({
    queryKey: ['commissions_proformas_for_order', order.id],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('commissions_proformas')
        .select('id, pi_number, pi_date, seller, buyer, incoterm, payment_terms, pod, items, total, status, created_at')
        .eq('contract_id', order.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data as StoredProforma[] | null) ?? [];
    },
  });

  const finalize = useMutation<void, Error>({
    mutationFn: async () => {
      if (!rateValid || rateNum === null) throw new Error('Commission rate is required.');
      const supabase = getSupabaseClient();

      await update.mutateAsync({
        id: order.id,
        patch: {
          ...patch,
          commissionRate:   rateNum,
          commissionType:   cType,
          commissionAmount,
          status:           'PROFORMA',
        },
      });

      const piId = `PF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const piNumber = `PI-${order.orderNumber}`;
      const { error } = await supabase.from('commissions_proformas').insert({
        id: piId,
        company_id:   order.companyId ?? '',
        pi_number:    piNumber,
        pi_date:      new Date().toISOString().slice(0, 10),
        seller:       form.sellerName,
        buyer:        form.customerName,
        incoterm:     form.incoterm,
        payment_terms: form.paymentTerms,
        pod:          form.pod,
        items:        form.items,
        total:        totalAmount,
        contract_id:  order.id,
        status:       'FINAL',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidate();
      toast.push({ kind: 'success', title: 'Proforma finalized' });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Finalize failed', description: e.message }),
  });

  const docNumber = `PI-${order.orderNumber}`;
  const docDate = new Date().toISOString().slice(0, 10);
  const previewPdf = () => {
    const doc = generateAgentOfferPdf({
      order: { ...order, ...patch, items: form.items } as AgentOrderRow,
      kind: 'PROFORMA', docNumber, docDate,
    });
    window.open(URL.createObjectURL(doc.output('blob')), '_blank');
  };
  const downloadPdf = () => {
    const doc = generateAgentOfferPdf({
      order: { ...order, ...patch, items: form.items } as AgentOrderRow,
      kind: 'PROFORMA', docNumber, docDate,
    });
    doc.save(`${docNumber}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">Proforma (sales contract)</div>
          <div className="text-[12.5px] text-slate-400">
            Customer accepted the offer — finalize the proforma and capture our
            <strong> commission rate</strong>. Saves to <code>commissions_proformas</code>
            plus bumps the master row status to <code>PROFORMA</code>.
          </div>
        </div>
        <Badge variant={order.hasProforma ? 'success' : 'warning'} dot>
          {order.hasProforma ? 'Final' : 'Awaiting'}
        </Badge>
      </div>

      <EditableOrderForm form={form} setForm={setForm} totalAmount={totalAmount}
        sellerSource={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />

      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Order total</div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{formatMoney(totalAmount)}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total quantity (Lbs)</div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{totalQty.toLocaleString('en-US')}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Commission</div>
          <div className="font-mono tabular-nums text-[16px] text-emerald-400 mt-1">{formatMoney(commissionAmount)}</div>
        </div>
      </div>

      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Commission basis</Label>
        <Pills options={COMMISSION_TYPES} value={cType}
          onChange={(v) => setCType(v as CommissionType)}
          labels={commissionTypeLabel} />
      </FormField>

      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
          Rate ({commissionTypeLabel[cType]})
        </Label>
        <Input type="number" min={0} step={0.01}
          value={cRate} onChange={e => setCRate(e.target.value)}
          invalid={!rateValid}
          className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums max-w-[200px]" />
      </FormField>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button size="sm" onClick={() => finalize.mutate()}
          disabled={!rateValid || rateNum === null || finalize.isPending}
          loading={finalize.isPending}
          className="bg-emerald-600 hover:bg-emerald-500 h-8 px-3 text-[12.5px]">
          <CheckCircle2 size={12} className="mr-1.5" /> Finalize proforma
        </Button>
        <Button size="sm" onClick={previewPdf}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Eye size={12} className="mr-1.5" /> Preview PDF
        </Button>
        <Button size="sm" onClick={downloadPdf}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Download size={12} className="mr-1.5" /> Download
        </Button>
      </div>

      <StoredProformaList stored={stored} order={order} />
    </div>
  );
};

// Manual editor for a single commissions_proformas row. Used by both
// the "+ Add proforma" button (insert) and the per-row Edit pencil
// (update). Lives inline inside the list so we don't have to nest
// another drawer/modal.
interface ProformaInlineFormProps {
  initial: Partial<StoredProforma>;
  onCancel: () => void;
  onSubmit: (values: Partial<StoredProforma>) => Promise<void>;
  saving: boolean;
}
const ProformaInlineForm: React.FC<ProformaInlineFormProps> = ({ initial, onCancel, onSubmit, saving }) => {
  const [piNumber, setPiNumber] = useState<string>(initial.pi_number ?? '');
  const [piDate, setPiDate]     = useState<string>((initial.pi_date ?? '').slice(0, 10));
  const [seller, setSeller]     = useState<string>(initial.seller ?? '');
  const [buyer, setBuyer]       = useState<string>(initial.buyer ?? '');
  const [incoterm, setIncoterm] = useState<string>(initial.incoterm ?? '');
  const [paymentTerms, setPaymentTerms] = useState<string>(initial.payment_terms ?? '');
  const [pod, setPod]           = useState<string>(initial.pod ?? '');
  const [total, setTotal]       = useState<string>(initial.total == null ? '' : String(initial.total));
  const [status, setStatus]     = useState<string>(initial.status ?? 'FINAL');

  const submit = async () => {
    const t = total.trim() === '' ? null : Number(total);
    await onSubmit({
      pi_number:     piNumber.trim() || null,
      pi_date:       piDate || null,
      seller:        seller.trim() || null,
      buyer:         buyer.trim() || null,
      incoterm:      incoterm.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      pod:           pod.trim() || null,
      total:         Number.isFinite(t as number) ? (t as number) : null,
      status:        status.trim().toUpperCase() || 'FINAL',
    });
  };

  const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

  return (
    <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">PI #</Label>
          <Input value={piNumber} onChange={e => setPiNumber(e.target.value)} className={inputCls + ' font-mono'} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">PI date</Label>
          <Input type="date" value={piDate} onChange={e => setPiDate(e.target.value)} className={inputCls + ' font-mono'} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Seller</Label>
          <Input value={seller} onChange={e => setSeller(e.target.value)} className={inputCls} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Buyer</Label>
          <Input value={buyer} onChange={e => setBuyer(e.target.value)} className={inputCls} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Incoterm</Label>
          <Input value={incoterm} onChange={e => setIncoterm(e.target.value)} className={inputCls + ' font-mono'} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Payment terms</Label>
          <Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className={inputCls} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">POD</Label>
          <Input value={pod} onChange={e => setPod(e.target.value)} className={inputCls} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Total</Label>
          <Input type="number" min={0} step={0.01} value={total} onChange={e => setTotal(e.target.value)}
            className={inputCls + ' font-mono tabular-nums'} />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Status</Label>
          <Input value={status} onChange={e => setStatus(e.target.value)} className={inputCls + ' font-mono'} />
        </FormField>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={onCancel}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-7 px-3 text-[12px]">
          Cancel
        </Button>
        <Button size="sm" onClick={submit} loading={saving} disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 h-7 px-3 text-[12px] text-white">
          <CheckCircle2 size={12} className="mr-1.5" /> Save
        </Button>
      </div>
    </div>
  );
};

const StoredProformaList: React.FC<{
  stored: ReturnType<typeof useQuery<StoredProforma[]>>;
  order: AgentOrderRow;
}> = ({ stored, order }) => {
  const toast = useToast();
  const invalidate = useInvalidateAgent();
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateMut = useMutation<void, Error, { id: string; values: Partial<StoredProforma> }>({
    mutationFn: async ({ id, values }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('commissions_proformas').update(values).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setEditingId(null);
      stored.refetch();
      invalidate();
      toast.push({ kind: 'success', title: 'Proforma updated' });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Update failed', description: e.message }),
  });

  const deleteMut = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('commissions_proformas').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      stored.refetch();
      invalidate();
      toast.push({ kind: 'success', title: 'Proforma deleted' });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Delete failed', description: e.message }),
  });

  return (
    <div className="pt-4 border-t border-[#1f1f1f] space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
        Saved proforma rows ({stored.data?.length ?? 0})
      </div>
      {stored.isLoading ? (
        <div className="text-[12px] text-slate-500 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : stored.error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
          Could not load: {stored.error.message}
        </div>
      ) : (stored.data ?? []).length === 0 ? (
        <div className="text-[12px] text-slate-500">No proforma rows yet.</div>
      ) : (
        <div className="space-y-3">
          {(stored.data ?? []).map(p => {
            const items = parseAnyItems(p.items);
            const statusTone: 'success' | 'warning' = (p.status ?? '').toUpperCase() === 'FINAL' ? 'success' : 'warning';
            const isEditing = editingId === p.id;
            return (
              <div key={p.id} className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f1f1f]">
                  <Badge variant={statusTone} dot>{p.status ?? 'DRAFT'}</Badge>
                  <span className="font-mono text-[12px] text-slate-100">{p.pi_number ?? '—'}</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {formatDate(p.pi_date ?? p.created_at ?? '')}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="font-mono tabular-nums text-[12px] text-slate-100">
                      {formatMoney(p.total ?? 0)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingId(isEditing ? null : p.id)}
                      title={isEditing ? 'Cancel edit' : 'Edit'}
                      aria-label="Edit proforma"
                      className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-[#1a1a1a]"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete proforma ${p.pi_number ?? p.id}?`)) {
                          deleteMut.mutate(p.id);
                        }
                      }}
                      disabled={deleteMut.isPending}
                      title="Delete"
                      aria-label="Delete proforma"
                      className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {isEditing ? (
                  <div className="p-2">
                    <ProformaInlineForm
                      initial={p}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(v) => updateMut.mutateAsync({ id: p.id, values: v })}
                      saving={updateMut.isPending}
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 p-2">
                      <Readonly label="Seller"   value={p.seller ?? '—'} />
                      <Readonly label="Buyer"    value={p.buyer ?? '—'} />
                      <Readonly label="Incoterm" value={p.incoterm ?? '—'} mono />
                      <Readonly label="Payment"  value={p.payment_terms ?? '—'} />
                      <Readonly label="POD"      value={p.pod ?? '—'} />
                    </div>
                    {items.length > 0 && (
                      <div className="border-t border-[#1f1f1f]">
                        <ItemsTable items={items} />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Tab: Invoiced ───────────────────────────────────────────────
// Lists ALL commission_customer_invoices rows linked to this order
// (by soNumber) plus a Link picker for orphan rows. Each row shows
// header fields + line items + the commission it contributes.

interface StoredCustomerInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  sellerName: string | null;
  customerName: string | null;
  bookingNumber: string | null;
  soNumber: string | null;
  plNumber: string | null;
  incoterm: string | null;
  paymentTerms: string | null;
  pol: string | null;
  pod: string | null;
  items: unknown;
  totalAmount: number | null;
  currency: string | null;
  status: string | null;
  createdAt: string | null;
}

const InvoiceCard: React.FC<{
  inv: StoredCustomerInvoice;
  cType: CommissionType;
  rate: number;
  onPeekPdf: () => void;
}> = ({ inv, cType, rate, onPeekPdf }) => {
  const items = parseAnyItems(inv.items);
  const invQty = items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
  const invUnit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
  const commission = calcCommissionAmount(cType, rate, inv.totalAmount ?? 0, invQty, invUnit);
  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f1f1f]">
        <Badge variant="info" dot>{inv.status ?? 'ON FILE'}</Badge>
        <span className="font-mono text-[12px] text-slate-100">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</span>
        <span className="text-[11px] text-slate-500 font-mono">
          {formatDate(inv.invoiceDate ?? inv.createdAt ?? '')}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono tabular-nums text-[12px] text-slate-100">
            {formatMoney(inv.totalAmount ?? 0, inv.currency ?? 'USD')}
          </span>
          <span className="font-mono tabular-nums text-[12px] text-emerald-400">
            +{formatMoney(commission)}
          </span>
          <button type="button" onClick={onPeekPdf}
            className="text-slate-400 hover:text-slate-100 p-1" title="View stored PDF">
            <Eye size={12} />
          </button>
        </span>
      </div>
      <InvoiceCardEditor inv={inv} />
      {items.length > 0 && (
        <div className="border-t border-[#1f1f1f]">
          <EditableInvoiceItems inv={inv} items={items} />
        </div>
      )}
    </div>
  );
};

// Per-line-item qty + unit editor for one commission_customer_invoices
// row. Saves the entire `items` JSONB on each change since it lives
// as a single column. `total` is recomputed from qty × unitPrice so
// it stays consistent.
const EditableInvoiceItems: React.FC<{
  inv: StoredCustomerInvoice;
  items: AgentLineItem[];
}> = ({ inv, items }) => {
  const toast = useToast();
  const qc = useQueryClient();

  const persist = useMutation<void, Error, AgentLineItem[]>({
    mutationFn: async (next) => {
      const supabase = getSupabaseClient();
      // Re-derive totalAmount so the displayed roll-up stays in sync.
      const totalAmount = next.reduce(
        (s, it) => s + (Number(it.total ?? it.amount) || 0), 0,
      );
      const { error } = await supabase
        .from('commission_customer_invoices')
        .update({ items: next, totalAmount })
        .eq('id', inv.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commission_customer_invoices_for_order'] });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }),
  });

  const LBS_PER_KG_LOCAL = 2.20462;

  const patchItem = (idx: number, patch: Partial<AgentLineItem>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const merged = { ...it, ...patch };
      const q = Number(merged.quantity) || 0;
      const p = Number(merged.unitPrice) || 0;
      merged.total = q * p;
      // Cross-fill Kg ↔ Lb so both columns stay in sync regardless of
      // which one the user just touched.
      if (Object.prototype.hasOwnProperty.call(patch, 'grossLbs')) {
        const v = Number(merged.grossLbs);
        merged.grossKg = Number.isFinite(v) && v > 0 ? v / LBS_PER_KG_LOCAL : undefined;
      } else if (Object.prototype.hasOwnProperty.call(patch, 'grossKg')) {
        const v = Number(merged.grossKg);
        merged.grossLbs = Number.isFinite(v) && v > 0 ? v * LBS_PER_KG_LOCAL : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'netLbs')) {
        const v = Number(merged.netLbs);
        merged.netKg = Number.isFinite(v) && v > 0 ? v / LBS_PER_KG_LOCAL : undefined;
      } else if (Object.prototype.hasOwnProperty.call(patch, 'netKg')) {
        const v = Number(merged.netKg);
        merged.netLbs = Number.isFinite(v) && v > 0 ? v * LBS_PER_KG_LOCAL : undefined;
      }
      return merged;
    });
    persist.mutate(next);
  };

  return (
    <div>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-2">
        Line items ({items.length})
        <span className="text-[10px] text-slate-600 normal-case tracking-normal">— Qty is priced units; Bales is the package count</span>
      </div>
      <div className="grid grid-cols-[1fr_90px_90px_55px_70px_60px_80px_85px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        <div>Description</div>
        <div className="text-right">Net Weight</div>
        <div className="text-right">Gross Weight</div>
        <div className="text-right">Unit</div>
        <div className="text-right">Bales</div>
        <div className="text-right">Vol unit</div>
        <div className="text-right">Unit price</div>
        <div className="text-right">Total</div>
      </div>
      <div className="divide-y divide-[#1f1f1f]">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_90px_55px_70px_60px_80px_85px] gap-2 px-3 py-2 text-[12px] items-center">
            <div className="text-slate-200 truncate" title={it.description ?? it.productName ?? ''}>
              {it.description || it.productName || '—'}
              {(it.netKg || it.grossKg) && (
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {it.netKg ? `Net ${formatInvoiceQty(it.netKg)} kg` : ''}
                  {it.netKg && it.grossKg ? ' · ' : ''}
                  {it.grossKg ? `Gross ${formatInvoiceQty(it.grossKg)} kg` : ''}
                </div>
              )}
            </div>
            <InvoiceItemQty
              value={Number(it.quantity) || 0}
              onCommit={(q) => patchItem(i, { quantity: q })}
              disabled={persist.isPending}
            />
            <InvoiceItemQty
              value={Number(it.grossLbs) || 0}
              onCommit={(v) => patchItem(i, { grossLbs: v || undefined })}
              disabled={persist.isPending}
            />
            <PricedUnitSelect
              value={normalizeUnit(it.unit)}
              onChange={(u) => patchItem(i, { unit: u })}
              disabled={persist.isPending}
            />
            <InvoiceItemQty
              value={Number(it.volumeCount) || 0}
              onCommit={(v) => patchItem(i, { volumeCount: v || undefined })}
              disabled={persist.isPending}
            />
            <VolumeUnitSelect
              value={it.volumeUnit ?? 'Bales'}
              onChange={(u) => patchItem(i, { volumeUnit: u })}
              disabled={persist.isPending}
            />
            <div className="text-slate-400 font-mono tabular-nums text-right">
              {formatMoney(it.unitPrice ?? 0)}
            </div>
            <div className="text-slate-100 font-mono tabular-nums text-right">
              {formatMoney(it.total ?? it.amount ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const PRICED_UNIT_OPTIONS = ['Lbs', 'Kgs', 'MT'] as const;
const VOLUME_UNIT_OPTIONS = ['Bales', 'Bags', 'Pcs', 'Sets', 'Drums'] as const;

const PricedUnitSelect: React.FC<{
  value: string; onChange: (u: string) => void; disabled: boolean;
}> = ({ value, onChange, disabled }) => (
  <select
    value={value || 'Lbs'}
    onChange={e => onChange(e.target.value)}
    onClick={e => e.stopPropagation()}
    disabled={disabled}
    className="h-7 text-[12px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-300 font-mono px-1.5 outline-none focus:border-indigo-500 cursor-pointer"
  >
    {!PRICED_UNIT_OPTIONS.includes(value as typeof PRICED_UNIT_OPTIONS[number]) && value && (
      <option value={value}>{value}</option>
    )}
    {PRICED_UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
  </select>
);

const VolumeUnitSelect: React.FC<{
  value: string; onChange: (u: string) => void; disabled: boolean;
}> = ({ value, onChange, disabled }) => (
  <select
    value={value || 'Bales'}
    onChange={e => onChange(e.target.value)}
    onClick={e => e.stopPropagation()}
    disabled={disabled}
    className="h-7 text-[12px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-300 font-mono px-1.5 outline-none focus:border-indigo-500 cursor-pointer"
  >
    {!VOLUME_UNIT_OPTIONS.includes(value as typeof VOLUME_UNIT_OPTIONS[number]) && value && (
      <option value={value}>{value}</option>
    )}
    {VOLUME_UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
  </select>
);

const INVOICE_UNIT_OPTIONS = ['Lbs', 'Kgs', 'MT', 'Bags', 'Bales', 'Pcs', 'Sets'] as const;

const formatInvoiceQty = (n: number): string =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '0.0';

const InvoiceItemQty: React.FC<{
  value: number;
  onCommit: (n: number) => void;
  disabled: boolean;
}> = ({ value, onCommit, disabled }) => {
  const [draft, setDraft] = useState<string>(() => formatInvoiceQty(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(formatInvoiceQty(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const cleaned = draft.replace(/[,\s]/g, '').trim();
    const n = cleaned === '' ? 0 : Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(formatInvoiceQty(value));
      return;
    }
    setDraft(formatInvoiceQty(n));
    if (n !== value) onCommit(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setEditing(true); setDraft(value === 0 ? '' : String(value)); }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onClick={e => e.stopPropagation()}
      disabled={disabled}
      className="h-7 text-[12px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 font-mono tabular-nums text-right px-1.5 outline-none focus:border-indigo-500"
    />
  );
};

const InvoiceItemUnit: React.FC<{
  value: string;
  onChange: (u: string) => void;
  disabled: boolean;
}> = ({ value, onChange, disabled }) => (
  <select
    value={value || ''}
    onChange={e => { const v = e.target.value; if (v && v !== value) onChange(v); }}
    onClick={e => e.stopPropagation()}
    disabled={disabled}
    className="h-7 text-[12px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-300 font-mono px-1.5 outline-none focus:border-indigo-500 cursor-pointer"
  >
    {!value && <option value="">—</option>}
    {value && !INVOICE_UNIT_OPTIONS.includes(value as typeof INVOICE_UNIT_OPTIONS[number]) && (
      <option value={value}>{value}</option>
    )}
    {INVOICE_UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
  </select>
);

// Always-on editor for one commission_customer_invoices row. Same
// dropdowns as the rest of the drawer (customers/payment_terms/ports);
// Save patches the row.
const InvoiceCardEditor: React.FC<{
  inv: StoredCustomerInvoice;
}> = ({ inv }) => {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState({
    invoiceNumber: inv.invoiceNumber ?? '',
    invoiceDate:   inv.invoiceDate ?? '',
    sellerName:    inv.sellerName ?? '',
    customerName:  inv.customerName ?? '',
    incoterm:      inv.incoterm ?? '',
    paymentTerms:  inv.paymentTerms ?? '',
    pol:           inv.pol ?? '',
    pod:           inv.pod ?? '',
    bookingNumber: inv.bookingNumber ?? '',
  });
  const update = useMutation<void, Error, void>({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_customer_invoices')
        .update({
          invoiceNumber: draft.invoiceNumber || null,
          invoiceDate:   draft.invoiceDate || null,
          sellerName:    draft.sellerName || null,
          customerName:  draft.customerName || null,
          incoterm:      draft.incoterm || null,
          paymentTerms:  draft.paymentTerms || null,
          pol:           draft.pol || null,
          pod:           draft.pod || null,
          bookingNumber: draft.bookingNumber || null,
        })
        .eq('id', inv.id);
      if (error) throw new Error(error.message);

      // Propagate the shared header fields to the parent
      // commission_sales_orders row so the Agent Sales Orders list
      // and the order-level columns stay in sync. Matches by
      // soNumber → orderNumber. Only writes order-relevant fields —
      // pol / bookingNumber stay on the invoice row only.
      if (inv.soNumber) {
        const { error: parentErr } = await supabase
          .from('commission_sales_orders')
          .update({
            sellerName:   draft.sellerName || null,
            customerName: draft.customerName || null,
            incoterm:     draft.incoterm || null,
            paymentTerms: draft.paymentTerms || null,
            pod:          draft.pod || null,
          })
          .eq('orderNumber', inv.soNumber);
        if (parentErr) throw new Error(parentErr.message);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commission_customer_invoices_for_order'] });
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      toast.push({ kind: 'success', title: 'Invoice saved', description: draft.invoiceNumber });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }),
  });

  return (
    <div className="grid grid-cols-2 gap-2 p-2">
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Invoice #</Label>
        <Input value={draft.invoiceNumber}
          onChange={e => setDraft({ ...draft, invoiceNumber: e.target.value })}
          className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Invoice date</Label>
        <Input type="date" value={(draft.invoiceDate ?? '').slice(0, 10)}
          onChange={e => setDraft({ ...draft, invoiceDate: e.target.value })}
          className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Seller</Label>
        <SupabaseSelectField value={draft.sellerName} onPick={(v) => setDraft({ ...draft, sellerName: v })}
          placeholder="Pick seller…" allowFreeText showResolvedLabel
          source={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Customer</Label>
        <SupabaseSelectField value={draft.customerName} onPick={(v) => setDraft({ ...draft, customerName: v })}
          placeholder="Pick customer…" allowFreeText showResolvedLabel
          source={{ table: 'customers', valueColumn: 'name', secondaryColumn: 'nickname', scopeByCompany: true }} />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</Label>
        <StaticSelect value={draft.incoterm} options={INCOTERMS} mono
          onChange={v => setDraft({ ...draft, incoterm: v })} placeholder="Incoterm…" />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Payment terms</Label>
        <SupabaseSelectField value={draft.paymentTerms} onPick={(v) => setDraft({ ...draft, paymentTerms: v })}
          placeholder="Pick terms…" allowFreeText
          source={{ table: 'payment_terms', valueColumn: 'code', labelColumn: 'description', scopeByCompany: true }} />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POL</Label>
        <SupabaseSelectField value={draft.pol} onPick={(v) => setDraft({ ...draft, pol: v })}
          placeholder="Pick port…" allowFreeText mono
          source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
      </FormField>
      <FormField>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POD</Label>
        <SupabaseSelectField value={draft.pod} onPick={(v) => setDraft({ ...draft, pod: v })}
          placeholder="Pick port…" allowFreeText mono
          source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
      </FormField>
      <FormField className="col-span-2">
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Booking #</Label>
        <Input value={draft.bookingNumber}
          onChange={e => setDraft({ ...draft, bookingNumber: e.target.value })}
          className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
      </FormField>
      <div className="col-span-2 flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => update.mutate()}
          disabled={update.isPending} loading={update.isPending}
          className="bg-indigo-600 hover:bg-indigo-500 h-7 px-2 text-[11.5px]">
          <CheckCircle2 size={11} className="mr-1" /> Save invoice
        </Button>
      </div>
    </div>
  );
};

function useOrderInvoices(order: AgentOrderRow) {
  return useQuery<StoredCustomerInvoice[]>({
    queryKey: ['commission_customer_invoices_for_order', order.id, order.orderNumber],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('commission_customer_invoices')
        .select('id, invoiceNumber, invoiceDate, sellerName, customerName, bookingNumber, soNumber, plNumber, incoterm, paymentTerms, pol, pod, items, totalAmount, currency, status, createdAt')
        .eq('soNumber', order.orderNumber)
        .order('createdAt', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data as StoredCustomerInvoice[] | null) ?? [];
    },
  });
}

const InvoicedTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const toast = useToast();
  const update = useCsoUpdate();
  const invalidate = useInvalidateAgent();
  const invoices = useOrderInvoices(order);
  const [uploadOpen, setUploadOpen] = useState(false);

  const peekPdf = useMutation<string | null, Error, string>({
    mutationFn: async (invoiceId) => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('commission_customer_invoices')
        .select('originalDocument').eq('id', invoiceId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as any)?.originalDocument ?? null;
    },
    onSuccess: (doc) => {
      if (typeof doc === 'string' && doc) {
        window.open(doc, '_blank');
      } else {
        toast.push({ kind: 'warning', title: 'No stored PDF on this invoice' });
      }
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Could not open PDF', description: e.message }),
  });

  // Local editor for commission basis + rate. Source of truth is the
  // master commission_sales_orders row, so seed from there and patch
  // it on Save. After save, the parent query refetches and the new
  // values flow back through `order`.
  const [cType, setCType] = useState<CommissionType>(order.commissionType ?? 'PERCENT');
  const [cRateStr, setCRateStr] = useState(order.commissionRate == null ? '' : String(order.commissionRate));
  useEffect(() => {
    setCType(order.commissionType ?? 'PERCENT');
    setCRateStr(order.commissionRate == null ? '' : String(order.commissionRate));
  }, [order.id, order.commissionType, order.commissionRate]);
  const rate = Number(cRateStr) || 0;
  const totalCommission = (invoices.data ?? []).reduce((s, inv) => {
    const invItems = parseAnyItems(inv.items);
    const invQty = invItems.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
    const invUnit = invItems.find(it => (it.unit ?? '').trim())?.unit ?? null;
    return s + calcCommissionAmount(cType, rate, inv.totalAmount ?? 0, invQty, invUnit);
  }, 0);
  const totalInvoiced = (invoices.data ?? []).reduce((s, inv) => s + (inv.totalAmount ?? 0), 0);
  const saveCommission = useMutation<void, Error, void>({
    // Persist `commissionAmount` alongside rate + type so the Agent
    // Sales Orders list column can read it without recomputing from
    // joined invoices. Without this the master row's
    // `commissionAmount` stays at 0 and the list shows "—" even after
    // a successful save.
    mutationFn: () => update.mutateAsync({
      id: order.id,
      patch: {
        commissionRate: rate || null,
        commissionType: cType,
        commissionAmount: totalCommission,
      },
    }),
    onSuccess: () => {
      invalidate();
      toast.push({ kind: 'success', title: 'Commission saved' });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">Final commercial invoices</div>
          <div className="text-[12.5px] text-slate-400">
            Once the supplier ships, they send the commercial invoice. Upload each PDF —
            Gemini extracts the fields, saves the source to <code>commission_customer_invoices</code>
            (and its <code>originalDocument</code>), and commission is calculated using the rate set on the Proforma tab.
          </div>
        </div>
        <Badge variant={(invoices.data ?? []).length > 0 ? 'success' : 'warning'} dot>
          {(invoices.data ?? []).length > 0 ? `${(invoices.data ?? []).length} on file` : 'Missing'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Invoiced total</div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{formatMoney(totalInvoiced)}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">
            Rate ({cType === 'PERCENT' ? '%' : cType === 'PER_LBS' ? '$/Lb' : '$/Kg'})
          </div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{rate || '—'}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Commission to receive</div>
          <div className="font-mono tabular-nums text-[16px] text-emerald-400 mt-1">{formatMoney(totalCommission)}</div>
        </div>
      </div>

      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Commission</div>
        <div className="flex items-end gap-3 flex-wrap">
          <FormField>
            <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Basis</Label>
            <Pills options={COMMISSION_TYPES} value={cType}
              onChange={(v) => setCType(v as CommissionType)}
              labels={commissionTypeLabel} />
          </FormField>
          <FormField>
            <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
              Rate ({commissionTypeLabel[cType]})
            </Label>
            <Input type="number" min={0} step={0.01}
              value={cRateStr} onChange={e => setCRateStr(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums max-w-[160px]" />
          </FormField>
          <Button size="sm" onClick={() => saveCommission.mutate()}
            disabled={saveCommission.isPending} loading={saveCommission.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px]">
            <CheckCircle2 size={12} className="mr-1.5" /> Save commission
          </Button>
        </div>
      </div>

      {invoices.isLoading ? (
        <div className="text-[12px] text-slate-500 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading invoices…
        </div>
      ) : invoices.error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
          Could not load: {invoices.error.message}
        </div>
      ) : (invoices.data ?? []).length === 0 ? (
        <EmptyState
          title="No invoices linked yet"
          description="OCR a commercial invoice PDF, or link an existing row below."
        />
      ) : (
        <div className="space-y-3">
          {(invoices.data ?? []).map(inv => (
            <InvoiceCard key={inv.id} inv={inv} cType={cType} rate={rate}
              onPeekPdf={() => peekPdf.mutate(inv.id)} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setUploadOpen(true)}
          className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-8 px-3 text-[12.5px]">
          <Sparkles size={12} className="mr-1.5" />
          Add / OCR commercial invoice
        </Button>
        {(invoices.data ?? []).length > 0 && order.stage === 'INVOICED' && (
          <Button size="sm"
            onClick={() => update.mutateAsync({ id: order.id, patch: { status: 'INVOICED' } })
              .then(() => { invalidate(); toast.push({ kind: 'success', title: 'Stage marked INVOICED' }); })
              .catch((e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }))}
            className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
            Confirm stage
          </Button>
        )}
      </div>

      <LinkExistingInvoice order={order} />

      {uploadOpen && (
        <AiUploadModal<CustomerInvoiceDraft>
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          config={{
            title: `Add commercial invoice · ${order.orderNumber}`,
            description: 'Drop the commercial invoice PDF. Gemini extracts the fields; the PDF is saved alongside the order.',
            emptyDraft: () => ({
              invoiceNumber: `CCI-${Date.now().toString().slice(-6)}`,
              invoiceDate:   new Date().toISOString().slice(0, 10),
              sellerName:    order.sellerName,
              customerName:  order.customerName,
              incoterm:      order.incoterm ?? '',
              paymentTerms:  order.paymentTerms ?? '',
              pol:           '',
              pod:           order.pod ?? '',
              bookingNumber: '',
              items: order.items.map(it => ({
                description: it.customerDescription || it.description || it.productName || '',
                quantity:    Number(it.quantity) || 0,
                unit:        it.unit ?? 'Lbs',
                unitPrice:   Number(it.unitPrice) || 0,
                total:       Number(it.total) || 0,
              })),
              originalDocument: null,
            }),
            fromExtracted: (d) => d,
            extractSpec: {
              prompt: CUSTOMER_INV_PROMPT,
              normalize: (parsed: Record<string, unknown>): CustomerInvoiceDraft => {
                const str = (k: string): string => {
                  const v = parsed[k];
                  return typeof v === 'string' ? v.trim() : '';
                };
                const rawItems = Array.isArray(parsed.items) ? parsed.items as any[] : [];
                return {
                  invoiceNumber: str('invoiceNumber') || `CCI-${Date.now().toString().slice(-6)}`,
                  invoiceDate:   str('invoiceDate') || new Date().toISOString().slice(0, 10),
                  sellerName:    str('sellerName') || order.sellerName,
                  customerName:  str('customerName') || order.customerName,
                  incoterm:      str('incoterm').toUpperCase(),
                  paymentTerms:  str('paymentTerms'),
                  pol:           str('pol'),
                  pod:           str('pod'),
                  bookingNumber: str('bookingNumber'),
                  originalDocument: null,
                  items: rawItems.map(it => ({
                    description: String(it?.description ?? ''),
                    quantity:    Number(it?.quantity) || 0,
                    unit:        String(it?.unit ?? 'Lbs'),
                    unitPrice:   Number(it?.unitPrice) || 0,
                    total:       Number(it?.total) || (Number(it?.quantity ?? 0) * Number(it?.unitPrice ?? 0)),
                  })),
                };
              },
            },
            extractSummary: d => [d.invoiceNumber, d.customerName, `${d.items.length} items`].filter(Boolean).join(' · '),
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Invoice #</Label>
                  <Input value={d.invoiceNumber}
                    onChange={e => setD({ ...d, invoiceNumber: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Invoice date</Label>
                  <Input type="date" value={d.invoiceDate.slice(0, 10)}
                    onChange={e => setD({ ...d, invoiceDate: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POL</Label>
                  <SupabaseSelectField
                    value={d.pol} onPick={(v) => setD({ ...d, pol: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name',
                              secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POD</Label>
                  <SupabaseSelectField
                    value={d.pod} onPick={(v) => setD({ ...d, pod: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name',
                              secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</Label>
                  <StaticSelect value={d.incoterm} options={INCOTERMS} mono
                    onChange={v => setD({ ...d, incoterm: v })} placeholder="Incoterm…" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Booking #</Label>
                  <Input value={d.bookingNumber}
                    onChange={e => setD({ ...d, bookingNumber: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
                </FormField>
              </div>
            ),
            save: async (d) => {
              const supabase = getSupabaseClient();
              const totalAmount = d.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
              const id = `CCI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
              const payload = {
                id,
                companyId: order.companyId,
                createdAt: new Date().toISOString(),
                invoiceNumber: d.invoiceNumber,
                invoiceDate:   d.invoiceDate,
                sellerName:    d.sellerName,
                customerName:  d.customerName,
                bookingNumber: d.bookingNumber,
                soNumber:      order.orderNumber,
                plNumber:      null,
                incoterm:      d.incoterm,
                paymentTerms:  d.paymentTerms,
                pol:           d.pol,
                pod:           d.pod,
                items:         JSON.stringify(d.items),
                totalAmount,
                currency:      'USD',
                originalDocument: d.originalDocument,
                status:        'AVAILABLE',
              };
              const { error } = await supabase
                .from('commission_customer_invoices')
                .insert(payload);
              if (error) throw new Error(error.message);
              await supabase.from('commission_sales_orders')
                .update({
                  invoiceStatus: 'INVOICED',
                  invoiceNumber: d.invoiceNumber,
                  status:        'INVOICED',
                })
                .eq('id', order.id);
              invalidate();
              toast.push({ kind: 'success', title: 'Invoice saved' });
            },
          }}
        />
      )}
    </div>
  );
};

// ── Link an orphan commission_customer_invoices row ──

interface UnlinkedInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  sellerName: string | null;
  customerName: string | null;
  soNumber: string | null;
  totalAmount: number | null;
  currency: string | null;
  createdAt: string | null;
}

const LinkExistingInvoice: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const toast = useToast();
  const invalidate = useInvalidateAgent();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string>('');

  const candidates = useQuery<UnlinkedInvoice[]>({
    queryKey: ['commission_customer_invoices_candidates', order.companyId, open],
    enabled: open,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('commission_customer_invoices')
        .select('id, invoiceNumber, invoiceDate, sellerName, customerName, soNumber, totalAmount, currency, createdAt')
        .order('createdAt', { ascending: false, nullsFirst: false })
        .limit(200);
      if (order.companyId) q = q.eq('companyId', order.companyId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as UnlinkedInvoice[] | null) ?? [];
    },
  });

  const link = useMutation<void, Error, string>({
    mutationFn: async (invoiceId) => {
      const supabase = getSupabaseClient();
      const picked = (candidates.data ?? []).find(c => c.id === invoiceId);
      if (!picked) throw new Error('Invoice not found');
      const { error: updErr } = await supabase
        .from('commission_customer_invoices')
        .update({ soNumber: order.orderNumber })
        .eq('id', invoiceId);
      if (updErr) throw new Error(updErr.message);
      await supabase.from('commission_sales_orders')
        .update({
          invoiceStatus: 'INVOICED',
          invoiceNumber: picked.invoiceNumber ?? order.invoiceNumber,
          status: 'INVOICED',
        })
        .eq('id', order.id);
    },
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setPick('');
      toast.push({ kind: 'success', title: 'Invoice linked' });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Link failed', description: e.message }),
  });

  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Link existing invoice</div>
          <div className="text-[12px] text-slate-400 mt-0.5">
            Attach a row in <code>commission_customer_invoices</code> to this order by overwriting its <code>soNumber</code>.
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(v => !v)}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          {open ? 'Cancel' : 'Browse invoices'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {candidates.isLoading ? (
            <div className="text-[12px] text-slate-500 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : candidates.error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[12px] text-red-300">
              {candidates.error.message}
            </div>
          ) : (candidates.data ?? []).length === 0 ? (
            <div className="text-[12px] text-slate-500">No candidate invoices.</div>
          ) : (
            <>
              <select
                value={pick}
                onChange={e => setPick(e.target.value)}
                className="h-9 w-full rounded-md border border-[#1f1f1f] bg-[#111111] px-3 text-[12.5px] text-slate-200"
              >
                <option value="">— Choose an invoice —</option>
                {(candidates.data ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {(c.invoiceNumber ?? c.id.slice(0, 8))}
                    {c.customerName ? ` · ${c.customerName}` : ''}
                    {c.totalAmount != null ? ` · ${formatMoney(c.totalAmount, c.currency ?? 'USD')}` : ''}
                    {c.soNumber ? ` · current SO ${c.soNumber}` : ''}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => pick && link.mutate(pick)}
                disabled={!pick || link.isPending} loading={link.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px]">
                Link invoice
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Tab: Unpaid Commission ──────────────────────────────────────
// Multi-select invoices → generate a single commission invoice PDF
// rolling up the selected totals. Upload to storage, save metadata
// on commission_sales_orders, bump status to UNPAID_COMMISSION.
// "Mark paid" flips to PAID_COMMISSION.

const UnpaidCommissionTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const toast = useToast();
  const update = useCsoUpdate();
  const invalidate = useInvalidateAgent();
  const invoices = useOrderInvoices(order);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [invNumber, setInvNumber] = useState(order.commissionInvoiceNumber ?? `CI-${order.orderNumber}`);
  const [invDate, setInvDate]     = useState(order.commissionInvoiceDate ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInvNumber(order.commissionInvoiceNumber ?? `CI-${order.orderNumber}`);
    setInvDate(order.commissionInvoiceDate ?? new Date().toISOString().slice(0, 10));
    // default-select all linked invoices
    const next: Record<string, boolean> = {};
    for (const inv of invoices.data ?? []) next[inv.id] = true;
    setSelected(next);
  }, [order.id, invoices.data?.length]);

  const rate = order.commissionRate ?? 0;
  const cType = order.commissionType ?? 'PERCENT';
  const hasRate = rate > 0;

  const selectedInvoices = (invoices.data ?? []).filter(inv => selected[inv.id]);
  const aggregateTotal = selectedInvoices.reduce((s, inv) => s + (inv.totalAmount ?? 0), 0);
  let aggregateUnit: string | null = null;
  const aggregateQty = selectedInvoices.reduce((s, inv) => {
    const items = parseAnyItems(inv.items);
    if (!aggregateUnit) aggregateUnit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
    return s + items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
  }, 0);
  const commissionAmount = calcCommissionAmount(cType, rate, aggregateTotal, aggregateQty, aggregateUnit);

  const customerPaid = (order.paymentStatus ?? '').toUpperCase() === 'PAID';

  const buildRollupOrder = (): AgentOrderRow => ({
    ...order,
    orderTotal: aggregateTotal,
    totalQuantity: aggregateQty,
    invoiceNumber: selectedInvoices.map(i => i.invoiceNumber).filter(Boolean).join(', ') || order.invoiceNumber,
  });

  const previewPdf = () => {
    const doc = generateCommissionInvoicePdf({
      order: buildRollupOrder(),
      invoiceNumber: invNumber,
      invoiceDate: invDate,
    });
    window.open(URL.createObjectURL(doc.output('blob')), '_blank');
  };

  const generateAndUpload = async () => {
    if (!hasRate) {
      toast.push({ kind: 'warning', title: 'Set commission rate on Proforma tab first' });
      return;
    }
    if (selectedInvoices.length === 0) {
      toast.push({ kind: 'warning', title: 'Select at least one invoice to include' });
      return;
    }
    if (!invNumber.trim()) {
      toast.push({ kind: 'warning', title: 'Invoice number is required' });
      return;
    }
    setBusy(true);
    try {
      const doc = generateCommissionInvoicePdf({
        order: buildRollupOrder(),
        invoiceNumber: invNumber,
        invoiceDate: invDate,
      });
      const blob = pdfToBlob(doc);
      const path = `${order.id}/${invNumber}.pdf`;
      const supabase = getSupabaseClient();
      const { error: uploadErr } = await supabase.storage
        .from(AGENT_INV_BUCKET)
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);
      const { data: urlData } = supabase.storage
        .from(AGENT_INV_BUCKET).getPublicUrl(path);
      await update.mutateAsync({
        id: order.id,
        patch: {
          commissionInvoiceNumber: invNumber,
          commissionInvoiceDate:   invDate,
          commissionInvoicePdfUrl: urlData.publicUrl,
          commissionAmount,
          status:                  'UNPAID_COMMISSION',
        },
      });
      invalidate();
      toast.push({ kind: 'success', title: 'Commission invoice issued' });
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Could not generate',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const markPaid = () =>
    update.mutateAsync({
      id: order.id,
      patch: {
        commissionPaymentStatus: 'PAID',
        status: 'PAID_COMMISSION',
      },
    })
      .then(() => { invalidate(); toast.push({ kind: 'success', title: 'Commission marked PAID' }); })
      .catch((e) => toast.push({ kind: 'error', title: 'Update failed', description: e.message }));

  const emailDraftFromInvoice = (): EmailDraft => ({
    to: '',
    subject: `Commission invoice ${invNumber} — ${order.orderNumber}`,
    body: [
      `Dear ${order.sellerName},`,
      '',
      `Please find attached our commission invoice ${invNumber} for sales order ${order.orderNumber}.`,
      `Commission due: ${formatMoney(commissionAmount)}.`,
      '',
      'Kindly remit per the agreed terms.',
    ].join('\n'),
    contextLabel: `Commission invoice · ${order.orderNumber}`,
  });
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">
            Commission invoice to seller
          </div>
          <div className="text-[12.5px] text-slate-400">
            Once the customer has paid the commercial invoice, select which invoice(s)
            to bill — we generate a single commission invoice PDF aggregating the totals,
            upload it to the <code>commission-invoices</code> bucket, and set status to
            <code> UNPAID_COMMISSION</code>.
          </div>
        </div>
        <Badge variant={order.commissionInvoicePdfUrl ? 'info' : 'neutral'} dot>
          {order.commissionInvoicePdfUrl ? 'Issued' : 'Not issued'}
        </Badge>
      </div>

      {!hasRate && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-300">
          No commission rate set — configure it on the <strong>Proforma</strong> tab first.
        </div>
      )}

      {!customerPaid && hasRate && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-300 flex items-center justify-between gap-2">
          <span>Customer hasn't paid the commercial invoice yet — mark it paid to issue commission.</span>
          <Button size="sm"
            onClick={() => update.mutateAsync({ id: order.id, patch: { paymentStatus: 'PAID' } })
              .then(() => { invalidate(); toast.push({ kind: 'success', title: 'Customer payment marked' }); })
              .catch((e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }))}
            className="bg-amber-600 hover:bg-amber-500 h-7 px-2.5 text-[11.5px]">
            Mark customer paid
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
          Select invoices to bill ({selectedInvoices.length} of {(invoices.data ?? []).length})
        </div>
        {invoices.isLoading ? (
          <div className="text-[12px] text-slate-500 flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading invoices…
          </div>
        ) : (invoices.data ?? []).length === 0 ? (
          <div className="text-[12px] text-slate-500 p-3 border border-[#1f1f1f] rounded-md bg-[#0f0f0f]">
            No commercial invoices on file. Add them on the <strong>Invoiced</strong> tab first.
          </div>
        ) : (
          <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] divide-y divide-[#1f1f1f]">
            {(invoices.data ?? []).map(inv => {
              const items = parseAnyItems(inv.items);
              const qty = items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
              const unit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
              const commission = calcCommissionAmount(cType, rate, inv.totalAmount ?? 0, qty, unit);
              return (
                <label key={inv.id} className="grid grid-cols-[24px_1fr_140px_110px_120px] gap-3 items-center px-3 py-2 text-[12px] cursor-pointer hover:bg-[#141414]">
                  <input type="checkbox"
                    checked={!!selected[inv.id]}
                    onChange={(e) => setSelected(s => ({ ...s, [inv.id]: e.target.checked }))}
                    className="accent-indigo-500" />
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-slate-100 truncate">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</span>
                    <span className="text-[11px] text-slate-500 truncate">{inv.customerName}</span>
                  </div>
                  <span className="text-slate-500 font-mono tabular-nums text-[11px] text-right">
                    {formatDate(inv.invoiceDate ?? inv.createdAt ?? '')}
                  </span>
                  <span className="text-slate-100 font-mono tabular-nums text-right">
                    {formatMoney(inv.totalAmount ?? 0, inv.currency ?? 'USD')}
                  </span>
                  <span className="text-emerald-400 font-mono tabular-nums text-right">
                    +{formatMoney(commission)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Selected invoiced total</div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{formatMoney(aggregateTotal)}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">
            Rate ({cType === 'PERCENT' ? '%' : cType === 'PER_LBS' ? '$/Lb' : '$/Kg'})
          </div>
          <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{hasRate ? rate : '—'}</div>
        </div>
        <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Commission due</div>
          <div className="font-mono tabular-nums text-[16px] text-emerald-400 mt-1">{formatMoney(commissionAmount)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Our invoice #</Label>
          <Input value={invNumber} onChange={e => setInvNumber(e.target.value)}
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
        </FormField>
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Invoice date</Label>
          <Input type="date" value={invDate.slice(0, 10)}
            onChange={e => setInvDate(e.target.value)}
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={previewPdf}
          disabled={!hasRate || selectedInvoices.length === 0}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Eye size={12} className="mr-1.5" /> Preview PDF
        </Button>
        <Button size="sm" onClick={generateAndUpload}
          disabled={!hasRate || selectedInvoices.length === 0 || busy} loading={busy}
          className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px]">
          <Download size={12} className="mr-1.5" />
          {order.commissionInvoicePdfUrl ? 'Regenerate & upload' : 'Generate & upload'}
        </Button>
        <Button size="sm"
          onClick={() => setEmailDraft(emailDraftFromInvoice())}
          disabled={!order.commissionInvoicePdfUrl}
          className="bg-[#161616] border border-[#1f1f1f] text-slate-100 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
          <Mail size={12} className="mr-1.5" /> Email seller
        </Button>
        {order.commissionInvoicePdfUrl && (
          <a href={order.commissionInvoicePdfUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] rounded-md border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            <ExternalLink size={12} /> Stored PDF
          </a>
        )}
        <Button size="sm" onClick={markPaid}
          disabled={!order.commissionInvoicePdfUrl || order.stage === 'PAID_COMMISSION'}
          className="ml-auto bg-emerald-600 hover:bg-emerald-500 h-8 px-3 text-[12.5px]">
          <CheckCircle2 size={12} className="mr-1.5" /> Mark commission PAID
        </Button>
      </div>

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={o => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </div>
  );
};

// ── Tab: Paid Commission ────────────────────────────────────────
// Read-only archive — commission already paid.

const PaidCommissionTab: React.FC<{ order: AgentOrderRow }> = ({ order }) => {
  const paid = order.stage === 'PAID_COMMISSION';
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1">Commission received</div>
          <div className="text-[12.5px] text-slate-400">
            Archive view — seller has paid our commission. Use <strong>Unpaid commission</strong>
            to re-issue if needed.
          </div>
        </div>
        <Badge variant={paid ? 'success' : 'neutral'} dot>
          {paid ? 'PAID' : 'Not paid yet'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Readonly label="Invoice #"    value={order.commissionInvoiceNumber ?? '—'} mono />
        <Readonly label="Invoice date" value={formatDate(order.commissionInvoiceDate ?? '') ?? '—'} mono />
        <Readonly label="Seller"       value={order.sellerName} />
        <Readonly label="Customer"     value={order.customerName} />
        <Readonly label="Order total"  value={formatMoney(order.orderTotal)} mono />
        <Readonly label="Commission"   value={formatMoney(order.commissionAmount)} mono />
      </div>

      {order.commissionInvoicePdfUrl && (
        <a href={order.commissionInvoicePdfUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] rounded-md border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
          <ExternalLink size={12} /> View stored commission invoice PDF
        </a>
      )}

      {!paid && (
        <div className="text-[12px] text-slate-500">
          Not paid yet — head back to <strong>Unpaid commission</strong> to mark it paid.
        </div>
      )}
    </div>
  );
};

// ── Shared primitives ───────────────────────────────────────────

const Readonly: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="p-2 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{label}</div>
    <div className={cn('text-[13px] text-slate-100 mt-1 truncate', mono && 'font-mono tabular-nums')}>
      {value || '—'}
    </div>
  </div>
);

const ItemsTable: React.FC<{ items: AgentLineItem[] }> = ({ items }) => (
  <div>
    <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">
      Line items ({items.length})
    </div>
    <div className="divide-y divide-[#1f1f1f]">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[1fr_80px_80px_110px] gap-2 px-3 py-2 text-[12px]">
          <div className="text-slate-200 truncate" title={it.description ?? it.productName ?? ''}>
            {it.description || it.productName || '—'}
          </div>
          <div className="text-slate-400 font-mono tabular-nums text-right">
            {(it.quantity ?? 0).toLocaleString('en-US')} {it.unit ?? ''}
          </div>
          <div className="text-slate-400 font-mono tabular-nums text-right">
            {formatMoney(it.unitPrice ?? 0)}
          </div>
          <div className="text-slate-100 font-mono tabular-nums text-right">
            {formatMoney(it.total ?? it.amount ?? 0)}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const Pills = <T extends string>({ options, value, onChange, labels }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(opt => (
      <button key={opt} type="button"
        onClick={() => onChange(opt)}
        className={opt === value
          ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
          : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}
      >
        {labels?.[opt] ?? opt}
      </button>
    ))}
  </div>
);

// ── Editable order form (shared by Offer + Proforma) ──

export interface EditableOrderFormState {
  sellerName: string;
  customerName: string;
  incoterm: string;
  paymentTerms: string;
  pod: string;
  deliveryDate: string;
  items: AgentLineItem[];
}

export function useEditableOrder(order: AgentOrderRow) {
  const [state, setState] = useState<EditableOrderFormState>(() => ({
    sellerName: order.sellerName,
    customerName: order.customerName,
    incoterm: order.incoterm ?? '',
    paymentTerms: order.paymentTerms ?? '',
    pod: order.pod ?? '',
    deliveryDate: order.deliveryDate ?? '',
    items: order.items,
  }));
  useEffect(() => {
    setState({
      sellerName: order.sellerName,
      customerName: order.customerName,
      incoterm: order.incoterm ?? '',
      paymentTerms: order.paymentTerms ?? '',
      pod: order.pod ?? '',
      deliveryDate: order.deliveryDate ?? '',
      items: order.items,
    });
  }, [order.id]);
  return [state, setState] as const;
}

export function buildPatchFromForm(form: EditableOrderFormState): Record<string, unknown> {
  const totalQuantity = form.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const orderTotal    = form.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
  return {
    sellerName:   form.sellerName,
    customerName: form.customerName,
    incoterm:     form.incoterm || null,
    paymentTerms: form.paymentTerms || null,
    pod:          form.pod || null,
    deliveryDate: form.deliveryDate || null,
    items:        form.items,
    totalQuantity,
    orderTotal,
  };
}

export const EditableOrderForm: React.FC<{
  form: EditableOrderFormState;
  setForm: (f: EditableOrderFormState) => void;
  totalAmount: number;
  sellerSource?: React.ComponentProps<typeof SupabaseSelectField>['source'];
  /** Optional translation hooks. When provided the line items table
   *  shows a per-row globe icon + a "Translate all" header button and
   *  surfaces the saved customerDescription beneath each row. */
  translation?: {
    targetCountry: string | null;
    translateRow: (i: number) => Promise<void>;
    translateAll: () => Promise<void>;
    translatingRows: ReadonlySet<number>;
    translatingAll: boolean;
  };
}> = ({ form, setForm, totalAmount, sellerSource, translation }) => {
  // Lookup tables — used to detect when the stored value (probably
  // OCR-derived) doesn't match a canonical row, in which case we
  // surface it as a small "OCR <value>" label above the picker.
  const suppliers   = useSuppliers();
  const customersQ  = useCustomers();
  const paymentTQ   = usePaymentTerms();
  const portsQ      = usePorts();

  const matchesByName = (rows: ReadonlyArray<{ name?: string | null }> | undefined, v: string) => {
    if (!v) return true;
    const needle = v.trim().toLowerCase();
    return !!(rows ?? []).some(r => (r.name ?? '').trim().toLowerCase() === needle);
  };

  // OCR-friendly port matcher: accepts the canonical code, the bare
  // name, "name, country" / "name · country" labels, or — to ride
  // over Portuguese↔English country spelling differences (Brasil vs
  // Brazil) — matches just the first comma-separated segment as a
  // port name.
  const matchPort = (
    rows: ReadonlyArray<{ code?: string | null; name?: string | null; country?: string | null }> | undefined,
    v: string,
  ) => {
    if (!v) return undefined;
    const needle = v.trim().toLowerCase();
    const head = needle.split(',')[0]?.trim() ?? '';
    return (rows ?? []).find(p => {
      const code    = (p.code ?? '').trim().toLowerCase();
      const name    = (p.name ?? '').trim().toLowerCase();
      const country = (p.country ?? '').trim().toLowerCase();
      if (code === needle || name === needle) return true;
      if (name && country) {
        if (`${name}, ${country}` === needle) return true;
        if (`${name} · ${country}` === needle) return true;
      }
      // Fall-through: name matches the first comma-segment of the
      // OCR string (handles "Pecem, Brasil" vs port row Pecem/Brazil).
      if (head && name === head) return true;
      return false;
    });
  };

  // Payment-terms matcher: accepts code OR description.
  const matchPaymentTerm = (
    rows: ReadonlyArray<{ code?: string | null; description?: string | null }> | undefined,
    v: string,
  ) => {
    if (!v) return undefined;
    const needle = v.trim().toLowerCase();
    return (rows ?? []).find(t => {
      const code = (t.code ?? '').trim().toLowerCase();
      const desc = (t.description ?? '').trim().toLowerCase();
      return code === needle || desc === needle;
    });
  };

  const sellerSourceTable = sellerSource?.table === 'suppliers' ? 'suppliers' : 'customers';
  const sellerHasMatch = sellerSourceTable === 'suppliers'
    ? matchesByName(suppliers.data, form.sellerName)
    : matchesByName(customersQ.data, form.sellerName);
  const customerHasMatch = matchesByName(customersQ.data, form.customerName);
  const paymentMatch  = matchPaymentTerm(paymentTQ.data, form.paymentTerms);
  const podMatch      = matchPort(portsQ.data, form.pod);
  const paymentHasMatch  = !form.paymentTerms || !!paymentMatch;
  const podHasMatch      = !form.pod || !!podMatch;

  // Auto-normalize POD / payment-terms to their canonical codes when
  // the stored OCR text matches by name / description. Keeps the
  // picker happy (it resolves by code) and ensures downstream PDFs
  // and emails see the canonical id, not a free-form OCR string.
  // Single auto-normalize effect that handles both POD and payment
  // terms in one setForm call, avoiding the stale-closure race that
  // happens when two separate effects each spread the same `form`
  // snapshot. Functional setForm guarantees we operate on the latest
  // state regardless of render timing.
  const podCanonical     = podMatch?.code ?? null;
  const paymentCanonical = paymentMatch?.code ?? null;
  // 50ms timeout works around a render-timing race where parallel
  // effects (translation auto-fire, etc.) end up batched with this
  // setForm and React drops the update. Delaying lets the render
  // cycle settle before we mutate.
  useEffect(() => {
    if (!podCanonical && !paymentCanonical) return;
    const t = setTimeout(() => {
      setForm(prev => {
        let next = prev;
        if (podCanonical
            && (prev.pod ?? '').trim().toLowerCase() !== podCanonical.trim().toLowerCase()) {
          next = { ...next, pod: podCanonical };
        }
        if (paymentCanonical
            && (prev.paymentTerms ?? '').trim().toLowerCase() !== paymentCanonical.trim().toLowerCase()) {
          next = { ...next, paymentTerms: paymentCanonical };
        }
        return next;
      });
    }, 50);
    return () => clearTimeout(t);
  }, [podCanonical, paymentCanonical, setForm]);

  // Renders the field label with an optional inline OCR-original
  // value to its right. Co-locating both keeps the input row vertically
  // aligned across fields whether or not OCR text is present, while
  // still letting users see what the supplier document said.
  const FieldHead: React.FC<{ label: string; ocrValue?: string }> = ({ label, ocrValue }) => (
    <div className="flex items-baseline gap-2 mb-1 min-h-[14px]">
      <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium shrink-0">{label}</Label>
      {ocrValue && (
        <span
          className="text-[10.5px] text-slate-500 truncate flex-1 min-w-0"
          title={ocrValue}
        >
          <span className="text-[9px] uppercase tracking-wider text-slate-600 mr-1">OCR</span>
          {ocrValue}
        </span>
      )}
    </div>
  );

  const addItem = () => setForm({
    ...form,
    items: [...form.items, {
      productName: '', description: '', customerDescription: '',
      quantity: 0, unit: 'Lbs', unitPrice: 0, total: 0,
    }],
  });
  const removeItem = (i: number) => setForm({
    ...form, items: form.items.filter((_, idx) => idx !== i),
  });
  const patchItem = (i: number, patch: Partial<AgentLineItem>) => {
    const next = form.items.map((it, idx) => {
      if (idx !== i) return it;
      const merged = { ...it, ...patch };
      const q = Number(merged.quantity) || 0;
      const p = Number(merged.unitPrice) || 0;
      merged.total = q * p;
      return merged;
    });
    setForm({ ...form, items: next });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField>
          <FieldHead label="Seller" ocrValue={!sellerHasMatch && form.sellerName ? form.sellerName : undefined} />
          <SupabaseSelectField
            value={form.sellerName}
            onPick={(v) => setForm({ ...form, sellerName: v })}
            placeholder="Pick seller…"
            allowFreeText
            showResolvedLabel
            noMatchRendersEmpty
            source={sellerSource ?? {
              // Sellers are SUPPLIERS in the agent flow. Fallback
              // existed for early plumbing — keeping customers
              // around as the default was a bug.
              table: 'suppliers',
              valueColumn: 'name',
              scopeByCompany: true,
            }}
          />
        </FormField>
        <FormField>
          <FieldHead label="Customer" ocrValue={!customerHasMatch && form.customerName ? form.customerName : undefined} />
          <SupabaseSelectField
            value={form.customerName}
            onPick={(v) => setForm({ ...form, customerName: v })}
            placeholder="Pick customer…"
            allowFreeText
            showResolvedLabel
            noMatchRendersEmpty
            source={{
              table: 'customers',
              valueColumn: 'name',
              secondaryColumn: 'nickname',
              scopeByCompany: true,
            }}
          />
        </FormField>
        <FormField>
          <FieldHead label="Incoterm" />
          <StaticSelect value={form.incoterm} options={INCOTERMS} mono
            onChange={v => setForm({ ...form, incoterm: v })}
            placeholder="Incoterm…" />
        </FormField>
        <FormField>
          <FieldHead label="Payment terms" ocrValue={!paymentHasMatch && form.paymentTerms ? form.paymentTerms : undefined} />
          <SupabaseSelectField
            value={form.paymentTerms}
            onPick={(v) => setForm({ ...form, paymentTerms: v })}
            placeholder="Pick terms…"
            allowFreeText
            showResolvedLabel
            noMatchRendersEmpty
            source={{
              table: 'payment_terms',
              valueColumn: 'code',
              labelColumn: 'description',
              scopeByCompany: true,
            }}
          />
        </FormField>
        <FormField>
          <FieldHead label="POD" ocrValue={!podHasMatch && form.pod ? form.pod : undefined} />
          <SupabaseSelectField
            value={form.pod}
            onPick={(v) => setForm({ ...form, pod: v })}
            placeholder="Pick port…"
            allowFreeText
            showResolvedLabel
            noMatchRendersEmpty
            source={{
              table: 'ports',
              valueColumn: 'code',
              labelColumn: 'name',
              secondaryColumn: 'country',
              scopeByCompany: true,
            }}
          />
        </FormField>
        <FormField>
          <FieldHead label="Delivery date" />
          <Input type="date" value={(form.deliveryDate ?? '').slice(0, 10)}
            onChange={e => setForm({ ...form, deliveryDate: e.target.value })}
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
        </FormField>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1 gap-2">
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
            Line items ({form.items.length})
          </Label>
          <div className="flex items-center gap-1.5">
            {translation && (
              <Button
                size="sm"
                onClick={() => { void translation.translateAll(); }}
                disabled={
                  translation.translatingAll
                  || form.items.length === 0
                  || !translation.targetCountry
                }
                title={translation.targetCountry
                  ? `Translate all to ${translation.targetCountry}`
                  : 'Pick a customer with a country to enable translation'}
                className="h-7 px-2 text-[11px] bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] disabled:opacity-50"
              >
                {translation.translatingAll
                  ? <Loader2 size={10} className="mr-1 animate-spin" />
                  : <Languages size={10} className="mr-1" />}
                Translate all
              </Button>
            )}
            <Button size="sm" onClick={addItem}
              className="h-7 px-2 text-[11px] bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a]">
              <Plus size={10} className="mr-1" /> Add item
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f]">
          <div className={cn(
            'grid gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium',
            translation
              ? 'grid-cols-[1fr_90px_80px_110px_110px_56px]'
              : 'grid-cols-[1fr_90px_80px_110px_110px_28px]',
          )}>
            <div>Product</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Unit</div>
            <div className="text-right">Unit price</div>
            <div className="text-right">Total</div>
            <div></div>
          </div>
          {form.items.map((it, i) => {
            const translating = translation?.translatingRows.has(i) ?? false;
            return (
              <div key={i} className={cn(
                'grid gap-2 px-2 py-1.5 items-start',
                translation
                  ? 'grid-cols-[1fr_90px_80px_110px_110px_56px]'
                  : 'grid-cols-[1fr_90px_80px_110px_110px_28px]',
              )}>
                <div className="space-y-1 min-w-0">
                  {/* OCR / supplier description — read-only. Stored as
                      `description` on the row, untouched by the system
                      product picker below. */}
                  {(it.description || '').trim() && (
                    <div
                      className="text-[11px] text-slate-400 truncate"
                      title={it.description}
                    >
                      <span className="text-[9px] uppercase tracking-wider text-slate-600 mr-1">OCR</span>
                      {it.description}
                    </div>
                  )}
                  {/* System product description — editable picker
                      sourced from `products`. Persists to
                      `productName` so it doesn't overwrite the OCR
                      text. */}
                  <SupabaseSelectField
                    value={it.productName ?? ''}
                    onPick={(v) => patchItem(i, { productName: v })}
                    placeholder="Pick system product…"
                    allowFreeText
                    showResolvedLabel
                    noMatchRendersEmpty
                    source={{
                      table: 'products',
                      valueColumn: 'name',
                      secondaryColumn: 'sku',
                      scopeByCompany: true,
                      // Hide auto-OCR products that haven't been
                      // promoted yet — keeps the dropdown clean.
                      equalsFilter: { isSystemProduct: true },
                    }}
                    onAfterPick={(row) => {
                      // Belt-and-braces: if a row somehow shows up
                      // here without isSystemProduct=true, promote
                      // it. Normally the equalsFilter prevents this,
                      // but free-text matches against full table
                      // could one day surface non-system rows.
                      const id = (row as { id?: string }).id;
                      const flag = (row as { isSystemProduct?: boolean }).isSystemProduct;
                      if (id && flag !== true) {
                        void getSupabaseClient()
                          .from('products')
                          .update({ isSystemProduct: true })
                          .eq('id', id);
                      }
                    }}
                  />
                  {translation && it.customerDescription && (
                    <div className="mt-0.5 text-[11px] text-emerald-300/80 italic truncate" title={it.customerDescription}>
                      {it.customerDescription}
                    </div>
                  )}
                </div>
                <Input type="number" value={it.quantity ?? 0}
                  onChange={e => patchItem(i, { quantity: Number(e.target.value) })}
                  className="h-7 text-[11.5px] bg-[#0a0a0a] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right" />
                {(() => {
                  const u = normalizeUnit(it.unit);
                  const opts = UNIT_OPTIONS.includes(u as typeof UNIT_OPTIONS[number])
                    ? UNIT_OPTIONS
                    : ([u, ...UNIT_OPTIONS] as const);
                  return (
                    <StaticSelect value={u} options={opts} mono
                      onChange={v => patchItem(i, { unit: v })} />
                  );
                })()}
                <Input type="number" value={it.unitPrice ?? 0}
                  onChange={e => patchItem(i, { unitPrice: Number(e.target.value) })}
                  className="h-7 text-[11.5px] bg-[#0a0a0a] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right" />
                <div className="text-[11.5px] text-slate-100 font-mono tabular-nums text-right pt-1">
                  {formatMoney(it.total ?? 0)}
                </div>
                <div className="flex items-center justify-end gap-0.5">
                  {translation && (
                    <button
                      type="button"
                      onClick={() => { void translation.translateRow(i); }}
                      disabled={translating || !translation.targetCountry || !(it.description || it.productName)}
                      title={translation.targetCountry
                        ? `Translate to ${translation.targetCountry}`
                        : 'Pick a customer with a country to enable translation'}
                      className="text-slate-500 hover:text-emerald-300 p-1 disabled:opacity-30"
                    >
                      {translating
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Languages size={11} />}
                    </button>
                  )}
                  <button type="button" onClick={() => removeItem(i)}
                    className="text-slate-500 hover:text-red-400 p-1" title="Remove item">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="px-2 py-1.5 text-[12px] text-right">
            <span className="text-slate-500 mr-2">Total</span>
            <span className="text-slate-100 font-mono tabular-nums font-semibold">{formatMoney(totalAmount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Misc helpers ────────────────────────────────────────────────

function parseAnyItems(raw: unknown): AgentLineItem[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => ({
      productName: r?.productName ?? r?.description ?? '',
      description: r?.description ?? '',
      quantity: Number(r?.quantity) || 0,
      unit: r?.unit ?? 'Lbs',
      unitPrice: Number(r?.unitPrice) || 0,
      amount: Number(r?.amount) || 0,
      total: Number(r?.total ?? r?.amount) || (Number(r?.quantity ?? 0) * Number(r?.unitPrice ?? 0)),
    }));
  } catch {
    return [];
  }
}
