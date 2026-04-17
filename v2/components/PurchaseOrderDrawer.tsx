// Phase 3B — Purchase Order editor drawer.

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button, Badge } from '../primitives';
import { PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEntityMutation } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'APPROVED', 'RECEIVED', 'CANCELLED'];

interface POPatch {
  id: string;
  status?: string;
  paymentTerms?: string | null;
  expectedDeliveryDate?: string | null;
}

interface Props {
  po: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
}

export const PurchaseOrderDrawer: React.FC<Props> = ({ po, onOpenChange }) => {
  const [status, setStatus] = useState('');
  const [terms, setTerms] = useState('');
  const [expected, setExpected] = useState('');
  const toast = useToast();
  const mut = useEntityMutation<POPatch>({
    table: 'purchase_orders',
    listQueryKeys: ['purchaseOrders'],
  });

  useEffect(() => {
    if (!po) return;
    setStatus(po.status ?? '');
    setTerms(po.paymentTerms ?? '');
    setExpected(po.expectedDeliveryDate ?? '');
  }, [po?.id]);

  const dirty = po && (
    (po.status ?? '') !== status ||
    (po.paymentTerms ?? '') !== terms ||
    (po.expectedDeliveryDate ?? '') !== expected
  );

  const save = () => {
    if (!po) return;
    mut.mutate(
      {
        id: po.id,
        status,
        paymentTerms: terms || null,
        expectedDeliveryDate: expected || null,
      },
      {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: `${po.id.slice(0, 12)} updated.` });
          onOpenChange(false);
        },
        onError: (err) => {
          toast.push({ kind: 'error', title: 'Update failed', description: err.message });
        },
      },
    );
  };

  return (
    <Drawer
      open={!!po}
      onOpenChange={onOpenChange}
      title={po?.id ?? 'Purchase Order'}
      description={po?.supplierName ?? undefined}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            Cancel
          </Button>
          <Button
            size="sm" onClick={save}
            disabled={!dirty || mut.isPending}
            loading={mut.isPending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {mut.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      {po && (
        <div className="space-y-4">
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
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>

          <FormField>
            <Label>Expected delivery</Label>
            <Input
              type="date"
              value={(expected ?? '').slice(0, 10)}
              onChange={e => setExpected(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200"
            />
          </FormField>
        </div>
      )}
    </Drawer>
  );
};
