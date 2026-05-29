// Phase 3B — Purchase Order editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, RefreshCw, Upload, FileText, ExternalLink, X } from 'lucide-react';
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
import { useEditor } from '../providers/EditorProvider';
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

// Read a file (PDF/image) into a base64 data URL — same approach the
// ExpensePaymentDrawer uses for payment receipts. Lets us persist the
// proforma directly in a TEXT column without setting up Supabase
// Storage buckets / RLS for a single field.
const readAsDataUrl = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(f);
  });

// Inspect a `data:<mime>;base64,…` URL and return the MIME slice. We
// use this to pick the right viewer (iframe for PDFs, plain <img> for
// images) and a sensible download filename extension.
const inferDataUrlMime = (url: string): string => {
  const m = url.match(/^data:([^;,]+)[;,]/i);
  return m ? m[1].toLowerCase() : '';
};

interface Props {
  po: PurchaseOrder | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const PurchaseOrderDrawer: React.FC<Props> = ({ po, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  // App-level proforma viewer — we close THIS drawer and hand the
  // modal to AppV2 instead of rendering it locally. That resolves the
  // "Close button stuck behind drawer overlay" issue that no amount
  // of z-index work fully fixed.
  const { openProformaViewer } = useEditor();
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
  // Supplier proforma invoice — attached as a base64 data URL so it
  // travels in the row itself. Label is a short "filename · 23 KB"
  // hint shown in the drop-zone after a successful upload.
  const [proformaUrl, setProformaUrl]           = useState<string | null>(null);
  const [proformaLabel, setProformaLabel]       = useState<string | null>(null);
  const [proformaDragOver, setProformaDragOver] = useState(false);
  const [proformaUploading, setProformaUploading] = useState(false);
  const proformaInputRef = useRef<HTMLInputElement>(null);

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
    setProformaUrl(po.proformaInvoiceUrl ?? null);
    // Existing PO with a saved proforma — we don't know the original
    // filename, just that one is attached. The drop-zone shows
    // "Proforma attached" instead of the file label in that case.
    setProformaLabel(null);
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

  // Convert the picked/dropped file to a data URL and stage it for
  // saving. We do NOT auto-save the PO here — the user still has to
  // click Save (matches the rest of the drawer's behaviour: edits
  // accumulate, then one Save commits everything). Soft cap at 5 MB
  // so we don't blow the row size on a 50 MB scan; toast on overflow.
  const PROFORMA_MAX_BYTES = 5 * 1024 * 1024;
  const onProformaPick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.size > PROFORMA_MAX_BYTES) {
      toast.push({
        kind: 'warning',
        title: 'File too large',
        description: `${Math.round(f.size / 1024 / 1024)} MB — keep proformas under 5 MB.`,
      });
      return;
    }
    setProformaUploading(true);
    try {
      const dataUrl = await readAsDataUrl(f);
      setProformaUrl(dataUrl);
      setProformaLabel(`${f.name} · ${Math.round(f.size / 1024)} KB`);
      toast.push({
        kind: 'success',
        title: 'Proforma attached',
        description: 'Save the PO to persist the change.',
      });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not read file',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProformaUploading(false);
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
    proformaInvoiceUrl: proformaUrl,
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

  // Filename for the downloaded proforma — built from PO id + supplier
  // so the user's downloads folder stays scannable. Extension matches
  // the data URL's MIME ("pdf" for PDFs, fallback to "bin").
  const proformaFilename = (): string => {
    const ext = inferDataUrlMime(proformaUrl ?? '').split('/')[1] || 'bin';
    const poRef = (liveId ?? po?.id ?? 'NEW').replace(/[^\w-]+/g, '_');
    const sup = supplierName.trim().replace(/[^\w-]+/g, '_').slice(0, 40) || 'supplier';
    return `proforma_${poRef}_${sup}.${ext}`;
  };

  // (downloadProforma / emailProforma were used by the in-drawer
  // modal that has since moved to AppV2. The lifted ProformaViewerModal
  // owns Download via its own helper, and Email is handled in AppV2
  // through the existing EmailComposeDrawer.)

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

          {/* Supplier proforma invoice — drop a PDF/image to attach,
              or click the zone to pick a file. When attached, the user
              sees View / Replace / Remove actions. Saved as a data URL
              alongside the rest of the PO fields on the next Save. */}
          <div className={sectionClass}>
            <Label className={labelClass}>Supplier proforma invoice</Label>

            {proformaUrl ? (
              <div
                className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-[12.5px] text-emerald-300 min-w-0">
                  <FileText size={14} className="shrink-0" />
                  <span className="truncate">
                    {proformaLabel ?? 'Proforma attached'}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (!proformaUrl) return;
                      // Build a self-contained payload using the
                      // drawer's local supplier-resolution context
                      // BEFORE we unmount. The lifted modal can then
                      // render Download + Email without any further
                      // access to drawer state.
                      const r = resolveRecipientsSync({
                        actors: [{ supplierId, supplierName }],
                        customers: [],
                        suppliers: availableSuppliers,
                      });
                      const poRefShort = po?.id ? po.id.slice(0, 12) : 'NEW';
                      openProformaViewer({
                        url: proformaUrl,
                        poRef: (liveId ?? po?.id ?? 'NEW').slice(0, 16),
                        supplierName,
                        downloadFilename: proformaFilename(),
                        emailDraft: {
                          to: r.to.join('; '),
                          cc: r.cc.length ? r.cc.join('; ') : undefined,
                          subject: `Proforma invoice — PO ${poRefShort} (${supplierName})`,
                          body: [
                            `Hello ${supplierName},`,
                            '',
                            `Attached is the proforma invoice for PO ${poRefShort}.`,
                            `Total: ${fmtMoney(total, currency)} · Payment terms: ${paymentTerms}`,
                            '',
                            `(The proforma file "${proformaFilename()}" has been downloaded`,
                            `to your computer — please attach it to this email before sending.)`,
                            '',
                            'Best regards',
                          ].filter(Boolean).join('\n'),
                          contextLabel: `PO ${poRefShort} · proforma`,
                        },
                      });
                      // Close the drawer so the modal renders cleanly
                      // at the app level instead of layered on top.
                      onOpenChange(false);
                    }}
                    title="Preview the proforma with download and email actions"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/10"
                  >
                    <ExternalLink size={11} /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => proformaInputRef.current?.click()}
                    title="Replace the attached proforma"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-slate-300 border border-[#1f1f1f] hover:border-indigo-500/40 hover:text-indigo-200"
                  >
                    <Upload size={11} /> Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Doesn't auto-save — user still has to click
                      // Save on the drawer to commit the removal.
                      setProformaUrl(null);
                      setProformaLabel(null);
                      if (proformaInputRef.current) proformaInputRef.current.value = '';
                      toast.push({
                        kind: 'info',
                        title: 'Proforma cleared',
                        description: 'Save the PO to persist the change.',
                      });
                    }}
                    title="Remove the attached proforma"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-slate-400 border border-[#1f1f1f] hover:border-rose-500/40 hover:text-rose-300"
                  >
                    <X size={11} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setProformaDragOver(true); }}
                onDragLeave={() => setProformaDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setProformaDragOver(false);
                  void onProformaPick(e.dataTransfer.files);
                }}
                onClick={() => proformaInputRef.current?.click()}
                className={
                  'rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-colors ' +
                  (proformaDragOver
                    ? 'border-indigo-400/70 bg-indigo-500/10'
                    : 'border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10')
                }
              >
                {proformaUploading ? (
                  <div className="text-[12.5px] text-indigo-200">Reading file…</div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-[12.5px] text-indigo-200">
                    <div className="flex items-center gap-1.5">
                      <Upload size={13} />
                      <span className="font-medium">Drop the supplier proforma here</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      PDF or image — up to 5 MB. Stored on this PO for reference.
                    </span>
                  </div>
                )}
              </div>
            )}

            <input
              ref={proformaInputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={e => {
                void onProformaPick(e.target.files);
                // Reset so picking the same file twice in a row still
                // triggers onChange (browsers skip the event otherwise).
                if (proformaInputRef.current) proformaInputRef.current.value = '';
              }}
            />
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

      {/* Proforma viewer has been lifted to AppV2 — the View button
          on this drawer calls openProformaViewer(payload) and then
          onOpenChange(false), so the modal renders at the app level
          AFTER the drawer is unmounted. Avoids the click-eating
          stacking-context interaction between Radix Dialog and the
          inline modal that fought it for clicks. */}
    </>
  );
};
