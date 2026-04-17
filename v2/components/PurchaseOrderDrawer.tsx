// Phase 3B — Purchase Order editor drawer (create + edit).

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button, Badge } from '../primitives';
import { PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEntityUpdate, useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import type { EditorMode } from '../providers/EditorProvider';

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'APPROVED', 'RECEIVED', 'CANCELLED'];

interface Props {
  po: PurchaseOrder | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const PurchaseOrderDrawer: React.FC<Props> = ({ po, mode, onOpenChange }) => {
  const [supplierName, setSupplierName] = useState('');
  const [totalAmount, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [status, setStatus] = useState('');
  const [terms, setTerms] = useState('');
  const [expected, setExpected] = useState('');
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const update = useEntityUpdate<{
    id: string; status?: string; paymentTerms?: string | null;
    expectedDeliveryDate?: string | null;
  }>({ table: 'purchase_orders', listQueryKeys: ['purchaseOrders'] });

  const insert = useEntityInsert<{
    companyId: string; supplierName: string; status: string;
    orderDate: string; expectedDeliveryDate: string | null;
    paymentTerms: string | null; totalAmount: number; currency: string;
  }>({ table: 'purchase_orders', listQueryKeys: ['purchaseOrders'], idPrefix: 'PO' });

  useEffect(() => {
    if (!po) return;
    setSupplierName(po.supplierName ?? '');
    setTotal(String(po.totalAmount ?? ''));
    setCurrency(po.currency ?? 'USD');
    setStatus(po.status ?? 'DRAFT');
    setTerms(po.paymentTerms ?? '');
    setExpected(po.expectedDeliveryDate ?? '');
  }, [po?.id, mode]);

  const totalNum = Number(totalAmount);
  const totalValid = totalAmount === '' || (Number.isFinite(totalNum) && totalNum >= 0);

  const dirty = mode === 'create'
    ? supplierName.trim().length > 0
    : po && (
        (po.status ?? '') !== status ||
        (po.paymentTerms ?? '') !== terms ||
        (po.expectedDeliveryDate ?? '') !== expected
      );

  const pending = update.isPending || insert.isPending;

  const save = () => {
    if (!po || !totalValid) return;
    if (mode === 'create') {
      const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
      insert.mutate(
        {
          companyId,
          supplierName,
          status,
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDeliveryDate: expected || null,
          paymentTerms: terms || null,
          totalAmount: Number.isFinite(totalNum) ? totalNum : 0,
          currency,
        },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'PO created', description: supplierName });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
        },
      );
    } else {
      update.mutate(
        { id: po.id, status, paymentTerms: terms || null, expectedDeliveryDate: expected || null },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Saved', description: `${po.id.slice(0, 12)} updated.` });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Update failed', description: err.message }),
        },
      );
    }
  };

  const title = mode === 'create' ? 'New purchase order' : (po?.id ?? 'Purchase Order');
  const description = mode === 'create'
    ? 'Create a purchase order in the current workspace.'
    : (po?.supplierName ?? undefined);

  return (
    <Drawer
      open={!!po}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            Cancel
          </Button>
          <Button size="sm" onClick={save}
            disabled={!dirty || !totalValid || pending}
            loading={pending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      {po && (
        <div className="space-y-4">
          {mode === 'edit' ? (
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total</div>
                <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">
                  ${Math.round(po.totalAmount).toLocaleString('en-US')} <Badge variant="neutral">{po.currency}</Badge>
                </div>
              </div>
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Ordered</div>
                <div className="font-mono tabular-nums text-[13px] text-slate-200 mt-1">
                  {po.orderDate ?? '—'}
                </div>
              </div>
            </div>
          ) : (
            <>
              <FormField>
                <Label required>Supplier</Label>
                <Input value={supplierName} onChange={e => setSupplierName(e.target.value)}
                  autoFocus
                  className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label>Total</Label>
                  <Input type="number" min={0} step={0.01}
                    value={totalAmount} onChange={e => setTotal(e.target.value)}
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
          )}

          <FormField>
            <Label>Status</Label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(opt => (
                <button key={opt} type="button" onClick={() => setStatus(opt)}
                  className={opt === status
                    ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}
                >
                  {opt}
                </button>
              ))}
            </div>
          </FormField>

          <FormField>
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>

          <FormField>
            <Label>Expected delivery</Label>
            <Input type="date"
              value={(expected ?? '').slice(0, 10)}
              onChange={e => setExpected(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
        </div>
      )}
    </Drawer>
  );
};
