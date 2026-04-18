// Phase 3B — Sales Order editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { SalesOrder } from '../queries/useSalesOrders';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';
import type { EditorMode } from '../providers/EditorProvider';

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'BOOKED'];
const ORDER_TYPES = ['SPOT', 'CONTRACT'];
const SALE_TYPES = ['LOCAL', 'EXPORT'];
const INCOTERMS = ['FOB', 'CFR', 'CIF', 'EXW', 'DAP', 'DDP', 'FCA', 'CPT', 'CIP', 'FAS'];
const DELIVERY_METHODS = ['PICKUP', 'DELIVERY', 'DOOR_TO_PORT', 'PORT_TO_DOOR', 'DOOR_TO_DOOR'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'CNY', 'INR'];
const PAYMENT_TERMS = [
  'Net 30 Days', 'Net 60 Days', 'Prepaid', 'L/C at Sight', 'L/C 60 Days',
  'Cash Against Documents', 'Cash on Delivery',
  'T/T 30 Days After B/L', '100% T/T in Advance',
  '40% Advance + 60% Cash Against Documents', '50% Advance + 50% on Cash Against Documents',
  '30% Advance + 70% on Cash Against Documents',
  'Advance + Cash Against Documents',
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
  order: SalesOrder | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const SalesOrderDrawer: React.FC<Props> = ({ order, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();

  // Header
  const [companyId, setCompanyId]           = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [orderNumber, setOrderNumber]       = useState('');
  const [customerId, setCustomerId]         = useState('');
  const [customerName, setCustomerName]     = useState('');
  const [orderDate, setOrderDate]           = useState<string>(new Date().toISOString().slice(0, 10));
  const [orderType, setOrderType]           = useState('SPOT');
  const [status, setStatus]                 = useState('PENDING');
  const [saleType, setSaleType]             = useState('LOCAL');

  // Items
  const [items, setItems] = useState<LineItem[]>([]);

  // Commercial
  const [currency, setCurrency]             = useState('USD');
  const [paymentTerms, setPaymentTerms]     = useState('Net 30 Days');
  const [incoterm, setIncoterm]             = useState('FOB');

  // Delivery
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryDate, setDeliveryDate]     = useState('');
  const [pod, setPod]                       = useState('');
  const [poa, setPoa]                       = useState('');
  const [pickupLocation, setPickupLocation] = useState('');

  // Banking / notify party
  const [bankId, setBankId]                 = useState('');
  const [notifyPartyId, setNotifyPartyId]   = useState('');
  const [notifyPartyName, setNotifyPartyName] = useState('');

  // Notes / signatures
  const [notes, setNotes]                   = useState('');
  const [createdBy, setCreatedBy]           = useState('');
  const [approvedBy, setApprovedBy]         = useState('');

  // UX
  const [confirmDelete, setConfirmDelete]   = useState(false);
  const [emailDraft, setEmailDraft]         = useState<EmailDraft | null>(null);

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders', 'dashboardStats'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders', 'dashboardStats'],
    idPrefix: 'SO',
    // sales_orders does have createdAt in schema; keep default.
  });
  const del = useEntityDelete({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders', 'dashboardStats'],
  });

  useEffect(() => {
    if (!order) return;
    setCompanyId(order.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setOrderNumber(order.orderNumber ?? '');
    setCustomerId(order.customerId ?? '');
    setCustomerName(order.customerName ?? '');
    setOrderDate(order.orderDate ?? new Date().toISOString().slice(0, 10));
    setOrderType(order.orderType ?? 'SPOT');
    setStatus(order.status ?? 'PENDING');
    setSaleType(order.saleType ?? 'LOCAL');
    setItems(order.items ?? []);
    setCurrency(order.currency ?? 'USD');
    setPaymentTerms(order.paymentTerms ?? 'Net 30 Days');
    setIncoterm(order.incoterm ?? 'FOB');
    setDeliveryMethod(order.deliveryMethod ?? '');
    setDeliveryAddress(order.deliveryAddress ?? '');
    setDeliveryDate(order.deliveryDate ?? '');
    setPod(order.pod ?? '');
    setPoa(order.poa ?? '');
    setPickupLocation(order.pickupLocation ?? '');
    setBankId(order.bankId ?? '');
    setNotifyPartyId(order.notifyPartyId ?? '');
    setNotifyPartyName(order.notifyPartyName ?? '');
    setNotes(order.notes ?? '');
    setCreatedBy(order.createdBy ?? '');
    setApprovedBy(order.approvedBy ?? '');
  }, [order?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const availableCustomers = customers.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const subtotal = useMemo(() => computeSubtotal(items), [items]);

  const canSave = customerName.trim() !== '' && orderNumber.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    const c = availableCustomers.find(c => c.id === id);
    if (c) {
      setCustomerName(c.name);
      if (c.paymentTerms) setPaymentTerms(c.paymentTerms);
      if (c.pod) setPod(c.pod);
    }
  };

  const selectNotifyParty = (id: string) => {
    setNotifyPartyId(id);
    const c = availableCustomers.find(c => c.id === id);
    if (c) setNotifyPartyName(c.name);
  };

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    customerId: customerId || null,
    customerName: customerName.trim(),
    orderNumber: orderNumber.trim(),
    orderDate: orderDate || null,
    orderType: orderType || null,
    status,
    saleType: saleType || null,
    items: sanitizeItems(items),
    totalAmount: subtotal,
    currency,
    paymentTerms: paymentTerms || null,
    incoterm: incoterm || null,
    deliveryMethod: deliveryMethod || null,
    deliveryAddress: deliveryAddress || null,
    deliveryDate: deliveryDate || null,
    pod: pod || null,
    poa: poa || null,
    pickupLocation: pickupLocation || null,
    bankId: bankId || null,
    notifyPartyId: notifyPartyId || null,
    notifyPartyName: notifyPartyName || null,
    notes: notes || null,
    createdBy: createdBy || null,
    approvedBy: approvedBy || null,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Order # and customer are required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Sales order created', description: payload.orderNumber });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (order) {
      update.mutate({ id: order.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.orderNumber });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Save failed', description: err.message,
        }),
      });
    }
  };

  const deleteOrder = () => {
    if (!order) return;
    del.mutate(order.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: order.orderNumber });
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
    if (!order && mode !== 'edit') return;
    const selectedCustomer = availableCustomers.find(c => c.id === customerId);
    setEmailDraft({
      to: selectedCustomer?.email ?? '',
      subject: `Sales Order ${orderNumber} — ${customerName}`,
      body: [
        `Hello ${customerName},`,
        '',
        `Please find the details of Sales Order ${orderNumber}:`,
        `Status: ${status}`,
        `Incoterm: ${incoterm}`,
        `Payment terms: ${paymentTerms}`,
        `Items: ${items.length}`,
        `Total: ${fmtMoney(subtotal, currency)}`,
        deliveryDate ? `Delivery: ${deliveryDate}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `SO ${orderNumber}`,
    });
  };

  if (!order) return null;

  return (
    <>
      <Drawer
        open={!!order}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New sales order' : `SO ${order.orderNumber || order.id}`}
        description={mode === 'edit' ? `${customerName} · ${status}` : 'Create a new sales order.'}
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
              {pending ? 'Saving…' : mode === 'create' ? 'Create order' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Header */}
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
                <Label className={labelClass}>Order # <span className="text-red-400 ml-1">*</span></Label>
                <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} placeholder="SO-1234" />
              </FormField>
              <FormField>
                <Label className={labelClass}>Order date</Label>
                <Input type="date" value={orderDate ? orderDate.slice(0, 10) : ''}
                  onChange={e => setOrderDate(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Status</Label>
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Customer <span className="text-red-400 ml-1">*</span></Label>
                <select value={customerId}
                  onChange={e => selectCustomer(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">— typed —</option>
                  {[...availableCustomers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Customer name</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)}
                  className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Order type</Label>
                <select value={orderType} onChange={e => setOrderType(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {ORDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
          </div>

          {/* Line items */}
          <div className={sectionClass}>
            <Label className={labelClass}>Line items</Label>
            <LineItemsEditor
              items={items}
              onChange={setItems}
              currency={currency}
              showHsCode
              showCustomerDescription
            />
          </div>

          {/* Commercial */}
          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Currency</Label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Incoterm</Label>
                <select value={incoterm} onChange={e => setIncoterm(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {INCOTERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Sale type</Label>
                <select value={saleType} onChange={e => setSaleType(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {SALE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
            <FormField>
              <Label className={labelClass}>Payment terms</Label>
              <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                className={inputClass + ' w-full appearance-none'}>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>

          {/* Delivery */}
          <div className={sectionClass}>
            <Label className={labelClass}>Delivery</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Delivery method</Label>
                <select value={deliveryMethod} onChange={e => setDeliveryMethod(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">—</option>
                  {DELIVERY_METHODS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Delivery date</Label>
                <Input type="date" value={deliveryDate ? deliveryDate.slice(0, 10) : ''}
                  onChange={e => setDeliveryDate(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <FormField>
              <Label className={labelClass}>Delivery address</Label>
              <Input value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)}
                className={inputClass} placeholder="Street, city, country" />
            </FormField>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>POA (origin)</Label>
                <Input value={poa} onChange={e => setPoa(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} placeholder="Santos" />
              </FormField>
              <FormField>
                <Label className={labelClass}>POD (destination)</Label>
                <Input value={pod} onChange={e => setPod(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} placeholder="Houston" />
              </FormField>
              <FormField>
                <Label className={labelClass}>Pickup location</Label>
                <Input value={pickupLocation} onChange={e => setPickupLocation(e.target.value)}
                  className={inputClass} placeholder="Address" />
              </FormField>
            </div>
          </div>

          {/* Banking + notify */}
          <div className={sectionClass}>
            <Label className={labelClass}>Banking &amp; notify</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Bank ID</Label>
                <Input value={bankId} onChange={e => setBankId(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} placeholder="BK-0001" />
              </FormField>
              <FormField>
                <Label className={labelClass}>Notify party (customer)</Label>
                <select value={notifyPartyId}
                  onChange={e => selectNotifyParty(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">— none —</option>
                  {[...availableCustomers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            </div>
            {notifyPartyName && (
              <p className="text-[11px] text-slate-500">Notify: {notifyPartyName}</p>
            )}
          </div>

          {/* Notes + signatures */}
          <div className={sectionClass}>
            <Label className={labelClass}>Notes &amp; signatures</Label>
            <FormField>
              <Label className={labelClass}>Notes</Label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed w-full"
                placeholder="Internal notes for this order" />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Created by</Label>
                <Input value={createdBy} onChange={e => setCreatedBy(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Approved by</Label>
                <Input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} className={inputClass} />
              </FormField>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">sales_orders</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${order.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${order?.orderNumber ?? 'order'}?`}
        description="Removes the sales order, its line items and any commission rows that depend on it."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteOrder}
      />

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </>
  );
};
