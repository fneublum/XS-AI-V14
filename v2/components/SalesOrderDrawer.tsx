// Phase 3B — Sales Order editor drawer.
//
// Inline editing of status + payment terms + incoterm + delivery date.
// Items[] editing is out of scope for the pilot — the drawer hosts the
// fields users most often want to change post-create.

import React, { useEffect, useState } from 'react';
import {
  Drawer, Input, FormField, Label, Button, Badge,
} from '../primitives';
import { SalesOrder } from '../queries/useSalesOrders';
import { useUpdateSalesOrder } from '../queries/useSalesOrderMutations';
import { useToast } from '../primitives/Toast';

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
  onOpenChange: (open: boolean) => void;
}

export const SalesOrderDrawer: React.FC<SalesOrderDrawerProps> = ({ order, onOpenChange }) => {
  const [status, setStatus] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const toast = useToast();
  const mutation = useUpdateSalesOrder();

  useEffect(() => {
    if (!order) return;
    setStatus(order.status ?? '');
    setPaymentTerms(order.paymentTerms ?? '');
    setIncoterm(order.incoterm ?? '');
    setDeliveryDate(order.deliveryDate ?? '');
  }, [order?.id]); // reset whenever a different order opens

  const onSave = () => {
    if (!order) return;
    mutation.mutate(
      {
        id: order.id,
        status,
        paymentTerms: paymentTerms || null,
        incoterm: incoterm || null,
        deliveryDate: deliveryDate || null,
      },
      {
        onSuccess: () => {
          toast.push({
            kind: 'success',
            title: 'Saved',
            description: `${order.orderNumber} updated.`,
          });
          onOpenChange(false);
        },
        onError: (err) => {
          toast.push({
            kind: 'error',
            title: 'Update failed',
            description: err.message,
          });
        },
      },
    );
  };

  const dirty = order && (
    (order.status ?? '') !== status ||
    (order.paymentTerms ?? '') !== paymentTerms ||
    (order.incoterm ?? '') !== incoterm ||
    (order.deliveryDate ?? '') !== deliveryDate
  );

  return (
    <Drawer
      open={!!order}
      onOpenChange={onOpenChange}
      title={order ? order.orderNumber : 'Sales order'}
      description={order ? order.customerName : undefined}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || mutation.isPending}
            loading={mutation.isPending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      {order && (
        <div className="space-y-5">
          {/* Header facts */}
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

          {/* Status */}
          <FormField>
            <Label htmlFor="so-status">Status</Label>
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

          {/* Incoterm */}
          <FormField>
            <Label htmlFor="so-incoterm">Incoterm</Label>
            <Input
              id="so-incoterm"
              value={incoterm}
              onChange={e => setIncoterm(e.target.value)}
              placeholder="CFR, FOB, CIF…"
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 font-mono tabular-nums"
            />
          </FormField>

          {/* Payment terms */}
          <FormField>
            <Label htmlFor="so-terms">Payment terms</Label>
            <Input
              id="so-terms"
              value={paymentTerms}
              onChange={e => setPaymentTerms(e.target.value)}
              placeholder="e.g. 50% ADV + 50% CAD"
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </FormField>

          {/* Delivery date */}
          <FormField>
            <Label htmlFor="so-delivery">Delivery date</Label>
            <Input
              id="so-delivery"
              type="date"
              value={(deliveryDate ?? '').slice(0, 10)}
              onChange={e => setDeliveryDate(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </FormField>

          {/* Meta */}
          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <span>Currency</span>
            <Badge variant="neutral">{order.currency}</Badge>
            <span className="ml-auto font-mono tabular-nums text-slate-600">#{order.id.slice(0, 8)}</span>
          </div>
        </div>
      )}
    </Drawer>
  );
};
