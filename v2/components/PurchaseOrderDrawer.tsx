// Phase 3B — Purchase Order editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useSuppliers } from '../queries/useSuppliers';
import { PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { getSupabaseClient } from '../../services/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';
import { resolveRecipientsSync } from '../services/recipients';
import { SupabaseSelectField } from './SupabaseSelectField';
import { nextPONumber } from '../lib/poNumber';
import type { EditorMode } from '../providers/EditorProvider';

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'OPEN', 'RECEIVED', 'COMPLETED', 'CANCELLED'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'CNY', 'INR'];
const PAYMENT_TERMS = [
  'Net 30 Days', 'Net 60 Days', 'Prepaid', 'L/C at Sight', 'L/C 60 Days',
  'Cash Against Documents', 'Cash on Delivery',
  'T/T 30 Days After B/L', '100% T/T in Advance',
  '40% Advance + 60% Cash Against Documents',
  '30% Advance + 70% on Cash Against Documents',
];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';

const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';
const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

const fmtMoney = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch { return `${currency} ${n.toFixed(2)}`; }
};

// Currency-less "99,999.99" formatter for the local-freight input —
// matches the Opening Balance input in Cash Flow. type="number" would
// strip the comma and force a raw "12345" display, which is easy to
// misread; this stays a plain string so commas can persist on blur.
const fmtAmount = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseAmount = (s: string): number => {
  // Strip everything that isn't a digit, dot, or minus.
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

interface Props {
  po: PurchaseOrder | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const PurchaseOrderDrawer: React.FC<Props> = ({ po, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const suppliers = useSuppliers();

  const [companyId, setCompanyId]               = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [supplierId, setSupplierId]             = useState('');
  const [supplierName, setSupplierName]         = useState('');
  const [status, setStatus]                     = useState('PENDING');
  const [orderDate, setOrderDate]               = useState<string>(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate]         = useState('');
  const [paymentTerms, setPaymentTerms]         = useState('Net 30 Days');
  const [items, setItems]                       = useState<LineItem[]>([]);
  // Local freight the buyer owes the supplier (inland freight to port,
  // etc.). Stored separately from line items so reports can tell
  // freight apart from goods. Final PO total = subtotal + freight.
  const [freightAmount, setFreightAmount]       = useState<number>(0);
  // Text draft for the freight input so mid-edit values like "1234.5"
  // can render without commas snapping the caret around. Synced from
  // freightAmount when the PO reloads (see effect below) and on blur.
  const [freightDraft, setFreightDraft]         = useState<string>('');
  const [currency, setCurrency]                 = useState('USD');
  const [notes, setNotes]                       = useState('');

  const [confirmDelete, setConfirmDelete]       = useState(false);
  const [emailDraft, setEmailDraft]             = useState<EmailDraft | null>(null);
  const [regenerating, setRegenerating]         = useState(false);
  // Tracks the current id locally so the renamed PO is reflected in the
  // drawer header without waiting for the parent list to refetch.
  const [liveId, setLiveId]                     = useState<string | null>(null);
  const qc = useQueryClient();

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'purchase_orders', listQueryKeys: ['purchaseOrders'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'purchase_orders', listQueryKeys: ['purchaseOrders'], idPrefix: 'PO',
    withCreatedAt: false,
  });
  const del = useEntityDelete({
    table: 'purchase_orders', listQueryKeys: ['purchaseOrders'],
  });

  useEffect(() => {
    if (!po) return;
    setLiveId(po.id);
    setCompanyId(po.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setSupplierId(po.supplierId ?? '');
    setSupplierName(po.supplierName ?? '');
    setStatus(po.status ?? 'PENDING');
    setOrderDate(po.orderDate ?? new Date().toISOString().slice(0, 10));
    setExpectedDate(po.expectedDeliveryDate ?? '');
    setPaymentTerms(po.paymentTerms ?? 'Net 30 Days');
    setItems(po.items ?? []);
    const freight = Number(po.freightAmount) || 0;
    setFreightAmount(freight);
    // Seed the draft with the formatted value when loading an existing
    // PO; empty string when freight is zero so the placeholder shows.
    setFreightDraft(freight === 0 ? '' : fmtAmount(freight));
    setCurrency(po.currency ?? 'USD');
    setNotes(po.notes ?? '');
  }, [po?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const availableSuppliers = suppliers.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  // Grand total is what the supplier will actually invoice — goods +
  // local freight. Persisted as totalAmount so Cash Flow / Payables
  // pick it up without further changes.
  const total = useMemo(() => subtotal + (Number.isFinite(freightAmount) ? freightAmount : 0), [subtotal, freightAmount]);

  const canSave = supplierName.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const selectSupplier = (id: string) => {
    setSupplierId(id);
    const s = availableSuppliers.find(s => s.id === id);
    if (s) {
      setSupplierName(s.name);
      if (s.paymentTerms) setPaymentTerms(s.paymentTerms);
    }
  };

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    supplierId: supplierId || null,
    supplierName: supplierName.trim(),
    status,
    orderDate: orderDate || null,
    expectedDeliveryDate: expectedDate || null,
    paymentTerms: paymentTerms || null,
    items: sanitizeItems(items),
    freightAmount: Number.isFinite(freightAmount) ? freightAmount : 0,
    totalAmount: total,
    currency,
    notes: notes || null,
  });

  const save = async () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Supplier is required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      // Assign the formatted "PO-NNNNNXX" id ourselves — useEntityInsert
      // honours an explicit `id` field. Failure during the lookup
      // falls through to the random PO-{ts}-{rand} fallback inside
      // newId() so creation never blocks.
      let formattedId: string | null = null;
      try {
        // Pass companyId so nextPONumber can pick PO-GEN-NNNN for GENRYO
        // vs. PO-NNNNNXX for everything else.
        formattedId = await nextPONumber(payload.supplierName, payload.companyId);
      } catch { /* ignore — fall back to random id */ }
      insert.mutate(formattedId ? { ...payload, id: formattedId } : payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Purchase order created', description: payload.supplierName });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (po) {
      update.mutate({ id: po.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.supplierName });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Save failed', description: err.message,
        }),
      });
    }
  };

  const deletePo = () => {
    if (!po) return;
    del.mutate(po.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: po.supplierName });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  // Regenerate the PO id. Useful when OCR landed garbage in the id or
  // the supplier was later changed and the prefix no longer matches.
  // Renames the row's primary key in-place; no foreign key references
  // exist on purchase_orders.id today so this is safe.
  const regenerateId = async () => {
    const currentId = liveId ?? po?.id;
    if (!currentId) return;
    if (mode !== 'edit') return;
    if (!supplierName.trim()) {
      toast.push({ kind: 'warning', title: 'Set supplier first', description: 'The new PO # uses the supplier prefix.' });
      return;
    }
    setRegenerating(true);
    try {
      // Regenerate respects the owning company's format too — a GENRYO PO
      // re-rolls to the next PO-GEN-NNNN, not to the default supplier-prefix
      // pattern.
      const effectiveCompanyId = companyId || (currentCompanyId !== 'ALL' ? currentCompanyId : '');
      const newId = await nextPONumber(supplierName, effectiveCompanyId);
      if (newId === currentId) {
        toast.push({ kind: 'info', title: 'PO # unchanged', description: newId });
        return;
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('purchase_orders')
        .update({ id: newId })
        .eq('id', currentId);
      if (error) throw new Error(error.message);
      setLiveId(newId);
      void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      toast.push({ kind: 'success', title: 'PO # regenerated', description: newId });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Regenerate failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRegenerating(false);
    }
  };

  const sendEmail = () => {
    const r = resolveRecipientsSync({
      actors: [{ supplierId, supplierName }],
      customers: [],
      suppliers: availableSuppliers,
    });
    const poRef = po?.id ? po.id.slice(0, 12) : 'NEW';
    setEmailDraft({
      to: r.to.join('; '),
      cc: r.cc.length ? r.cc.join('; ') : undefined,
      subject: `Purchase Order ${poRef} — ${supplierName}`,
      body: [
        `Hello ${supplierName},`,
        '',
        `Please confirm receipt of PO ${poRef}:`,
        `Status: ${status}`,
        `Payment terms: ${paymentTerms}`,
        `Items: ${items.length}`,
        `Total: ${fmtMoney(total, currency)}`,
        expectedDate ? `Expected delivery: ${expectedDate}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `PO ${poRef}`,
    });
  };

  if (!po) return null;

  return (
    <>
      <Drawer
        open={!!po}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New purchase order' : `PURCHASE ORDER: ${(liveId ?? po.id).slice(0, 16)}`}
        description={mode === 'edit' ? `${supplierName} · ${status}` : 'Create a purchase order.'}
        widthClass="w-[min(98vw,960px)]"
        footer={
          <>
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Delete
              </Button>
            )}
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={sendEmail}
                disabled={pending}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <Mail size={12} /> Email
              </Button>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!canSave || pending}
              loading={pending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create PO' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className={sectionClass}>
            <Label className={labelClass}>Header</Label>
            {isSystem && availableCompanies.length > 0 && (
              <FormField>
                <Label className={labelClass}>Company</Label>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">Select…</option>
                  {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            )}
            {mode === 'edit' && po && (
              // Editable PO #. Same field styling as Supplier / Status / dates
              // so it's obviously interactive. Commits on blur or Enter — runs
              // an UPDATE on purchase_orders.id (the row's primary key). The
              // sibling "Regenerate" button in the footer remains for the
              // "let the system pick a supplier-prefixed id" path.
              <FormField>
                <Label className={labelClass}>PO #</Label>
                <Input
                  type="text"
                  value={liveId ?? po.id ?? ''}
                  onChange={e => setLiveId(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setLiveId(po.id);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={async e => {
                    const next = e.target.value.trim();
                    const current = po.id;
                    // No-op: empty (revert), unchanged, or in-flight save.
                    if (!next) { setLiveId(current); return; }
                    if (next === current) { setLiveId(current); return; }
                    if (regenerating || pending) { setLiveId(current); return; }
                    try {
                      const supabase = getSupabaseClient();
                      const { error } = await supabase
                        .from('purchase_orders')
                        .update({ id: next })
                        .eq('id', current);
                      if (error) throw new Error(error.message);
                      setLiveId(next);
                      void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
                      toast.push({ kind: 'success', title: 'PO # updated', description: next });
                    } catch (err) {
                      setLiveId(current);
                      toast.push({
                        kind: 'error',
                        title: 'Rename failed',
                        description: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }}
                  spellCheck={false}
                  disabled={regenerating || pending}
                  placeholder="e.g. PO-00796KL"
                  className={inputClass + ' font-mono'}
                />
              </FormField>
            )}
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Supplier <span className="text-red-400 ml-1">*</span></Label>
                <select value={supplierId}
                  onChange={e => selectSupplier(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">— typed —</option>
                  {[...availableSuppliers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Supplier name</Label>
                <Input value={supplierName} onChange={e => setSupplierName(e.target.value)}
                  className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Status</Label>
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Order date</Label>
                <Input type="date" value={orderDate ? orderDate.slice(0, 10) : ''}
                  onChange={e => setOrderDate(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Expected delivery</Label>
                <Input type="date" value={expectedDate ? expectedDate.slice(0, 10) : ''}
                  onChange={e => setExpectedDate(e.target.value)} className={inputClass} />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Line items</Label>
            <LineItemsEditor
              items={items}
              onChange={setItems}
              currency={currency}
              showHsCode
              showGrade
            />
            {/* Local freight — buyer-paid inland freight the supplier
                will bill on top of the goods. Kept out of the line
                items so future reports can tell freight apart from
                goods cost. Mirrors invoices_suppliers.freightAmount. */}
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 pt-1">
              <Label className={labelClass}>Local freight</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={freightDraft}
                placeholder="0.00"
                onChange={e => {
                  // Keep the raw draft so commas don't fight the caret
                  // mid-typing. Commit the numeric value immediately so
                  // the Subtotal + Freight = Total footer updates live.
                  const raw = e.target.value;
                  setFreightDraft(raw);
                  setFreightAmount(parseAmount(raw));
                }}
                onBlur={() => {
                  // Reformat to "99,999.99" on blur; empty input stays
                  // empty so the placeholder reappears.
                  setFreightDraft(freightAmount === 0 ? '' : fmtAmount(freightAmount));
                }}
                onFocus={e => e.target.select()}
                className={inputClass + ' w-32 text-right font-mono tabular-nums'}
              />
              <span className="text-[11px] uppercase tracking-wider text-slate-500 w-10 text-right">
                {currency}
              </span>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Currency</Label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Payment terms</Label>
                <SupabaseSelectField
                  source={{
                    table: 'payment_terms',
                    valueColumn: 'description',
                    labelColumn: 'description',
                    secondaryColumn: 'code',
                    scopeByCompany: true,
                  }}
                  value={paymentTerms}
                  onPick={v => setPaymentTerms(v)}
                />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Notes</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed w-full"
              placeholder="Internal notes for this PO" />
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
            <Badge variant="neutral">purchase_orders</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            {freightAmount > 0 && (
              <span className="text-slate-600">
                + Freight <span className="font-mono tabular-nums text-slate-300">{fmtMoney(freightAmount, currency)}</span>
              </span>
            )}
            <span className="text-slate-500">
              = Total <span className="font-mono tabular-nums text-slate-200 font-semibold">{fmtMoney(total, currency)}</span>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="font-mono tabular-nums text-slate-500">
                {mode === 'create' ? 'new' : `# ${liveId ?? po.id}`}
              </span>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={regenerateId}
                  disabled={regenerating || !supplierName.trim() || pending}
                  title={supplierName.trim()
                    ? 'Recompute PO # from the current supplier name'
                    : 'Set supplier first'}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] uppercase tracking-wider text-slate-400 border border-[#1f1f1f] hover:text-indigo-300 hover:border-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={10} className={regenerating ? 'animate-spin' : ''} />
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              )}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete PO ${po?.id.slice(0, 12)}?`}
        description="Removes the purchase order, line items, and may break receipts that depend on it."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deletePo}
      />

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </>
  );
};
