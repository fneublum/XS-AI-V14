// Phase 3B — Purchase Order editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useSuppliers } from '../queries/useSuppliers';
import { PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';
import { SupabaseSelectField } from './SupabaseSelectField';
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
  const [currency, setCurrency]                 = useState('USD');
  const [notes, setNotes]                       = useState('');

  const [confirmDelete, setConfirmDelete]       = useState(false);
  const [emailDraft, setEmailDraft]             = useState<EmailDraft | null>(null);

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
    setCompanyId(po.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setSupplierId(po.supplierId ?? '');
    setSupplierName(po.supplierName ?? '');
    setStatus(po.status ?? 'PENDING');
    setOrderDate(po.orderDate ?? new Date().toISOString().slice(0, 10));
    setExpectedDate(po.expectedDeliveryDate ?? '');
    setPaymentTerms(po.paymentTerms ?? 'Net 30 Days');
    setItems(po.items ?? []);
    setCurrency(po.currency ?? 'USD');
    setNotes(po.notes ?? '');
  }, [po?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const availableSuppliers = suppliers.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const subtotal = useMemo(() => computeSubtotal(items), [items]);

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
    totalAmount: subtotal,
    currency,
    notes: notes || null,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Supplier is required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
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

  const sendEmail = () => {
    const selectedSupplier = availableSuppliers.find(s => s.id === supplierId);
    const poRef = po?.id ? po.id.slice(0, 12) : 'NEW';
    setEmailDraft({
      to: selectedSupplier?.email ?? '',
      subject: `Purchase Order ${poRef} — ${supplierName}`,
      body: [
        `Hello ${supplierName},`,
        '',
        `Please confirm receipt of PO ${poRef}:`,
        `Status: ${status}`,
        `Payment terms: ${paymentTerms}`,
        `Items: ${items.length}`,
        `Total: ${fmtMoney(subtotal, currency)}`,
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
        title={mode === 'create' ? 'New purchase order' : `PO ${po.id.slice(0, 12)}`}
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

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">purchase_orders</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${po.id.slice(0, 8)}`}
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
