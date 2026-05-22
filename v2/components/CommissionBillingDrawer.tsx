// Commission Billing sub-drawer.
//
// Launched from the Agent Follow Up "Outstanding" tab when the user
// clicks Email on a row whose commission invoice hasn't been generated
// yet (stage = INVOICED). Encapsulates the multi-invoice selection +
// commission rollup + PDF generation + storage upload + DB write that
// the AgentOrderWorkflowDrawer's UnpaidCommissionTab already does,
// but as a one-screen flow rooted in the follow-up board.
//
// On success the drawer closes and hands a prefilled EmailDraft back
// to the parent so the email composer opens with the supplier email,
// subject, body, and the freshly-uploaded PDF URL.

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mail, X as XIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer, Button, Input, FormField, Label, Badge } from '../primitives';
import { useToast } from '../primitives/Toast';
import { getSupabaseClient } from '../../services/supabase';
import { generateCommissionInvoicePdf, pdfToBlob } from '../services/pdf/commissionInvoicePdf';
import { calcCommissionAmount } from '../lib/agentPipelineStage';
import type { AgentOrderRow, AgentLineItem } from '../queries/useAgentSalesOrders';
import type { EmailDraft } from './EmailComposeDrawer';
import { formatMoney } from '../lib/formatMoney';
import { formatDate as fmtDate } from '../lib/formatDate';

const AGENT_INV_BUCKET = 'commission-invoices';

interface StoredCustomerInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  customerName: string | null;
  sellerName: string | null;
  soNumber: string | null;
  items: unknown;
  totalAmount: number | null;
  currency: string | null;
  createdAt: string | null;
}

/** Minimal parent commission_sales_order shape we need to tell whether
 *  an invoice is already billed (commission PDF stamped on its parent
 *  CSO) and to update every affected CSO when the user generates. */
interface ParentCso {
  id: string;
  orderNumber: string | null;
  status: string | null;
  commissionInvoicePdfUrl: string | null;
  commissionInvoiceNumber: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The full agent order row being billed. Must include commission
   *  rate + type for the rollup math; pass it from the parent's data
   *  cache. */
  order: AgentOrderRow | null;
  /** Resolver from sellerName → supplier email. Same matcher the
   *  parent uses for the simple-email path; passed in so we don't
   *  duplicate fuzzy-name logic across files. */
  resolveSupplierEmail: (sellerName: string) => { email: string | null; matchedName: string | null };
  /** Called once the PDF is generated, uploaded, and the row is
   *  flipped to UNPAID_COMMISSION. The parent should open the
   *  EmailComposeDrawer with the returned draft. */
  onReady: (draft: EmailDraft) => void;
}

function parseAnyItems(raw: unknown): AgentLineItem[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      productName: String(r?.productName ?? r?.description ?? ''),
      description: String(r?.description ?? ''),
      quantity: Number(r?.quantity) || 0,
      unit: typeof r?.unit === 'string' ? r.unit : 'Lbs',
      unitPrice: Number(r?.unitPrice) || 0,
      amount: Number(r?.amount) || 0,
      total: Number(r?.total ?? r?.amount) || (Number(r?.quantity ?? 0) * Number(r?.unitPrice ?? 0)),
    }));
  } catch {
    return [];
  }
}

const inputClass = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';
const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';

export const CommissionBillingDrawer: React.FC<Props> = ({
  open, onOpenChange, order, resolveSupplierEmail, onReady,
}) => {
  const toast = useToast();
  const qc = useQueryClient();

  // Linked commercial invoices to bill commission against. Scope is
  // case/punctuation-tolerant on sellerName + customerName so sibling
  // orders for the same agent + customer all surface — agents usually
  // settle multiple shipments in a single consolidated commission
  // invoice. The parent CSO fetch tells us which invoices are already
  // billed so we can prevent double-billing.
  const norm = (s: string | null | undefined) =>
    String(s ?? '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const sellerNorm = norm(order?.sellerName);
  const customerNorm = norm(order?.customerName);

  const invoices = useQuery<StoredCustomerInvoice[]>({
    enabled: open && !!order,
    queryKey: ['commission_customer_invoices_for_pair', sellerNorm, customerNorm],
    queryFn: async () => {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('commission_customer_invoices')
        .select('id, invoiceNumber, invoiceDate, customerName, sellerName, soNumber, items, totalAmount, currency, createdAt')
        .order('createdAt', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      const list = (data as StoredCustomerInvoice[] | null) ?? [];
      // Apply name normalisation client-side because the DB has too
      // many punctuation/case variants for a single SQL filter.
      return list.filter(i =>
        norm(i.sellerName) === sellerNorm && norm(i.customerName) === customerNorm,
      );
    },
  });

  // Fetch parent CSOs (commission_sales_orders) for every unique
  // soNumber we saw, so we can:
  //   1. know which invoices belong to CSOs that are already billed
  //   2. update every affected CSO on generate (not just `order.id`).
  const soNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const i of invoices.data ?? []) {
      const n = (i.soNumber ?? '').trim();
      if (n) set.add(n);
    }
    return [...set];
  }, [invoices.data]);

  const parents = useQuery<ParentCso[]>({
    enabled: open && soNumbers.length > 0,
    queryKey: ['commission_sales_orders_for_invoices', sellerNorm, customerNorm, soNumbers.join('|')],
    queryFn: async () => {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('commission_sales_orders')
        .select('id, orderNumber, status, commissionInvoicePdfUrl, commissionInvoiceNumber')
        .in('orderNumber', soNumbers);
      if (error) throw new Error(error.message);
      return (data as ParentCso[] | null) ?? [];
    },
  });

  // Map soNumber → parent CSO (assumes 1 active parent per orderNumber).
  const parentBySoNumber = useMemo(() => {
    const m = new Map<string, ParentCso>();
    for (const p of parents.data ?? []) {
      const k = (p.orderNumber ?? '').trim();
      if (k) m.set(k, p);
    }
    return m;
  }, [parents.data]);

  const isAlreadyBilled = (inv: StoredCustomerInvoice): boolean => {
    const p = parentBySoNumber.get((inv.soNumber ?? '').trim());
    if (!p) return false;
    if (p.commissionInvoicePdfUrl) return true;
    const s = (p.status ?? '').toUpperCase();
    return s === 'UNPAID_COMMISSION' || s === 'PAID_COMMISSION';
  };

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [invNumber, setInvNumber] = useState('');
  const [invDate, setInvDate] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset state when the drawer opens for a new row.
  useEffect(() => {
    if (!open || !order) return;
    setInvNumber(order.commissionInvoiceNumber ?? `CI-${order.orderNumber}`);
    setInvDate(order.commissionInvoiceDate ?? new Date().toISOString().slice(0, 10));
    setBusy(false);
  }, [open, order?.id]);

  // Default-select billable invoices only (skip those whose parent
  // CSO has already been billed).
  useEffect(() => {
    if (!invoices.data) return;
    const next: Record<string, boolean> = {};
    for (const inv of invoices.data) {
      next[inv.id] = !isAlreadyBilled(inv);
    }
    setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices.data, parents.data]);

  const rate = order?.commissionRate ?? 0;
  const cType = order?.commissionType ?? 'PERCENT';
  const hasRate = rate > 0;
  const list = invoices.data ?? [];
  const billable = list.filter(inv => !isAlreadyBilled(inv));
  const alreadyBilled = list.filter(inv => isAlreadyBilled(inv));
  const selectedInvoices = billable.filter(inv => selected[inv.id]);

  // Unique parent CSOs touched by the currently-selected invoices.
  const affectedCsos = useMemo(() => {
    const map = new Map<string, ParentCso>();
    for (const inv of selectedInvoices) {
      const p = parentBySoNumber.get((inv.soNumber ?? '').trim());
      if (p?.id) map.set(p.id, p);
    }
    return [...map.values()];
  }, [selectedInvoices, parentBySoNumber]);

  // Allocate commission per parent CSO from that CSO's slice of selected invoices.
  const commissionPerCso = useMemo(() => {
    const result = new Map<string, number>();
    for (const cso of affectedCsos) {
      const slice = selectedInvoices.filter(inv => (inv.soNumber ?? '').trim() === (cso.orderNumber ?? '').trim());
      let total = 0;
      let qty = 0;
      let unit: string | null = null;
      for (const inv of slice) {
        total += inv.totalAmount ?? 0;
        const items = parseAnyItems(inv.items);
        if (!unit) unit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
        qty += items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
      }
      result.set(cso.id, calcCommissionAmount(cType, rate, total, qty, unit ?? undefined));
    }
    return result;
  }, [affectedCsos, selectedInvoices, cType, rate]);

  const { aggregateTotal, aggregateQty, aggregateUnit } = useMemo(() => {
    let total = 0;
    let qty = 0;
    let unit: string | null = null;
    for (const inv of selectedInvoices) {
      total += inv.totalAmount ?? 0;
      const items = parseAnyItems(inv.items);
      if (!unit) unit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
      qty += items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
    }
    return { aggregateTotal: total, aggregateQty: qty, aggregateUnit: unit };
  }, [selectedInvoices]);

  const commissionAmount = order
    ? calcCommissionAmount(cType, rate, aggregateTotal, aggregateQty, aggregateUnit ?? undefined)
    : 0;

  const generate = useMutation<{ pdfUrl: string; csosUpdated: number }, Error, void>({
    mutationFn: async () => {
      if (!order) throw new Error('No order in scope');
      if (!hasRate) throw new Error('Set the commission rate on the Proforma tab first.');
      if (selectedInvoices.length === 0) throw new Error('Select at least one invoice to bill.');
      if (!invNumber.trim()) throw new Error('Invoice number is required.');
      const rolledOrder: AgentOrderRow = {
        ...order,
        orderTotal: aggregateTotal,
        totalQuantity: aggregateQty,
        invoiceNumber: selectedInvoices.map(i => i.invoiceNumber).filter(Boolean).join(', ') || order.invoiceNumber,
      };
      const doc = generateCommissionInvoicePdf({
        order: rolledOrder,
        invoiceNumber: invNumber.trim(),
        invoiceDate: invDate || new Date().toISOString().slice(0, 10),
      });
      const blob = pdfToBlob(doc);
      const path = `${order.id}/${invNumber.trim()}.pdf`;
      const sb = getSupabaseClient();
      const { error: upErr } = await sb.storage
        .from(AGENT_INV_BUCKET)
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: urlData } = sb.storage.from(AGENT_INV_BUCKET).getPublicUrl(path);
      const pdfUrl = urlData.publicUrl;
      // Always include the launching order. Plus every other CSO whose
      // invoices the user selected.
      const csoIds = new Set<string>([order.id]);
      for (const c of affectedCsos) csoIds.add(c.id);
      const commonPatch = {
        commissionInvoiceNumber: invNumber.trim(),
        commissionInvoiceDate:   invDate || new Date().toISOString().slice(0, 10),
        commissionInvoicePdfUrl: pdfUrl,
        status: 'UNPAID_COMMISSION',
      };
      // Update each CSO with its own commissionAmount slice.
      for (const csoId of csoIds) {
        const slice = commissionPerCso.get(csoId);
        const patch = slice && slice > 0
          ? { ...commonPatch, commissionAmount: slice }
          : commonPatch;
        const { error: dbErr } = await sb.from('commission_sales_orders').update(patch).eq('id', csoId);
        if (dbErr) throw new Error(`Save failed (${csoId}): ${dbErr.message}`);
      }
      return { pdfUrl, csosUpdated: csoIds.size };
    },
    onSuccess: ({ pdfUrl, csosUpdated }) => {
      void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
      void qc.invalidateQueries({ queryKey: ['commissions'] });
      void qc.invalidateQueries({ queryKey: ['commission_sales_orders_for_invoices'] });
      if (csosUpdated > 1) {
        toast.push({
          kind: 'info',
          title: `${csosUpdated} orders updated`,
          description: 'Each affected sales order is now stamped with the same commission invoice number.',
        });
      }
      if (!order) return;
      const { email, matchedName } = resolveSupplierEmail(order.sellerName);
      if (!email) {
        toast.push({
          kind: 'warning',
          title: 'No email on file for this agent',
          description: matchedName
            ? `Found supplier "${matchedName}" but no email is set. Add it in Suppliers.`
            : `Agent "${order.sellerName}" is not in the suppliers list.`,
        });
      }
      const draft: EmailDraft = {
        to: email ?? '',
        subject: `Commission invoice ${invNumber.trim()} — ${order.orderNumber}`,
        body: [
          `Dear ${order.sellerName},`,
          '',
          `Please find attached our commission invoice ${invNumber.trim()} for sales order ${order.orderNumber}.`,
          `Commission due: ${formatMoney(commissionAmount, selectedInvoices[0]?.currency ?? 'USD')}.`,
          '',
          `PDF: ${pdfUrl}`,
          '',
          'Kindly remit per the agreed terms.',
        ].join('\n'),
        contextLabel: `Commission invoice · ${order.orderNumber}`,
      };
      toast.push({
        kind: 'success',
        title: 'Commission invoice issued',
        description: `${invNumber.trim()} — opening email…`,
      });
      onOpenChange(false);
      onReady(draft);
    },
    onError: (err) => {
      toast.push({ kind: 'error', title: 'Generate failed', description: err.message });
    },
  });

  const submit = () => { setBusy(true); generate.mutate(undefined, { onSettled: () => setBusy(false) }); };

  if (!order) return null;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={`Bill commission · ${order.sellerName} → ${order.customerName}`}
      description={`Opened from ${order.orderNumber}. All unbilled invoices for this agent + customer pair are listed below — pick which ones to roll into one commission invoice, then generate the PDF and email it.`}
      footer={
        <>
          <Button
            size="sm" variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={busy || !hasRate || selectedInvoices.length === 0 || !invNumber.trim()}
            loading={busy}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {busy
              ? <><Loader2 size={13} className="animate-spin mr-1.5" /> Generating…</>
              : <><Mail size={13} className="mr-1.5" /> Generate & open email</>}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Commission rate read-out */}
        <div className="grid grid-cols-3 gap-2">
          <Card label="Rate">
            <span className="text-[15px] font-mono tabular-nums text-slate-100">
              {hasRate
                ? cType === 'PERCENT'
                  ? `${rate}%`
                  : `$${rate} ${cType === 'PER_LBS' ? '/Lb' : '/Kg'}`
                : '—'}
            </span>
          </Card>
          <Card label="Selected total">
            <span className="text-[15px] font-mono tabular-nums text-slate-100">{formatMoney(aggregateTotal, selectedInvoices[0]?.currency ?? 'USD')}</span>
            <span className="ml-1.5 text-[10px] text-slate-500">
              ({aggregateQty.toLocaleString()} {aggregateUnit ?? ''})
            </span>
          </Card>
          <Card label="Commission due">
            <span className="text-[15px] font-mono tabular-nums text-emerald-300">{formatMoney(commissionAmount, selectedInvoices[0]?.currency ?? 'USD')}</span>
          </Card>
        </div>

        {!hasRate && (
          <div className="text-[11.5px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-2">
            No commission rate set on this order. Open it in the pipeline (Proforma tab) and set the rate first.
          </div>
        )}

        {/* Invoice selector */}
        <div className="space-y-2">
          <div className={labelClass}>
            Invoices for {order.sellerName} → {order.customerName} ({selectedInvoices.length} of {billable.length} billable)
          </div>
          {invoices.isLoading && (
            <div className="text-[12px] text-slate-500 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Loading invoices…
            </div>
          )}
          {!invoices.isLoading && list.length === 0 && (
            <div className="text-[12px] text-slate-500 p-3 border border-[#1f1f1f] rounded-md bg-[#0f0f0f]">
              No commercial invoices on file for this agent + customer pair. Add them in the pipeline's Invoiced tab first.
            </div>
          )}
          {billable.length > 0 && (
            <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] divide-y divide-[#1f1f1f]">
              {billable.map(inv => {
                const items = parseAnyItems(inv.items);
                const qty = items.reduce((q, it) => q + (Number(it.quantity) || 0), 0);
                const unit = items.find(it => (it.unit ?? '').trim())?.unit ?? null;
                const lineCommission = calcCommissionAmount(cType, rate, inv.totalAmount ?? 0, qty, unit ?? undefined);
                const checked = !!selected[inv.id];
                const soNumber = (inv.soNumber ?? '').trim();
                const fromLaunch = soNumber === (order.orderNumber ?? '').trim();
                return (
                  <label
                    key={inv.id}
                    className="grid grid-cols-[20px_1fr_110px_110px_110px] gap-2 items-center px-2.5 py-2 text-[11.5px] cursor-pointer hover:bg-[#141414]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelected(s => ({ ...s, [inv.id]: e.target.checked }))}
                      className="accent-indigo-500"
                    />
                    <div className="min-w-0">
                      <div className="text-slate-100 font-mono truncate">{inv.invoiceNumber ?? inv.id.slice(0, 10)}</div>
                      <div className="text-[10.5px] text-slate-500 truncate flex items-center gap-1.5">
                        <span>SO {soNumber || '—'}</span>
                        {fromLaunch && (
                          <span className="px-1 rounded text-[9.5px] uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">opened</span>
                        )}
                      </div>
                    </div>
                    <span className="text-slate-500 font-mono tabular-nums text-[10.5px] text-right">
                      {fmtDate(inv.invoiceDate ?? inv.createdAt)}
                    </span>
                    <span className="text-slate-100 font-mono tabular-nums text-right">
                      {formatMoney(inv.totalAmount ?? 0, inv.currency ?? 'USD')}
                    </span>
                    <span className="text-emerald-300 font-mono tabular-nums text-right">
                      +{formatMoney(lineCommission, inv.currency ?? 'USD')}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {alreadyBilled.length > 0 && (
            <details className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
              <summary className="cursor-pointer text-[11px] text-slate-500 px-2.5 py-1.5 hover:text-slate-300 select-none">
                Already billed ({alreadyBilled.length}) — shown for reference, can't re-select
              </summary>
              <div className="divide-y divide-[#1f1f1f] bg-[#0f0f0f]">
                {alreadyBilled.map(inv => {
                  const parent = parentBySoNumber.get((inv.soNumber ?? '').trim());
                  return (
                    <div key={inv.id} className="grid grid-cols-[20px_1fr_110px_110px_110px] gap-2 items-center px-2.5 py-1.5 text-[10.5px] text-slate-500">
                      <span className="opacity-30">✓</span>
                      <div className="min-w-0">
                        <div className="font-mono truncate text-slate-400">{inv.invoiceNumber ?? inv.id.slice(0, 10)}</div>
                        <div className="text-[10px] truncate">
                          SO {(inv.soNumber ?? '—').trim()} · CI {parent?.commissionInvoiceNumber ?? '—'}
                        </div>
                      </div>
                      <span className="font-mono tabular-nums text-right">{fmtDate(inv.invoiceDate ?? inv.createdAt)}</span>
                      <span className="font-mono tabular-nums text-right">{formatMoney(inv.totalAmount ?? 0, inv.currency ?? 'USD')}</span>
                      <span className="font-mono tabular-nums text-right opacity-60">billed</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {/* Number + date */}
        <div className="grid grid-cols-2 gap-2">
          <FormField>
            <Label className={labelClass}>Commission invoice #</Label>
            <Input value={invNumber} onChange={e => setInvNumber(e.target.value)}
              className={inputClass + ' font-mono'} />
          </FormField>
          <FormField>
            <Label className={labelClass}>Invoice date</Label>
            <Input type="date" value={invDate.slice(0, 10)}
              onChange={e => setInvDate(e.target.value)}
              className={inputClass} />
          </FormField>
        </div>

        <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
          <Badge variant="info">UNPAID_COMMISSION</Badge>
          <span>
            after generating, {affectedCsos.length > 1 ? `all ${affectedCsos.length} affected sales orders` : 'this sales order'} move to the Outstanding queue with the same stored PDF.
          </span>
        </div>
      </div>
    </Drawer>
  );
};

const Card: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="p-2.5 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
    <div className="mt-0.5">{children}</div>
  </div>
);
