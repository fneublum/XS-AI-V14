// Phase 3B — Sales Order editor drawer (create + edit).

import React, { useEffect, useState } from 'react';
import {
  Drawer, Input, FormField, Label, Button, Badge,
} from '../primitives';
import { SalesOrder } from '../queries/useSalesOrders';
import { useUpdateSalesOrder } from '../queries/useSalesOrderMutations';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import type { EditorMode } from '../providers/EditorProvider';

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'APPROVED', 'FULFILLED', 'REJECTED', 'CANCELLED'] as const;

const fmtCurrency = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch { return `${currency} ${n.toLocaleString('en-US')}`; }
};

interface SalesOrderDrawerProps {
  order: SalesOrder | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const SalesOrderDrawer: React.FC<SalesOrderDrawerProps> = ({ order, mode, onOpenChange }) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [status, setStatus] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const update = useUpdateSalesOrder();
  const insert = useEntityInsert<{
    companyId: string; orderNumber: string; customerName: string;
    status: string; totalAmount: number; currency: string;
    orderDate: string; paymentTerms: string | null;
    incoterm: string | null; deliveryDate: string | null;
  }>({ table: 'sales_orders', listQueryKeys: ['salesOrders', 'recentSalesOrders', 'dashboardStats'], idPrefix: 'SO' });

  useEffect(() => {
    if (!order) return;
    setOrderNumber(order.orderNumber ?? '');
    setCustomerName(order.customerName ?? '');
    setTotalAmount(String(order.totalAmount ?? ''));
    setCurrency(order.currency ?? 'USD');
    setStatus(order.status ?? 'DRAFT');
    setPaymentTerms(order.paymentTerms ?? '');
    setIncoterm(order.incoterm ?? '');
    setDeliveryDate(order.deliveryDate ?? '');
  }, [order?.id, mode]);

  const totalNum = Number(totalAmount);
  const totalValid = totalAmount === '' || (Number.isFinite(totalNum) && totalNum >= 0);

  const pending = update.isPending || insert.isPending;

  const dirty = mode === 'create'
    ? customerName.trim().length > 0 && orderNumber.trim().length > 0
    : order && (
        (order.status ?? '') !== status ||
        (order.paymentTerms ?? '') !== paymentTerms ||
        (order.incoterm ?? '') !== incoterm ||
        (order.deliveryDate ?? '') !== deliveryDate
      );

  const onSave = () => {
    if (!order || !totalValid) return;
    if (mode === 'create') {
      const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
      insert.mutate(
        {
          companyId,
          orderNumber,
          customerName,
          status,
          totalAmount: Number.isFinite(totalNum) ? totalNum : 0,
          currency,
          orderDate: new Date().toISOString().slice(0, 10),
          paymentTerms: paymentTerms || null,
          incoterm: incoterm || null,
          deliveryDate: deliveryDate || null,
        },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Order created', description: orderNumber });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
        },
      );
    } else {
      update.mutate(
        {
          id: order.id,
          status,
          paymentTerms: paymentTerms || null,
          incoterm: incoterm || null,
          deliveryDate: deliveryDate || null,
        },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Saved', description: `${order.orderNumber} updated.` });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Update failed', description: err.message }),
        },
      );
    }
  };

  const title = mode === 'create' ? 'New sales order' : (order?.orderNumber || 'Sales order');
  const description = mode === 'create'
    ? 'Create a sales order in the current workspace.'
    : (order?.customerName || undefined);

  return (
    <Drawer
      open={!!order}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            Cancel
          </Button>
          <Button size="sm" onClick={onSave}
            disabled={!dirty || !totalValid || pending}
            loading={pending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      {order && (
        <div className="space-y-5">
          {mode === 'create' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label required>Order #</Label>
                  <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
                    autoFocus
                    placeholder="SO-2026-001"
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums placeholder:text-slate-500" />
                </FormField>
                <FormField>
                  <Label required>Customer</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label>Total</Label>
                  <Input type="number" min={0} step={0.01}
                    value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                    invalid={!totalValid}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
                </FormField>
                <FormField>
                  <Label>Currency</Label>
                  <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())}
                    maxLength={3}
                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
                </FormField>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total</div>
                <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">
                  {fmtCurrency(order.totalAmount, order.currency)}
                </div>
              </div>
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Ordered</div>
                <div className="font-mono tabular-nums text-[13px] text-slate-200 mt-1">
                  {order.orderDate || order.createdAt?.slice(0, 10) || '—'}
                </div>
              </div>
            </div>
          )}

          <FormField>
            <Label>Status</Label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setStatus(opt)}
                  className={
                    opt === status
                      ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                      : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
          </FormField>

          <FormField>
            <Label>Incoterm</Label>
            <Input value={incoterm} onChange={e => setIncoterm(e.target.value)}
              placeholder="CFR, FOB, CIF…"
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 font-mono tabular-nums" />
          </FormField>

          <FormField>
            <Label>Payment terms</Label>
            <Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
              placeholder="e.g. 50% ADV + 50% CAD"
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500" />
          </FormField>

          <FormField>
            <Label>Delivery date</Label>
            <Input type="date"
              value={(deliveryDate ?? '').slice(0, 10)}
              onChange={e => setDeliveryDate(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500" />
          </FormField>

          {mode === 'edit' && (
            <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
              <span>Currency</span>
              <Badge variant="neutral">{order.currency}</Badge>
              <span className="ml-auto font-mono tabular-nums text-slate-600">#{order.id.slice(0, 8)}</span>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};
