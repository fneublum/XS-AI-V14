// Agent Sales Orders — v2.
//
// Master list backed by commission_sales_orders (the base sales_orders
// table is intentionally NOT queried here). Each row shows its pipeline
// stage — Proposal → Offer → Proforma → Invoiced → Paid → Commission —
// and opens the six-tab AgentOrderWorkflowDrawer.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, Plus, CheckCircle2, X as XIcon, Download, Mail, Loader2, AlertCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardHeader, CardTitle, Button, Input, FormField, Label,
  Skeleton, EmptyState, Badge, Drawer,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { cn } from '../primitives/utils';
import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';
import { useAgentSalesOrders, AgentOrderRow } from '../queries/useAgentSalesOrders';
import { AgentOrderWorkflowDrawer } from '../components/AgentOrderWorkflowDrawer';
import { EmailComposeDrawer, type EmailDraft } from '../components/EmailComposeDrawer';
import { generateAgentOfferPdf, type AgentPartyDetails } from '../services/pdf/agentOfferPdf';
import { generateAgentProposalPdf } from '../services/pdf/agentProposalPdf';
import { generateProposalLabels, type ProposalLabels } from '../services/agentTranslation';
import { useSuppliers } from '../queries/useSuppliers';
import { useCustomers } from '../queries/useCustomers';
import { usePaymentTerms } from '../queries/usePaymentTerms';
import { usePorts } from '../queries/usePorts';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { PROPOSAL_PROMPT, normalizeProposal, parseProposalXlsx, type ProposalDraft } from '../lib/agentProposalSpec';
import { CUSTOMER_INV_PROMPT, normalizeCustomerInvoice, type CustomerInvoiceDraft } from '../lib/agentInvoiceSpec';
import { formatDate as fmtDate } from '../lib/formatDate';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { shortName, tooltipName } from '../lib/formatName';
import {
  stageLabel, stageTone, PipelineStage,
  type CommissionType, calcCommissionAmount, commissionTypeLabel,
} from '../lib/agentPipelineStage';
import {
  EditableOrderForm,
  buildPatchFromForm,
  Pills,
  COMMISSION_TYPES,
  normalizeUnit,
  type EditableOrderFormState,
} from '../components/AgentOrderWorkflowDrawer';

const STAGE_FILTERS: Array<{ id: PipelineStage; label: string }> = [
  { id: 'PROPOSAL',          label: 'Offer' },     // supplier-incoming, immutable
  { id: 'OFFER',             label: 'Proposal' },  // outgoing to customer
  { id: 'PROFORMA',          label: 'Proforma' },
  { id: 'INVOICED',          label: 'Invoiced' },
  { id: 'UNPAID_COMMISSION', label: 'Unpaid' },
  { id: 'PAID_COMMISSION',   label: 'Paid' },
];

// Stage badge on Invoiced/Unpaid/Paid tabs: clickable menu to
// transition the order's status without opening the full workflow
// drawer. The label is sourced from `stageLabel` so it stays in sync
// with the rest of the app.
const STAGE_OPTIONS: Array<{
  status: 'INVOICED' | 'UNPAID_COMMISSION' | 'PAID_COMMISSION';
}> = [
  { status: 'INVOICED' },
  { status: 'UNPAID_COMMISSION' },
  { status: 'PAID_COMMISSION' },
];

// Stages where bulk multi-select + bulk stage update is available.
// Mirrors the StageEditor whitelist below — anywhere a single row can
// hop between INVOICED/UNPAID/PAID, the bulk path can too.
const SELECTABLE_STAGES = new Set<PipelineStage>([
  'INVOICED', 'UNPAID_COMMISSION', 'PAID_COMMISSION',
]);

const StageEditor: React.FC<{ row: AgentOrderRow }> = ({ row }) => {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const update = useMutation<void, Error, string>({
    mutationFn: async (status) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .update({ status })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      toast.push({ kind: 'success', title: 'Stage updated', description: row.orderNumber });
    },
    onError: (err) => {
      toast.push({ kind: 'error', title: 'Update failed', description: err.message });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={update.isPending}
        className="inline-flex items-center gap-1 rounded hover:bg-[#1a1a1a] px-1 py-0.5 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Badge variant={stageTone[row.stage]} dot>{stageLabel[row.stage]}</Badge>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-20 min-w-[140px] rounded border border-[#1f1f1f] bg-[#0a0a0a] shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {STAGE_OPTIONS.map(opt => (
            <button
              key={opt.status}
              type="button"
              role="option"
              aria-selected={opt.status === row.stage}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (opt.status !== row.stage) update.mutate(opt.status);
              }}
              className={cn(
                'flex items-center justify-between w-full px-2 py-1.5 text-[12px] text-left',
                'hover:bg-[#161616]',
                opt.status === row.stage && 'bg-[#111111]',
              )}
            >
              <Badge variant={stageTone[opt.status]} dot>{stageLabel[opt.status]}</Badge>
              {opt.status === row.stage && <span className="text-slate-500 text-[10px] ml-2">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const headerColumns: DataTableColumn<AgentOrderRow>[] = [
  { id: 'order', header: 'Order', mono: true, sortable: true, filterable: true,
    value: r => r.orderNumber, cell: r => r.orderNumber },
  { id: 'seller', header: 'Seller', sortable: true, filterable: true,
    value: r => r.sellerName ?? '',
    cell: r => <span className="text-slate-300" title={tooltipName(r.sellerName)}>{shortName(r.sellerName, 1)}</span> },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span className="text-slate-100" title={tooltipName(r.customerName)}>{shortName(r.customerName, 1)}</span> },
  { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
    value: r => r.incoterm ?? '',
    cell: r => <span className="text-slate-400 font-mono text-[11.5px]">{r.incoterm ?? '—'}</span> },
];

// Single canonical unit per row, taken from the first item that has a
// unit set. Falls back to em-dash if the row has no items.
const rowUnit = (r: AgentOrderRow): string =>
  r.items.find(it => (it.unit ?? '').trim())?.unit?.trim() ?? '';

// Stages where the user can override Qty / Unit directly from the
// list cell. Editing on Proforma+ is useful when the supplier pre-
// shipment number changed and the user doesn't want to crack open
// the workflow drawer just to update one figure.
const QTY_EDIT_STAGES = new Set<PipelineStage>([
  'PROFORMA', 'INVOICED', 'UNPAID_COMMISSION', 'PAID_COMMISSION',
]);

const UNIT_OPTIONS_INLINE = ['Lbs', 'Kgs', 'MT', 'Bags', 'Bales', 'Pcs', 'Sets'] as const;

// 999,999.9 — comma thousands separator, 1 decimal place. Matches
// the user's preferred quantity display.
const formatQty = (n: number): string =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '0.0';

// Strip commas / whitespace and parse. Empty string → 0.
const parseQty = (s: string): number => {
  const cleaned = s.replace(/[,\s]/g, '').trim();
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

const QtyCell: React.FC<{ row: AgentOrderRow }> = ({ row }) => {
  const qc = useQueryClient();
  const toast = useToast();
  // `draft` holds whatever the user types or what we render formatted
  // when the input is unfocused. We swap between formatted and raw on
  // focus / blur.
  const [draft, setDraft] = useState<string>(() => formatQty(row.totalQuantity ?? 0));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatQty(row.totalQuantity ?? 0));
  }, [row.id, row.totalQuantity, editing]);

  const update = useMutation<void, Error, number>({
    mutationFn: async (next) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .update({ totalQuantity: next })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] }); },
    onError: (e) => toast.push({ kind: 'error', title: 'Update failed', description: e.message }),
  });

  const commit = () => {
    setEditing(false);
    const next = parseQty(draft);
    if (!Number.isFinite(next) || next < 0) {
      setDraft(formatQty(row.totalQuantity ?? 0));
      return;
    }
    if (next === row.totalQuantity) {
      // Re-format anyway in case the user typed "38000" without commas.
      setDraft(formatQty(next));
      return;
    }
    setDraft(formatQty(next));
    update.mutate(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => {
        // Switch to raw number for easier editing.
        setEditing(true);
        const n = row.totalQuantity ?? 0;
        setDraft(n === 0 ? '' : String(n));
      }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onClick={e => e.stopPropagation()}
      disabled={update.isPending}
      className="w-[100px] h-6 text-[11.5px] bg-transparent border border-transparent hover:border-[#1f1f1f] focus:border-indigo-500 rounded text-slate-100 font-mono tabular-nums text-right px-1 outline-none"
    />
  );
};

const UnitCell: React.FC<{ row: AgentOrderRow }> = ({ row }) => {
  const qc = useQueryClient();
  const toast = useToast();
  const stored = rowUnit(row);
  // Render the canonical unit even when the row stored a variant
  // ("KGS" / "KILOS" / "kg" → "Kgs"). Saving always writes the
  // canonical form.
  const normalized = stored ? normalizeUnit(stored) : '';

  const update = useMutation<void, Error, string>({
    mutationFn: async (next) => {
      const supabase = getSupabaseClient();
      const items = (row.items ?? []).map(it => ({ ...it, unit: next }));
      const { error } = await supabase
        .from('commission_sales_orders')
        .update({ items })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] }); },
    onError: (e) => toast.push({ kind: 'error', title: 'Update failed', description: e.message }),
  });

  return (
    <select
      value={normalized || ''}
      onChange={e => { const v = e.target.value; if (v && v !== normalized) update.mutate(v); }}
      onClick={e => e.stopPropagation()}
      disabled={update.isPending}
      className="h-6 text-[11.5px] bg-transparent border border-transparent hover:border-[#1f1f1f] focus:border-indigo-500 rounded text-slate-300 font-mono px-1 outline-none cursor-pointer"
    >
      {!normalized && <option value="">—</option>}
      {normalized && !UNIT_OPTIONS_INLINE.includes(normalized as typeof UNIT_OPTIONS_INLINE[number]) && (
        <option value={normalized}>{normalized}</option>
      )}
      {UNIT_OPTIONS_INLINE.map(u => <option key={u} value={u}>{u}</option>)}
    </select>
  );
};

const qtyColumn: DataTableColumn<AgentOrderRow> = {
  id: 'qty', header: 'Qty', align: 'right', mono: true, sortable: true,
  value: r => r.totalQuantity,
  cell: r => QTY_EDIT_STAGES.has(r.stage)
    ? <QtyCell row={r} />
    : (r.totalQuantity > 0
        ? formatQty(r.totalQuantity)
        : <span className="text-slate-600">—</span>),
};

const unitColumn: DataTableColumn<AgentOrderRow> = {
  id: 'unit', header: 'Unit', align: 'right', mono: true, sortable: true, filterable: true,
  value: r => normalizeUnit(rowUnit(r)),
  cell: r => {
    if (QTY_EDIT_STAGES.has(r.stage)) return <UnitCell row={r} />;
    const u = rowUnit(r);
    if (!u) return <span className="text-slate-600">—</span>;
    return <span className="text-slate-400 text-[11.5px]">{normalizeUnit(u)}</span>;
  },
};

const totalsColumns: DataTableColumn<AgentOrderRow>[] = [
  { id: 'amount', header: 'Order total', align: 'right', mono: true, sortable: true,
    value: r => r.orderTotal,
    cell: r => fmtMoney(r.orderTotal) },
  { id: 'commission', header: 'Commission', align: 'right', mono: true, sortable: true,
    value: r => r.commissionAmount,
    cell: r => r.commissionAmount > 0
      ? <span className="text-emerald-400">{fmtMoney(r.commissionAmount)}</span>
      : <span className="text-slate-600">—</span> },
];

const stageColumn: DataTableColumn<AgentOrderRow> = {
  id: 'stage', header: 'Stage', sortable: true, filterable: true,
  value: r => r.stage,
  cell: r => {
    if (r.stage === 'INVOICED'
     || r.stage === 'UNPAID_COMMISSION'
     || r.stage === 'PAID_COMMISSION') {
      return <StageEditor row={r} />;
    }
    return <Badge variant={stageTone[r.stage]} dot>{stageLabel[r.stage]}</Badge>;
  },
};

// Offer-stage-only column (internal PROPOSAL stage) showing whether
// a downstream Proposal (= internal OFFER) has been derived yet.
// Swapped in for the generic Stage column on the Offer filter —
// every row there is "Offer" so the stage column carries no
// information.
const offerStatusColumn: DataTableColumn<AgentOrderRow> = {
  id: 'offerStatus', header: 'Proposal status', sortable: true, filterable: true,
  value: r => (r.status ?? '').toUpperCase() === 'PROPOSAL_OFFERED' ? 'Prepared' : 'Pending',
  cell: r => {
    const offered = (r.status ?? '').toUpperCase() === 'PROPOSAL_OFFERED';
    return offered
      ? <Badge variant="success" dot>Prepared</Badge>
      : <Badge variant="neutral" dot>Pending</Badge>;
  },
};

const dateColumn: DataTableColumn<AgentOrderRow> = {
  id: 'date', header: 'Created', align: 'right', sortable: true,
  value: r => r.createdAt,
  cell: r => (
    <span className="text-slate-500 font-mono tabular-nums text-[11px]">
      {fmtDate(r.createdAt)}
    </span>
  ),
};

// Checkbox column prepended to the stage table on stages where bulk
// stage update is enabled. Click on the checkbox stops propagation so
// it doesn't open the row drawer.
const buildSelectionColumn = (
  selectedIds: Set<string>,
  visibleRows: AgentOrderRow[],
  toggleRow: (id: string) => void,
  toggleAll: () => void,
): DataTableColumn<AgentOrderRow> => {
  const allSelected = visibleRows.length > 0 && visibleRows.every(r => selectedIds.has(r.id));
  const someSelected = !allSelected && visibleRows.some(r => selectedIds.has(r.id));
  return {
    id: 'select',
    width: '32px',
    align: 'center',
    header: (
      <input
        type="checkbox"
        ref={el => { if (el) el.indeterminate = someSelected; }}
        checked={allSelected}
        onChange={toggleAll}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer accent-indigo-500 align-middle"
        aria-label="Select all visible rows"
      />
    ),
    cell: (r) => (
      <input
        type="checkbox"
        checked={selectedIds.has(r.id)}
        onChange={() => toggleRow(r.id)}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer accent-indigo-500 align-middle"
        aria-label={`Select ${r.orderNumber}`}
      />
    ),
  };
};

const columnsForStage = (stage: PipelineStage): DataTableColumn<AgentOrderRow>[] => {
  // Qty + Unit columns belong to stages where line-item totals are
  // user-relevant: Proforma (sales contract), Invoiced, and the
  // commission stages downstream. Skip on Offer / Proposal — those
  // are still being negotiated and the qty is noise.
  const showQty = stage === 'PROFORMA'
                || stage === 'INVOICED'
                || stage === 'UNPAID_COMMISSION'
                || stage === 'PAID_COMMISSION';
  const before = showQty
    ? [...headerColumns, qtyColumn, unitColumn]
    : [...headerColumns];
  return stage === 'PROPOSAL'
    ? [...before, ...totalsColumns, offerStatusColumn, dateColumn]
    : [...before, ...totalsColumns, stageColumn, dateColumn];
};

type OfferSubFilter = 'ALL' | 'SAVED' | 'SENT' | 'APPROVED' | 'REJECTED';

const OFFER_SUB_FILTERS: Array<{ id: OfferSubFilter; label: string; match: (status: string) => boolean }> = [
  { id: 'ALL',      label: 'All',      match: () => true },
  { id: 'SAVED',    label: 'Saved',    match: s => s === 'OFFER' || s === 'OFFER_SAVED' || s === '' },
  { id: 'SENT',     label: 'Sent',     match: s => s === 'OFFER_SENT' },
  { id: 'APPROVED', label: 'Approved', match: s => s === 'OFFER_APPROVED' },
  { id: 'REJECTED', label: 'Rejected', match: s => s === 'OFFER_REJECTED' },
];

const AgentSalesOrdersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<PipelineStage>('PROPOSAL');
  const [offerSub, setOfferSub] = useState<OfferSubFilter>('ALL');
  const [activeOrder, setActiveOrder] = useState<AgentOrderRow | null>(null);
  const [viewOrder, setViewOrder]     = useState<AgentOrderRow | null>(null);
  const [emailDraft, setEmailDraft]   = useState<EmailDraft | null>(null);
  // After OCR-creating a proposal we want to drop the user straight
  // into the workflow drawer for the new row. The list refetch is
  // async, so stash the id and open the drawer once the row arrives.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  // Multi-select for bulk stage update. Cleared whenever the stage
  // pill changes; pruned to currently-visible rows after refetch.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const orders = useAgentSalesOrders(search);

  const { confirmDelete, deleteDialog } = useRowDelete<AgentOrderRow>({
    table: 'commission_sales_orders',
    listQueryKeys: ['agentSalesOrders'],
    rowLabel: r => r.orderNumber,
  });

  const toast = useToast();
  const qc = useQueryClient();

  // Status mutation — used by Approve (→ OFFER) and the auto-mark-sent
  // path triggered by the preview dialog's Email/Download.
  const updateStatus = useMutation<void, Error, { id: string; status: string }>({
    mutationFn: async ({ id, status }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .update({ status })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Update failed', description: e.message }),
  });

  // Offer → Proposal "fork" (in user-facing terms; internally it's
  // still PROPOSAL → OFFER). The original offer row stays put as the
  // immutable supplier record (status flips to PROPOSAL_OFFERED so
  // the list shows a "Prepared" badge). A NEW row is inserted into
  // the Proposal stage, items / terms copied, ready for editing.
  const prepareOffer = useMutation<{ offerId: string }, Error, AgentOrderRow>({
    mutationFn: async (row) => {
      const supabase = getSupabaseClient();
      const offerId = `CSO-${Date.now()}`;
      // Naming: PROP-NNNNN → OFF-NNNNN; otherwise prepend OFF-.
      const offerOrderNumber = /^PROP-/i.test(row.orderNumber)
        ? row.orderNumber.replace(/^PROP-/i, 'OFF-')
        : `OFF-${row.orderNumber}`;

      const { error: insErr } = await supabase.from('commission_sales_orders').insert({
        id: offerId,
        companyId:    row.companyId ?? null,
        createdAt:    new Date().toISOString(),
        orderNumber:  offerOrderNumber,
        sellerName:   row.sellerName,
        customerName: row.customerName,
        incoterm:     row.incoterm ?? null,
        paymentTerms: row.paymentTerms ?? null,
        pod:          row.pod ?? null,
        deliveryDate: row.deliveryDate ?? null,
        items:        row.items,
        totalQuantity:    row.totalQuantity ?? 0,
        orderTotal:       row.orderTotal,
        commissionRate:   0,
        commissionType:   'PERCENT',
        commissionAmount: 0,
        // Don't carry the supplier's PDF onto the offer — the offer is
        // OUR document. Original proposal keeps it.
        originalDocumentUrl: null,
        status: 'OFFER_SAVED',
      });
      if (insErr) throw new Error(insErr.message);

      // Mark the proposal as offered so the list column shows the
      // green "Offered" badge.
      const { error: updErr } = await supabase
        .from('commission_sales_orders')
        .update({ status: 'PROPOSAL_OFFERED' })
        .eq('id', row.id);
      if (updErr) throw new Error(updErr.message);

      return { offerId };
    },
    onSuccess: ({ offerId }, row) => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      toast.push({
        kind: 'success',
        title: 'Proposal prepared',
        description: `New proposal created from ${row.orderNumber}. Edit it on the Proposal tab.`,
      });
      // Drop the user into the new proposal's drawer once the list refetches.
      setPendingOpenId(offerId);
      setStageFilter('OFFER');
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Prepare failed', description: e.message }),
  });

  const handlePrepareOffer = (row: AgentOrderRow) => {
    if ((row.status ?? '').toUpperCase() === 'PROPOSAL_OFFERED') {
      if (!window.confirm(
        `${row.orderNumber} already has a Proposal. Create another one anyway?`,
      )) return;
    } else {
      if (!window.confirm(
        `Create a Proposal from offer ${row.orderNumber}?\n\n`
        + `The offer stays here as the supplier record. A new row is added to the Proposal stage where you can translate, edit prices, and send to the customer.`,
      )) return;
    }
    prepareOffer.mutate(row);
  };

  // Proposal-stage row actions (internal OFFER stage).
  const approveOffer = (row: AgentOrderRow) => {
    if (!window.confirm(`Mark proposal ${row.orderNumber} as approved?`)) return;
    updateStatus.mutate(
      { id: row.id, status: 'OFFER_APPROVED' },
      {
        onSuccess: () => {
          toast.push({
            kind: 'success',
            title: 'Proposal approved',
            description: `${row.orderNumber} is ready to convert to a Proforma.`,
          });
        },
      },
    );
  };

  const rejectOffer = (row: AgentOrderRow) => {
    if (!window.confirm(`Mark proposal ${row.orderNumber} as rejected?`)) return;
    updateStatus.mutate(
      { id: row.id, status: 'OFFER_REJECTED' },
      {
        onSuccess: () => {
          toast.push({
            kind: 'success',
            title: 'Proposal rejected',
            description: `${row.orderNumber} moved to Rejected.`,
          });
        },
      },
    );
  };

  const markOfferSent = (row: AgentOrderRow) => {
    const s = (row.status ?? '').toUpperCase();
    if (s !== 'OFFER' && s !== 'OFFER_SAVED' && s !== '') return;
    updateStatus.mutate({ id: row.id, status: 'OFFER_SENT' });
  };

  // Approved proposal → proforma. Bumps the master row to PROFORMA
  // stage and inserts a commissions_proformas row so the new entry
  // shows up in the Proforma list and the drawer's saved list.
  const createProforma = useMutation<void, Error, AgentOrderRow>({
    mutationFn: async (row) => {
      const supabase = getSupabaseClient();
      const piId = `PF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const now = new Date().toISOString();

      const { error: soErr } = await supabase
        .from('commission_sales_orders')
        .update({ status: 'PROFORMA' })
        .eq('id', row.id);
      if (soErr) throw new Error(soErr.message);

      const { error: pfErr } = await supabase.from('commissions_proformas').insert({
        id:            piId,
        company_id:    row.companyId ?? '',
        contract_id:   row.id,
        pi_number:     row.orderNumber,
        pi_date:       now.slice(0, 10),
        seller:        row.sellerName,
        buyer:         row.customerName,
        incoterm:      row.incoterm ?? null,
        payment_terms: row.paymentTerms ?? null,
        pod:           row.pod ?? null,
        items:         row.items,
        total:         row.orderTotal,
        status:        'FINAL',
      });
      if (pfErr) throw new Error(pfErr.message);
    },
    onSuccess: (_d, row) => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      toast.push({
        kind: 'success',
        title: 'Sales contract created',
        description: `${row.orderNumber} promoted to Proforma.`,
      });
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Create failed', description: e.message }),
  });

  const handleCreateProforma = (row: AgentOrderRow) => {
    if (!window.confirm(`Convert proposal ${row.orderNumber} to a Sales Contract (Proforma)?`)) return;
    createProforma.mutate(row);
  };

  const rows = useMemo(() => {
    const stageRows = (orders.data ?? []).filter(r => r.stage === stageFilter);
    if (stageFilter !== 'OFFER') return stageRows;
    const sub = OFFER_SUB_FILTERS.find(p => p.id === offerSub);
    if (!sub) return stageRows;
    return stageRows.filter(r => sub.match((r.status ?? '').toUpperCase()));
  }, [orders.data, stageFilter, offerSub]);

  // Drop selection when switching stages — bulk update only makes
  // sense within a single stage scope.
  useEffect(() => { setSelectedIds(new Set()); }, [stageFilter]);

  // After a refetch, prune ids that are no longer visible (rows that
  // moved stages or got deleted).
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map(r => r.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const toggleRowSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllSelected = () => {
    setSelectedIds(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(r.id));
      return allSelected ? new Set() : new Set(rows.map(r => r.id));
    });
  };

  const bulkUpdateStage = useMutation<void, Error, { ids: string[]; status: PipelineStage }>({
    mutationFn: async ({ ids, status }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('commission_sales_orders')
        .update({ status })
        .in('id', ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      toast.push({
        kind: 'success',
        title: 'Stage updated',
        description: `${vars.ids.length} ${vars.ids.length === 1 ? 'order' : 'orders'} → ${stageLabel[vars.status]}`,
      });
      setSelectedIds(new Set());
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Bulk update failed', description: e.message }),
  });

  const offerSubCounts = useMemo(() => {
    const m = new Map<OfferSubFilter, number>();
    const offerRows = (orders.data ?? []).filter(r => r.stage === 'OFFER');
    for (const sub of OFFER_SUB_FILTERS) {
      m.set(sub.id, offerRows.filter(r => sub.match((r.status ?? '').toUpperCase())).length);
    }
    return m;
  }, [orders.data]);

  // Reflect the current rowset in the drawer state so the tabs see
  // fresh data after a mutation. Query invalidation triggers a refetch,
  // orders.data updates, and this lookup surfaces the new values.
  const liveOrder = useMemo(() => {
    if (!activeOrder) return null;
    return (orders.data ?? []).find(r => r.id === activeOrder.id) ?? activeOrder;
  }, [activeOrder, orders.data]);

  // Drop the user into the workflow drawer the moment a freshly OCR'd
  // proposal lands in the rowset.
  useEffect(() => {
    if (!pendingOpenId) return;
    const created = (orders.data ?? []).find(r => r.id === pendingOpenId);
    if (!created) return;
    setActiveOrder(created);
    setPendingOpenId(null);
  }, [pendingOpenId, orders.data]);

  const counts = useMemo(() => {
    const m = new Map<PipelineStage, number>();
    for (const r of orders.data ?? []) {
      m.set(r.stage, (m.get(r.stage) ?? 0) + 1);
    }
    return m;
  }, [orders.data]);

  // Pipeline-wide stats (not filtered by the stage pill) so the user
  // always sees what they're owed vs. already received regardless of
  // which filter is active.
  const stats = useMemo(() => {
    const all = orders.data ?? [];
    const pipelineRevenue = all.reduce((s, r) => s + r.orderTotal, 0);
    let toReceive = 0;  // commission earned but not yet paid to us
    let received  = 0;  // commission already paid to us
    for (const r of all) {
      if (r.stage === 'PAID_COMMISSION') {
        received += r.commissionAmount;
      } else if (r.stage === 'INVOICED' || r.stage === 'UNPAID_COMMISSION') {
        toReceive += r.commissionAmount;
      }
    }
    return {
      orders: all.length,
      filteredOrders: rows.length,
      pipelineRevenue,
      toReceive,
      received,
    };
  }, [orders.data, rows]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              Agent Sales Orders
            </h1>
            <Badge variant="info">v2</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Offer → Proposal → Proforma → Invoiced → Paid → Commission.
            Click any order to walk the six-tab workflow.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden mb-4 shrink-0">
        <Stat label="Orders"             value={orders.isLoading ? '—' : String(stats.orders)} />
        <Stat label="Pipeline revenue"   value={orders.isLoading ? '—' : fmtMoney(stats.pipelineRevenue)} />
        <Stat label="Commission to receive"
              value={orders.isLoading ? '—' : fmtMoney(stats.toReceive)}
              tone={stats.toReceive > 0 ? 'warning' : 'neutral'} />
        <Stat label="Commission received"
              value={orders.isLoading ? '—' : fmtMoney(stats.received)}
              tone="positive" />
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
        {STAGE_FILTERS.map(f => (
          <FilterPill
            key={f.id}
            active={stageFilter === f.id}
            onClick={() => setStageFilter(f.id)}
            count={counts.get(f.id)}
          >
            {f.label}
          </FilterPill>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {stageFilter === 'PROPOSAL' && (
            <>
              <AddProposalManualButton onCreated={setPendingOpenId} />
              <NewProposalButton onCreated={setPendingOpenId} />
            </>
          )}
          {stageFilter === 'PROFORMA' && (
            <>
              <AddProformaManualButton />
              <NewProformaButton />
            </>
          )}
          {stageFilter === 'INVOICED' && <NewInvoiceButton />}
          <div className="w-64">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Order #, customer, seller"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>
      </div>

      {stageFilter === 'OFFER' && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap shrink-0 pl-1 -mt-1">
          {OFFER_SUB_FILTERS.map(s => (
            <FilterPill
              key={s.id}
              active={offerSub === s.id}
              onClick={() => setOfferSub(s.id)}
              count={offerSubCounts.get(s.id)}
            >
              {s.label}
            </FilterPill>
          ))}
        </div>
      )}

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>{stageLabel[stageFilter]} stage</CardTitle>
        </CardHeader>

        {SELECTABLE_STAGES.has(stageFilter) && selectedIds.size > 0 && (
          <div className="flex items-center justify-between border-b border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2 text-[12px] shrink-0">
            <div className="text-slate-300">
              <span className="font-medium text-slate-100">{selectedIds.size}</span>
              <span className="text-slate-500"> selected</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Set stage:</span>
              {STAGE_OPTIONS.map(opt => (
                <button
                  key={opt.status}
                  type="button"
                  onClick={() => {
                    if (bulkUpdateStage.isPending) return;
                    bulkUpdateStage.mutate({ ids: [...selectedIds], status: opt.status });
                  }}
                  disabled={bulkUpdateStage.isPending}
                  className="px-1.5 py-0.5 rounded hover:bg-[#161616] disabled:opacity-50"
                >
                  <Badge variant={stageTone[opt.status]} dot>{stageLabel[opt.status]}</Badge>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkUpdateStage.isPending}
                className="ml-1 text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {orders.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={90} height={14} />
                <Skeleton width={200} height={14} />
                <Skeleton width={80} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : orders.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load orders"
            description={orders.error.message}
            action={{ label: 'Retry', onClick: orders.refetch }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : `No ${stageLabel[stageFilter].toLowerCase()} orders`}
            description={
              search
                ? `Nothing matched "${search}".`
                : 'Try another stage.'
            }
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        ) : (
          <DataTable
            columns={
              SELECTABLE_STAGES.has(stageFilter)
                ? [
                    buildSelectionColumn(selectedIds, rows, toggleRowSelected, toggleAllSelected),
                    ...columnsForStage(stageFilter),
                  ]
                : columnsForStage(stageFilter)
            }
            rows={rows}
            getRowId={r => r.id}
            onRowClick={r => setActiveOrder(r)}
            rowActions={r => {
              const status   = (r.status ?? '').toUpperCase();
              const isProp   = r.stage === 'PROPOSAL';
              const isOffer  = r.stage === 'OFFER';
              const isOfferApproved = status === 'OFFER_APPROVED';
              const isOfferRejected = status === 'OFFER_REJECTED';

              // Proposal rows: read-only — no Edit pencil. Just view,
              // view original, and the stage-promotion arrow ("Prepare
              // Offer"). The legacy Reject button was removed; rejection
              // is an offer-stage concern in the new flow.
              if (isProp) {
                return (
                  <RowActions
                    onDeliveryDocs={r.originalDocumentUrl ? () => openOriginalDocument(r.originalDocumentUrl!) : undefined}
                    deliveryDocsLabel="View original document"
                    onApprove={() => handlePrepareOffer(r)}
                    approveLabel="Prepare Proposal"
                    onDelete={() => confirmDelete(r)}
                    disabled={prepareOffer.isPending}
                  />
                );
              }

              // Offer rows: Approve / Reject + (when approved) Create
              // Proforma replaces Approve. Reject hidden once already
              // rejected.
              if (isOffer) {
                return (
                  <RowActions
                    onView={() => setViewOrder(r)}
                    onEdit={() => setActiveOrder(r)}
                    onDeliveryDocs={r.originalDocumentUrl ? () => openOriginalDocument(r.originalDocumentUrl!) : undefined}
                    deliveryDocsLabel="View original document"
                    onApprove={isOfferApproved
                      ? () => handleCreateProforma(r)
                      : (isOfferRejected ? undefined : () => approveOffer(r))}
                    approveLabel={isOfferApproved
                      ? 'Convert to Proforma (Sales Contract)'
                      : 'Approve proposal'}
                    onReject={!isOfferApproved && !isOfferRejected ? () => rejectOffer(r) : undefined}
                    rejectLabel="Reject proposal"
                    onDelete={() => confirmDelete(r)}
                  />
                );
              }

              // Other stages: existing default.
              return (
                <RowActions
                  onView={() => setViewOrder(r)}
                  onEdit={() => setActiveOrder(r)}
                  onDeliveryDocs={r.originalDocumentUrl ? () => openOriginalDocument(r.originalDocumentUrl!) : undefined}
                  deliveryDocsLabel="View original document"
                  onDelete={() => confirmDelete(r)}
                />
              );
            }}
          />
        )}
      </Card>

      <AgentOrderWorkflowDrawer
        order={liveOrder}
        onOpenChange={o => !o && setActiveOrder(null)}
      />

      <ProformaPreviewDialog
        order={viewOrder}
        onOpenChange={(o) => !o && setViewOrder(null)}
        onEmail={(draft) => {
          if (viewOrder && viewOrder.stage === 'OFFER') markOfferSent(viewOrder);
          setViewOrder(null);
          setEmailDraft(draft);
        }}
      />
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />

      {deleteDialog}
    </div>
  );
};

const FilterPill: React.FC<{
  active?: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}> = ({ active, onClick, count, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'px-2 py-1 rounded text-[12px] flex items-center gap-1.5 transition-colors',
      active
        ? 'bg-[#161616] text-slate-100'
        : 'border border-[#1f1f1f] text-slate-500 hover:text-slate-200',
    )}
  >
    {children}
    {count !== undefined && (
      <span className={cn(
        'font-mono tabular-nums text-[10px]',
        active ? 'text-slate-500' : 'text-slate-600',
      )}>
        {count}
      </span>
    )}
  </button>
);

const Stat: React.FC<{
  label: string; value: string;
  tone?: 'positive' | 'warning' | 'neutral';
}> = ({ label, value, tone = 'neutral' }) => (
  <div className="bg-[#0a0a0a] p-4">
    <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">{label}</div>
    <div className={cn(
      'font-mono tabular-nums text-[20px] font-semibold mt-1',
      tone === 'positive' ? 'text-emerald-400'
      : tone === 'warning' ? 'text-amber-400'
      : 'text-slate-100',
    )}>
      {value}
    </div>
  </div>
);

// ── New-proposal OCR (list-level entry point) ────────────────────
//
// Drops the supplier proposal PDF on the AiUploadModal, runs Gemini
// with the shared PROPOSAL_PROMPT, and INSERTs a fresh
// commission_sales_orders row. The drawer's "Re-extract proposal" is
// for an existing row; this is the only way to create a new one.

const INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'] as const;

const StaticSelect: React.FC<{
  value: string; options: readonly string[]; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}> = ({ value, options, onChange, placeholder, mono }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className={cn(
      'w-full h-8 text-[12.5px] bg-[#111111] border border-[#1f1f1f] text-slate-200',
      'rounded px-2 outline-none focus-visible:border-indigo-500',
      mono && 'font-mono',
    )}>
    <option value="">{placeholder ?? '—'}</option>
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);

const NewProposalButton: React.FC<{ onCreated?: (orderId: string) => void }>
  = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}
        className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px]">
        <Sparkles size={12} className="mr-1.5" />
        OCR new offer
      </Button>

      {open && (
        <AiUploadModal<ProposalDraft>
          open={open}
          onOpenChange={setOpen}
          config={{
            title: 'OCR supplier offer',
            description: 'Drop the supplier offer PDF. Gemini extracts the header and line items, then a new commission sales order is created.',
            emptyDraft: () => ({
              sellerName: '', customerName: '', orderNumber: '',
              incoterm: '', paymentTerms: '', pod: '', deliveryDate: '',
              items: [], originalDocument: null,
            }),
            fromExtracted: (d, originalDocument) => ({
              ...d,
              originalDocument: originalDocument ?? d.originalDocument ?? null,
            }),
            extractSpec: { prompt: PROPOSAL_PROMPT, normalize: normalizeProposal },
            xlsxParser: parseProposalXlsx,
            extractSummary: d => [d.sellerName, d.customerName, `${d.items.length} items`].filter(Boolean).join(' · '),
            validate: d => {
              if (!d.orderNumber.trim()) return 'Order # is required.';
              if (!d.sellerName.trim())  return 'Seller is required.';
              if (!d.customerName.trim()) return 'Customer is required.';
              return null;
            },
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Order #</Label>
                  <Input value={d.orderNumber}
                    onChange={e => setD({ ...d, orderNumber: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Delivery date</Label>
                  <Input type="date" value={d.deliveryDate.slice(0, 10)}
                    onChange={e => setD({ ...d, deliveryDate: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Seller</Label>
                  <SupabaseSelectField value={d.sellerName} onPick={(v) => setD({ ...d, sellerName: v })}
                    placeholder="Pick seller…" allowFreeText showResolvedLabel
                    source={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Customer</Label>
                  <SupabaseSelectField value={d.customerName} onPick={(v) => setD({ ...d, customerName: v })}
                    placeholder="Pick customer…" allowFreeText showResolvedLabel
                    source={{ table: 'customers', valueColumn: 'name', secondaryColumn: 'nickname', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</Label>
                  <StaticSelect value={d.incoterm} options={INCOTERMS} mono
                    onChange={v => setD({ ...d, incoterm: v })} placeholder="Incoterm…" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Payment terms</Label>
                  <SupabaseSelectField value={d.paymentTerms} onPick={(v) => setD({ ...d, paymentTerms: v })}
                    placeholder="Pick terms…" allowFreeText
                    source={{ table: 'payment_terms', valueColumn: 'code', labelColumn: 'description', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POD</Label>
                  <SupabaseSelectField value={d.pod} onPick={(v) => setD({ ...d, pod: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                {d.items.length > 0 && (
                  <div className="col-span-2">
                    <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                      Line items ({d.items.length}) — review-only
                    </Label>
                    <div className="mt-1 rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f] text-[11.5px]">
                      {d.items.map((it, i) => (
                        <div key={i} className="grid grid-cols-[1fr_70px_50px_90px_90px] gap-2 px-2 py-1.5 items-center">
                          <span className="text-slate-200 truncate">{it.description}</span>
                          <span className="text-right font-mono tabular-nums text-slate-300">{it.quantity}</span>
                          <span className="text-right font-mono text-slate-400">{it.unit}</span>
                          <span className="text-right font-mono tabular-nums text-slate-300">{fmtMoney(it.unitPrice)}</span>
                          <span className="text-right font-mono tabular-nums text-slate-100">{fmtMoney(it.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ),
            save: async (d) => {
              const totalQuantity = d.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
              const orderTotal    = d.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
              const supabase = getSupabaseClient();
              const id = `CSO-${Date.now()}`;
              const { error } = await supabase.from('commission_sales_orders').insert({
                id,
                companyId,
                createdAt:   new Date().toISOString(),
                orderNumber: d.orderNumber,
                sellerName:  d.sellerName,
                customerName: d.customerName,
                incoterm:    d.incoterm || null,
                paymentTerms: d.paymentTerms || null,
                pod:         d.pod || null,
                deliveryDate: d.deliveryDate || null,
                items:       d.items,
                totalQuantity,
                orderTotal,
                commissionRate:   0,
                commissionType:   'PERCENT',
                commissionAmount: 0,
                originalDocumentUrl: d.originalDocument ?? null,
                status: 'PROPOSAL',
              });
              if (error) throw new Error(error.message);
              toast.push({ kind: 'success', title: 'Offer created', description: d.orderNumber });
              void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
              onCreated?.(id);
            },
          }}
        />
      )}
    </>
  );
};

// ── New-proforma OCR (list-level entry point on Proforma tab) ─────
//
// Drops a proforma PDF on the AiUploadModal — a proforma's structure
// matches a proposal closely, so we reuse PROPOSAL_PROMPT. Inserts
// BOTH a commission_sales_orders row (status='PROFORMA') AND a
// commissions_proformas row (status='FINAL') so the new entry shows
// up under the Proforma stage filter and the drawer's saved list.

const NewProformaButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}
        className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px]">
        <Sparkles size={12} className="mr-1.5" />
        OCR new proforma
      </Button>

      {open && (
        <AiUploadModal<ProposalDraft>
          open={open}
          onOpenChange={setOpen}
          config={{
            title: 'OCR proforma',
            description: 'Drop the proforma PDF. A commission sales order in PROFORMA status is created alongside a row in commissions_proformas.',
            emptyDraft: () => ({
              sellerName: '', customerName: '', orderNumber: '',
              incoterm: '', paymentTerms: '', pod: '', deliveryDate: '',
              items: [], originalDocument: null,
            }),
            fromExtracted: (d, originalDocument) => ({
              ...d,
              originalDocument: originalDocument ?? d.originalDocument ?? null,
            }),
            extractSpec: { prompt: PROPOSAL_PROMPT, normalize: normalizeProposal },
            extractSummary: d => [d.sellerName, d.customerName, `${d.items.length} items`].filter(Boolean).join(' · '),
            validate: d => {
              if (!d.orderNumber.trim()) return 'PI # is required.';
              if (!d.sellerName.trim())  return 'Seller is required.';
              if (!d.customerName.trim()) return 'Customer is required.';
              return null;
            },
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">PI # / Order #</Label>
                  <Input value={d.orderNumber}
                    onChange={e => setD({ ...d, orderNumber: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Delivery date</Label>
                  <Input type="date" value={d.deliveryDate.slice(0, 10)}
                    onChange={e => setD({ ...d, deliveryDate: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Seller</Label>
                  <SupabaseSelectField value={d.sellerName} onPick={(v) => setD({ ...d, sellerName: v })}
                    placeholder="Pick seller…" allowFreeText showResolvedLabel
                    source={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Customer</Label>
                  <SupabaseSelectField value={d.customerName} onPick={(v) => setD({ ...d, customerName: v })}
                    placeholder="Pick customer…" allowFreeText showResolvedLabel
                    source={{ table: 'customers', valueColumn: 'name', secondaryColumn: 'nickname', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</Label>
                  <StaticSelect value={d.incoterm} options={INCOTERMS} mono
                    onChange={v => setD({ ...d, incoterm: v })} placeholder="Incoterm…" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Payment terms</Label>
                  <SupabaseSelectField value={d.paymentTerms} onPick={(v) => setD({ ...d, paymentTerms: v })}
                    placeholder="Pick terms…" allowFreeText
                    source={{ table: 'payment_terms', valueColumn: 'code', labelColumn: 'description', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POD</Label>
                  <SupabaseSelectField value={d.pod} onPick={(v) => setD({ ...d, pod: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                {d.items.length > 0 && (
                  <div className="col-span-2">
                    <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                      Line items ({d.items.length}) — review-only
                    </Label>
                    <div className="mt-1 rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f] text-[11.5px]">
                      {d.items.map((it, i) => (
                        <div key={i} className="grid grid-cols-[1fr_70px_50px_90px_90px] gap-2 px-2 py-1.5 items-center">
                          <span className="text-slate-200 truncate">{it.description}</span>
                          <span className="text-right font-mono tabular-nums text-slate-300">{it.quantity}</span>
                          <span className="text-right font-mono text-slate-400">{it.unit}</span>
                          <span className="text-right font-mono tabular-nums text-slate-300">{fmtMoney(it.unitPrice)}</span>
                          <span className="text-right font-mono tabular-nums text-slate-100">{fmtMoney(it.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ),
            save: async (d) => {
              const totalQuantity = d.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
              const orderTotal    = d.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
              const supabase = getSupabaseClient();
              const orderId = `CSO-${Date.now()}`;
              const piId    = `PF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
              const now = new Date().toISOString();

              const { error: soErr } = await supabase.from('commission_sales_orders').insert({
                id: orderId,
                companyId,
                createdAt:   now,
                orderNumber: d.orderNumber,
                sellerName:  d.sellerName,
                customerName: d.customerName,
                incoterm:    d.incoterm || null,
                paymentTerms: d.paymentTerms || null,
                pod:         d.pod || null,
                deliveryDate: d.deliveryDate || null,
                items:       d.items,
                totalQuantity,
                orderTotal,
                commissionRate:   0,
                commissionType:   'PERCENT',
                commissionAmount: 0,
                originalDocumentUrl: d.originalDocument ?? null,
                status: 'PROFORMA',
              });
              if (soErr) throw new Error(soErr.message);

              const { error: pfErr } = await supabase.from('commissions_proformas').insert({
                id:            piId,
                company_id:    companyId ?? '',
                contract_id:   orderId,
                pi_number:     d.orderNumber,
                pi_date:       now.slice(0, 10),
                seller:        d.sellerName,
                buyer:         d.customerName,
                incoterm:      d.incoterm || null,
                payment_terms: d.paymentTerms || null,
                pod:           d.pod || null,
                items:         d.items,
                total:         orderTotal,
                status:        'FINAL',
              });
              if (pfErr) throw new Error(pfErr.message);

              toast.push({ kind: 'success', title: 'Proforma created', description: d.orderNumber });
              void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
            },
          }}
        />
      )}
    </>
  );
};

// ── New-invoice OCR (list-level entry point on Invoiced tab) ──────
//
// Creates both a commission_sales_orders row AND a
// commission_customer_invoices row in one shot — for when an invoice
// arrives without a prior proposal/offer/proforma on file.

const NewInvoiceButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}
        className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-8 px-3 text-[12.5px]">
        <Sparkles size={12} className="mr-1.5" />
        OCR new invoice
      </Button>

      {open && (
        <AiUploadModal<CustomerInvoiceDraft>
          open={open}
          onOpenChange={setOpen}
          config={{
            title: 'OCR commercial invoice',
            description: 'Drop the commercial invoice PDF. A commission sales order is created alongside the invoice, both in INVOICED status.',
            emptyDraft: () => ({
              invoiceNumber: '',
              invoiceDate:   new Date().toISOString().slice(0, 10),
              sellerName: '', customerName: '',
              incoterm: '', paymentTerms: '',
              pol: '', pod: '',
              bookingNumber: '',
              items: [], originalDocument: null,
            }),
            fromExtracted: (d) => d,
            extractSpec: { prompt: CUSTOMER_INV_PROMPT, normalize: normalizeCustomerInvoice },
            extractSummary: d => [d.invoiceNumber, d.customerName, `${d.items.length} items`].filter(Boolean).join(' · '),
            validate: d => {
              if (!d.invoiceNumber.trim()) return 'Invoice # is required.';
              if (!d.sellerName.trim())    return 'Seller is required.';
              if (!d.customerName.trim())  return 'Customer is required.';
              return null;
            },
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
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Seller</Label>
                  <SupabaseSelectField value={d.sellerName} onPick={(v) => setD({ ...d, sellerName: v })}
                    placeholder="Pick seller…" allowFreeText showResolvedLabel
                    source={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Customer</Label>
                  <SupabaseSelectField value={d.customerName} onPick={(v) => setD({ ...d, customerName: v })}
                    placeholder="Pick customer…" allowFreeText showResolvedLabel
                    source={{ table: 'customers', valueColumn: 'name', secondaryColumn: 'nickname', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</Label>
                  <StaticSelect value={d.incoterm} options={INCOTERMS} mono
                    onChange={v => setD({ ...d, incoterm: v })} placeholder="Incoterm…" />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Payment terms</Label>
                  <SupabaseSelectField value={d.paymentTerms} onPick={(v) => setD({ ...d, paymentTerms: v })}
                    placeholder="Pick terms…" allowFreeText
                    source={{ table: 'payment_terms', valueColumn: 'code', labelColumn: 'description', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POL</Label>
                  <SupabaseSelectField value={d.pol} onPick={(v) => setD({ ...d, pol: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">POD</Label>
                  <SupabaseSelectField value={d.pod} onPick={(v) => setD({ ...d, pod: v })}
                    placeholder="Pick port…" allowFreeText mono
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }} />
                </FormField>
                <FormField>
                  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Booking #</Label>
                  <Input value={d.bookingNumber}
                    onChange={e => setD({ ...d, bookingNumber: e.target.value })}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
                </FormField>
                {d.items.length > 0 && (
                  <div className="col-span-2">
                    <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                      Line items ({d.items.length}) — Qty is priced units; Bales is the package count
                    </Label>
                    <div className="mt-1 rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f] text-[11.5px]">
                      <div className="grid grid-cols-[1fr_90px_90px_55px_70px_60px_80px_85px] gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                        <div>Description</div>
                        <div className="text-right">Net Weight</div>
                        <div className="text-right">Gross Weight</div>
                        <div className="text-right">Unit</div>
                        <div className="text-right">Bales</div>
                        <div className="text-right">Vol unit</div>
                        <div className="text-right">Unit price</div>
                        <div className="text-right">Total</div>
                      </div>
                      {d.items.map((it, i) => (
                        <div key={i} className="grid grid-cols-[1fr_90px_90px_55px_70px_60px_80px_85px] gap-2 px-2 py-1.5 items-center">
                          <span className="text-slate-200 truncate" title={it.description}>{it.description}</span>
                          <Input type="number" min={0} step="any" value={it.quantity || 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setD({ ...d, items: d.items.map((x, j) => j === i ? {
                                ...x, quantity: v,
                                netLbs: (x.unit ?? '').toLowerCase().startsWith('lb') ? (v || undefined) : x.netLbs,
                                netKg:  (x.unit ?? '').toLowerCase().startsWith('kg') ? (v || undefined) : x.netKg,
                              } : x) });
                            }}
                            className="h-7 text-[11.5px] bg-[#0a0a0a] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right" />
                          <Input type="number" min={0} step="any" value={Number(it.grossLbs) || 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setD({ ...d, items: d.items.map((x, j) => j === i ? {
                                ...x, grossLbs: v || undefined,
                                grossKg: v > 0 ? v / 2.20462 : undefined,
                              } : x) });
                            }}
                            className="h-7 text-[11.5px] bg-[#0a0a0a] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right" />
                          <select value={it.unit ?? 'Lbs'}
                            onChange={e => setD({ ...d, items: d.items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) })}
                            className="h-7 text-[11px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-300 font-mono px-1 outline-none">
                            {['Lbs','Kgs','MT'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <Input type="number" min={0} step="any" value={it.volumeCount ?? 0}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setD({ ...d, items: d.items.map((x, j) => j === i ? { ...x, volumeCount: v || undefined } : x) });
                            }}
                            className="h-7 text-[11.5px] bg-[#0a0a0a] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right" />
                          <select value={it.volumeUnit ?? 'Bales'}
                            onChange={e => setD({ ...d, items: d.items.map((x, j) => j === i ? { ...x, volumeUnit: e.target.value } : x) })}
                            className="h-7 text-[11px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-300 font-mono px-1 outline-none">
                            {['Bales','Bags','Pcs','Sets','Drums'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <span className="text-right font-mono tabular-nums text-slate-300">{fmtMoney(it.unitPrice)}</span>
                          <span className="text-right font-mono tabular-nums text-slate-100">{fmtMoney(it.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ),
            save: async (d) => {
              const totalQuantity = d.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
              const orderTotal    = d.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
              const supabase = getSupabaseClient();
              const orderId   = `CSO-${Date.now()}`;
              const invoiceId = `CCI-${Date.now()}`;
              const now = new Date().toISOString();

              const { error: soErr } = await supabase.from('commission_sales_orders').insert({
                id: orderId,
                companyId,
                createdAt:   now,
                orderNumber: d.invoiceNumber,
                sellerName:  d.sellerName,
                customerName: d.customerName,
                incoterm:    d.incoterm || null,
                paymentTerms: d.paymentTerms || null,
                pol:         d.pol || null,
                pod:         d.pod || null,
                bookingNumber: d.bookingNumber || null,
                items:       d.items,
                totalQuantity,
                orderTotal,
                commissionRate:   0,
                commissionType:   'PERCENT',
                commissionAmount: 0,
                invoiceNumber: d.invoiceNumber,
                invoiceStatus: 'INVOICED',
                status: 'INVOICED',
              });
              if (soErr) throw new Error(soErr.message);

              const { error: invErr } = await supabase.from('commission_customer_invoices').insert({
                id: invoiceId,
                companyId,
                createdAt: now,
                invoiceNumber: d.invoiceNumber,
                invoiceDate:   d.invoiceDate,
                sellerName:    d.sellerName,
                customerName:  d.customerName,
                incoterm:      d.incoterm || null,
                paymentTerms:  d.paymentTerms || null,
                pol:           d.pol || null,
                pod:           d.pod || null,
                bookingNumber: d.bookingNumber || null,
                soNumber:      d.invoiceNumber,
                items:         d.items,
                totalAmount:   orderTotal,
                status:        'ISSUED',
              });
              if (invErr) throw new Error(invErr.message);

              toast.push({ kind: 'success', title: 'Invoice created', description: d.invoiceNumber });
              void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
            },
          }}
        />
      )}
    </>
  );
};

// ── Manual proposal add (no OCR) ─────────────────────────────────
//
// Side-drawer form for entering a supplier proposal by hand. Reuses
// EditableOrderForm (with seller sourced from suppliers — proposals
// come FROM suppliers in this flow). On save inserts a single
// commission_sales_orders row in PROPOSAL status; the page's
// pendingOpenId effect drops the user straight into the workflow
// drawer for further refinement.

const AddProposalManualButton: React.FC<{ onCreated?: (orderId: string) => void }>
  = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  const emptyForm = (): EditableOrderFormState => ({
    sellerName: '',
    customerName: '',
    incoterm: '',
    paymentTerms: '',
    pod: '',
    deliveryDate: '',
    items: [],
  });

  const [form, setForm] = useState<EditableOrderFormState>(emptyForm);
  const [orderNumber, setOrderNumber] = useState('');
  const initRef = useRef(false);

  // Auto-numbering: PROP-NNNNN, derived from the highest existing
  // PROP-NNNNN orderNumber on commission_sales_orders.
  const maxPropQuery = useQuery<number>({
    queryKey: ['commission_sales_orders_max_prop'],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('commission_sales_orders')
        .select('orderNumber')
        .ilike('orderNumber', 'PROP-%');
      if (error) throw new Error(error.message);
      let max = 0;
      for (const row of (data ?? []) as Array<{ orderNumber: string | null }>) {
        const m = (row.orderNumber ?? '').match(/^PROP-(\d+)$/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      return max;
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) { initRef.current = false; return; }
    setForm(emptyForm());
    setOrderNumber('');
    initRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initRef.current) return;
    if (maxPropQuery.data === undefined) return;
    initRef.current = true;
    const next = Math.max(maxPropQuery.data, 0) + 1;
    setOrderNumber(`PROP-${String(next).padStart(5, '0')}`);
  }, [open, maxPropQuery.data]);

  const patch = buildPatchFromForm(form);
  const totalAmount = patch.orderTotal as number;
  const totalQty    = patch.totalQuantity as number;

  const save = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!orderNumber.trim())       throw new Error('Order # is required.');
      if (!form.sellerName.trim())   throw new Error('Seller is required.');
      if (!form.customerName.trim()) throw new Error('Customer is required.');

      const supabase = getSupabaseClient();
      const id = `CSO-${Date.now()}`;
      const { error } = await supabase.from('commission_sales_orders').insert({
        id,
        companyId,
        createdAt: new Date().toISOString(),
        orderNumber: orderNumber.trim(),
        ...patch,
        commissionRate:   0,
        commissionType:   'PERCENT',
        commissionAmount: 0,
        status: 'PROPOSAL',
      });
      if (error) throw new Error(error.message);
      onCreated?.(id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['commission_sales_orders_max_prop'] });
      toast.push({ kind: 'success', title: 'Offer created', description: orderNumber });
      setOpen(false);
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }),
  });

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-indigo-600 hover:bg-indigo-500 h-7 px-2.5 text-[12px] text-white"
      >
        <Plus size={12} className="mr-1" /> Add offer
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Add offer"
        description="Manual entry — saves the supplier offer to commission_sales_orders."
        widthClass="w-[min(96vw,860px)]"
        footer={(
          <>
            <Button
              size="sm"
              onClick={() => setOpen(false)}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={save.isPending}
              className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px] text-white ml-auto"
            >
              <CheckCircle2 size={12} className="mr-1.5" /> Save offer
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Order #</Label>
              <Input value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
            </FormField>
          </div>

          <EditableOrderForm form={form} setForm={setForm} totalAmount={totalAmount}
            sellerSource={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Order total</div>
              <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{fmtMoney(totalAmount)}</div>
            </div>
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total quantity (Lbs)</div>
              <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{totalQty.toLocaleString('en-US')}</div>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
};

// ── Manual proforma add (no OCR) ─────────────────────────────────
//
// Side-drawer form for entering a proforma by hand. Reuses the
// workflow drawer's EditableOrderForm so the field set (line items
// included) and behavior match the in-drawer Proforma tab. On save
// inserts a commission_sales_orders row (status='PROFORMA') AND a
// commissions_proformas row (status='FINAL').

const AddProformaManualButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  const emptyForm = (): EditableOrderFormState => ({
    sellerName: '',
    customerName: '',
    incoterm: '',
    paymentTerms: '',
    pod: '',
    deliveryDate: '',
    items: [],
  });

  const [form, setForm] = useState<EditableOrderFormState>(emptyForm);
  const [piNumber, setPiNumber] = useState('');
  const [piDate, setPiDate] = useState(new Date().toISOString().slice(0, 10));
  const [cType, setCType] = useState<CommissionType>('PERCENT');
  const [cRate, setCRate] = useState('');
  const initRef = useRef(false);

  // Auto-numbering: PI-NNNNN format. The next number is one more than
  // the highest existing PI-NNNNN in commissions_proformas, with a
  // floor of 03311 so the first auto-assigned PI is 03312.
  const maxPiQuery = useQuery<number>({
    queryKey: ['commissions_proformas_max_pi'],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('commissions_proformas')
        .select('pi_number')
        .ilike('pi_number', 'PI-%');
      if (error) throw new Error(error.message);
      let max = 0;
      for (const row of (data ?? []) as Array<{ pi_number: string | null }>) {
        const m = (row.pi_number ?? '').match(/^PI-(\d+)$/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      return max;
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      initRef.current = false;
      return;
    }
    setForm(emptyForm());
    setPiNumber('');
    setPiDate(new Date().toISOString().slice(0, 10));
    setCType('PERCENT');
    setCRate('');
    initRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initRef.current) return;
    if (maxPiQuery.data === undefined) return;
    initRef.current = true;
    const next = Math.max(maxPiQuery.data, 3311) + 1;
    setPiNumber(`PI-${String(next).padStart(5, '0')}`);
  }, [open, maxPiQuery.data]);

  const patch = buildPatchFromForm(form);
  const totalAmount = patch.orderTotal as number;
  const totalQty    = patch.totalQuantity as number;

  const rateNum = cRate.trim() === '' ? null : Number(cRate);
  const rateValid = rateNum === null || (Number.isFinite(rateNum) && rateNum >= 0);
  const itemUnit = form.items.find(i => (i.unit ?? '').trim())?.unit ?? null;
  const commissionAmount = rateNum !== null
    ? calcCommissionAmount(cType, rateNum, totalAmount, totalQty, itemUnit)
    : 0;

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (!piNumber.trim())          throw new Error('PI # / Order # is required.');
      if (!form.sellerName.trim())   throw new Error('Seller is required.');
      if (!form.customerName.trim()) throw new Error('Customer is required.');
      if (!rateValid)                throw new Error('Commission rate is invalid.');

      const supabase = getSupabaseClient();
      const orderId = `CSO-${Date.now()}`;
      const piId    = `PF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const now = new Date().toISOString();

      const { error: soErr } = await supabase.from('commission_sales_orders').insert({
        id: orderId,
        companyId,
        createdAt: now,
        orderNumber: piNumber.trim(),
        ...patch,
        commissionRate:   rateNum ?? 0,
        commissionType:   cType,
        commissionAmount,
        status: 'PROFORMA',
      });
      if (soErr) throw new Error(soErr.message);

      const { error: pfErr } = await supabase.from('commissions_proformas').insert({
        id:            piId,
        company_id:    companyId ?? '',
        contract_id:   orderId,
        pi_number:     piNumber.trim(),
        pi_date:       piDate || now.slice(0, 10),
        seller:        form.sellerName.trim(),
        buyer:         form.customerName.trim(),
        incoterm:      form.incoterm || null,
        payment_terms: form.paymentTerms || null,
        pod:           form.pod || null,
        items:         form.items,
        total:         totalAmount,
        status:        'FINAL',
      });
      if (pfErr) throw new Error(pfErr.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['commissions_proformas_max_pi'] });
      toast.push({ kind: 'success', title: 'Proforma created', description: piNumber });
      setOpen(false);
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', description: e.message }),
  });

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-indigo-600 hover:bg-indigo-500 h-7 px-2.5 text-[12px] text-white"
      >
        <Plus size={12} className="mr-1" /> Add proforma
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Add proforma"
        description="Manual entry — saves to commission_sales_orders and commissions_proformas."
        widthClass="w-[min(96vw,860px)]"
        footer={(
          <>
            <Button
              size="sm"
              onClick={() => setOpen(false)}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={save.isPending || !rateValid}
              className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px] text-white ml-auto"
            >
              <CheckCircle2 size={12} className="mr-1.5" /> Save proforma
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">PI # / Order #</Label>
              <Input value={piNumber}
                onChange={e => setPiNumber(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
            </FormField>
            <FormField>
              <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">PI date</Label>
              <Input type="date" value={piDate}
                onChange={e => setPiDate(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono" />
            </FormField>
          </div>

          <EditableOrderForm form={form} setForm={setForm} totalAmount={totalAmount}
            sellerSource={{ table: 'suppliers', valueColumn: 'name', scopeByCompany: true }} />

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Order total</div>
              <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{fmtMoney(totalAmount)}</div>
            </div>
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total quantity (Lbs)</div>
              <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">{totalQty.toLocaleString('en-US')}</div>
            </div>
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Commission</div>
              <div className="font-mono tabular-nums text-[16px] text-emerald-400 mt-1">{fmtMoney(commissionAmount)}</div>
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
        </div>
      </Drawer>
    </>
  );
};

// ── Proforma preview dialog ──────────────────────────────────────
//
// View action on each row — generates the proforma PDF inline (same
// generator used in the workflow drawer's Proforma tab) and exposes
// Download + Email shortcuts. Email opens the standard
// EmailComposeDrawer with a prefilled draft addressed to the
// customer.

const proformaDocNumber = (o: AgentOrderRow): string =>
  /^PI-/i.test(o.orderNumber) ? o.orderNumber : `PI-${o.orderNumber}`;

const proposalDocNumber = (o: AgentOrderRow): string =>
  /^PROP-/i.test(o.orderNumber) ? o.orderNumber : `PROP-${o.orderNumber}`;

const isProposalStage = (o: AgentOrderRow): boolean => o.stage === 'PROPOSAL';

// Opens an originalDocumentUrl in a new tab. data: URLs are converted
// to a blob URL first because Chrome/Safari block top-level navigation
// to data: URIs and a popup-blocker swallows window.open(dataUrl).
function openOriginalDocument(url: string): void {
  if (!url) return;
  if (url.startsWith('data:')) {
    try {
      const [meta, b64] = url.split(',', 2);
      const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
      const isB64 = /;base64/i.test(meta);
      const bytes = isB64 ? atob(b64) : decodeURIComponent(b64);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
      window.open(blobUrl, '_blank', 'noopener');
      return;
    } catch {
      // fall through to the raw URL — at worst the browser shows nothing.
    }
  }
  window.open(url, '_blank', 'noopener');
}

const buildProformaEmailDraft = (order: AgentOrderRow): EmailDraft => {
  const docNumber = proformaDocNumber(order);
  return {
    to: '',
    subject: `Proforma ${docNumber} — ${order.customerName}`,
    body: [
      `Dear ${order.customerName},`,
      '',
      `Please find attached our proforma ${docNumber}.`
      + ` Total: ${fmtMoney(order.orderTotal)} under ${order.incoterm || 'standard'} incoterms`
      + `${order.paymentTerms ? `, ${order.paymentTerms}` : ''}.`,
      '',
      'Thank you for your business.',
    ].join('\n'),
    contextLabel: `Proforma · ${order.orderNumber}`,
  };
};

const buildProposalEmailDraft = (
  order: AgentOrderRow,
  labels: ProposalLabels | null,
): EmailDraft => {
  const docNumber = proposalDocNumber(order);
  const title = (labels?.title ?? '').trim() || 'Commercial Proposal';
  const intro = (labels?.intro ?? '').trim();
  const closing = (labels?.closing ?? '').trim();
  return {
    to: '',
    subject: `${title} ${docNumber} — ${order.sellerName}`,
    body: [
      `Dear ${order.customerName},`,
      '',
      intro || `Please find attached our proposal ${docNumber}.`
        + ` Total: ${fmtMoney(order.orderTotal)} under ${order.incoterm || 'standard'} incoterms`
        + `${order.paymentTerms ? `, ${order.paymentTerms}` : ''}.`,
      '',
      closing || 'We look forward to your feedback.',
    ].join('\n'),
    contextLabel: `Proposal · ${order.orderNumber}`,
  };
};

const toPartyDetails = (
  row: { name?: string | null; taxId?: string | null; contactPerson?: string | null;
         email?: string | null; phone?: string | null; location?: string | null;
         city?: string | null; state?: string | null; zip?: string | null;
         country?: string | null } | undefined,
): AgentPartyDetails | null => row ? {
  name: row.name, taxId: row.taxId, contactPerson: row.contactPerson,
  email: row.email, phone: row.phone, location: row.location,
  city: row.city, state: row.state, zip: row.zip, country: row.country,
} : null;

const ProformaPreviewDialog: React.FC<{
  order: AgentOrderRow | null;
  onOpenChange: (open: boolean) => void;
  onEmail: (draft: EmailDraft) => void;
}> = ({ order, onOpenChange, onEmail }) => {
  const toast = useToast();
  const suppliers    = useSuppliers();
  const customers    = useCustomers();
  const paymentTerms = usePaymentTerms();
  const ports        = usePorts();
  const [url, setUrl]         = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [labels, setLabels]   = useState<ProposalLabels | null>(null);

  const seller = useMemo(() => {
    if (!order) return null;
    const match = (suppliers.data ?? []).find(
      s => (s.name ?? '').trim().toLowerCase() === (order.sellerName ?? '').trim().toLowerCase(),
    );
    return toPartyDetails(match);
  }, [order, suppliers.data]);

  const buyer = useMemo(() => {
    if (!order) return null;
    const match = (customers.data ?? []).find(
      c => (c.name ?? '').trim().toLowerCase() === (order.customerName ?? '').trim().toLowerCase(),
    );
    return toPartyDetails(match);
  }, [order, customers.data]);

  const paymentTermsLabel = useMemo(() => {
    if (!order?.paymentTerms) return null;
    const code = order.paymentTerms.trim().toLowerCase();
    const match = (paymentTerms.data ?? []).find(t => (t.code ?? '').trim().toLowerCase() === code);
    return match?.description ?? null;
  }, [order, paymentTerms.data]);

  const podLabel = useMemo(() => {
    if (!order?.pod) return null;
    const code = order.pod.trim().toLowerCase();
    const match = (ports.data ?? []).find(p => (p.code ?? '').trim().toLowerCase() === code);
    return match?.name ?? null;
  }, [order, ports.data]);

  // Fetch localized labels for Proposal-stage rows once per order open.
  // Failure is silent — the proposal PDF falls back to English. No
  // round-trip when the order is on a non-Proposal stage.
  useEffect(() => {
    if (!order) { setLabels(null); return; }
    if (!isProposalStage(order)) { setLabels(null); return; }
    const country = (buyer?.country ?? '').trim();
    if (!country) { setLabels(null); return; }
    let cancelled = false;
    void generateProposalLabels(order.sellerName, order.customerName, country)
      .then(res => { if (!cancelled) setLabels(res); })
      .catch(() => { if (!cancelled) setLabels(null); });
    return () => { cancelled = true; };
  }, [order?.id, buyer?.country]);

  useEffect(() => {
    if (!order) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
      setError(null);
      return;
    }
    // Wait for the lookup queries before rendering — otherwise the
    // first preview shows name-only and a refresh later replaces it,
    // which is jarring.
    if (suppliers.isLoading || customers.isLoading
        || paymentTerms.isLoading || ports.isLoading) {
      setPending(true);
      return;
    }
    setPending(true);
    try {
      const docDate = new Date().toISOString().slice(0, 10);
      const doc = isProposalStage(order)
        ? generateAgentProposalPdf({
            order,
            docNumber: proposalDocNumber(order),
            docDate,
            seller, buyer, paymentTermsLabel, podLabel,
            labels,
          })
        : generateAgentOfferPdf({
            order, kind: 'PROFORMA',
            docNumber: proformaDocNumber(order),
            docDate, seller, buyer, paymentTermsLabel, podLabel,
          });
      const next = URL.createObjectURL(doc.output('blob'));
      if (url) URL.revokeObjectURL(url);
      setUrl(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, seller, buyer, paymentTermsLabel, podLabel, labels,
      suppliers.isLoading, customers.isLoading,
      paymentTerms.isLoading, ports.isLoading]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!order) return null;

  const proposalMode = isProposalStage(order);
  const docNumber = proposalMode ? proposalDocNumber(order) : proformaDocNumber(order);

  const download = () => {
    try {
      const docDate = new Date().toISOString().slice(0, 10);
      const doc = proposalMode
        ? generateAgentProposalPdf({
            order, docNumber, docDate,
            seller, buyer, paymentTermsLabel, podLabel, labels,
          })
        : generateAgentOfferPdf({
            order, kind: 'PROFORMA', docNumber, docDate,
            seller, buyer, paymentTermsLabel, podLabel,
          });
      doc.save(`${docNumber}.pdf`);
    } catch (err) {
      toast.push({ kind: 'error', title: 'Download failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const emailNow = () => {
    onEmail(proposalMode
      ? buildProposalEmailDraft(order, labels)
      : buildProformaEmailDraft(order));
  };

  return (
    <Dialog.Root open={!!order} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-[65] w-[min(96vw,960px)] h-[92vh] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col">
          <div className="px-4 py-2.5 border-b border-[#1f1f1f] flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[13.5px] font-semibold text-slate-100 truncate">
                {proposalMode ? 'Proposal' : 'Proforma'} {docNumber}
              </Dialog.Title>
              <Dialog.Description className="text-[11.5px] text-slate-500 truncate">
                {order.customerName} · {fmtMoney(order.orderTotal)}
              </Dialog.Description>
            </div>
            <Button
              size="sm"
              onClick={emailNow}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12.5px]"
            >
              <Mail size={12} className="mr-1.5" /> Email
            </Button>
            <Button
              size="sm"
              onClick={download}
              className="bg-indigo-600 hover:bg-indigo-500 h-8 px-3 text-[12.5px] text-white"
            >
              <Download size={12} className="mr-1.5" /> Download
            </Button>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0 bg-[#111111]">
            {error ? (
              <div className="h-full flex items-center justify-center text-center p-8">
                <div className="max-w-sm">
                  <AlertCircle size={28} className="mx-auto mb-3 text-red-400" />
                  <div className="text-[13px] font-medium text-slate-100 mb-1">Couldn't generate preview</div>
                  <div className="text-[11.5px] text-slate-500">{error}</div>
                </div>
              </div>
            ) : pending || !url ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-[12px]">
                <Loader2 size={14} className="animate-spin mr-2" /> Rendering PDF…
              </div>
            ) : (
              <iframe
                src={url}
                title={`${proposalMode ? 'Proposal' : 'Proforma'} ${docNumber}`}
                className="w-full h-full bg-white"
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default AgentSalesOrdersV2;
