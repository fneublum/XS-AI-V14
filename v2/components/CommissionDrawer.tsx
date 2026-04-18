// Phase 3B — Commission editor drawer.
//
// Inline editor for the subset of commission_sales_orders fields users
// actually flip through the workflow: invoice status, payment status,
// commission payment status, rate, seller attribution, invoice number.

import React, { useEffect, useState } from 'react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { CommissionRow } from '../queries/useCommissions';
import { useUpdateCommission, useDeleteCommission } from '../queries/useCommissionMutations';
import { useToast } from '../primitives/Toast';
import { SupabaseSelectField } from './SupabaseSelectField';

const PAYMENT_STATUS = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];
const INVOICE_STATUS = ['UNINVOICED', 'INVOICED', 'SENT', 'VOID'];
const COMMISSION_PAYOUT = ['UNPAID', 'APPROVED', 'PAID', 'HOLD'];

interface Props {
  commission: CommissionRow | null;
  onOpenChange: (open: boolean) => void;
}

const Pills: React.FC<{
  options: string[];
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(opt => (
      <button
        key={opt}
        type="button"
        onClick={() => onChange(opt)}
        className={
          opt === value
            ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
            : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
        }
      >
        {opt}
      </button>
    ))}
  </div>
);

export const CommissionDrawer: React.FC<Props> = ({ commission, onOpenChange }) => {
  const [paymentStatus, setPS]    = useState('');
  const [invoiceStatus, setIS]    = useState('');
  const [commissionPayout, setCP] = useState('');
  const [rate, setRate]           = useState('');
  const [seller, setSeller]       = useState('');
  const [invoiceNumber, setInv]   = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const update = useUpdateCommission();
  const del    = useDeleteCommission();

  useEffect(() => {
    if (!commission) return;
    setPS(commission.paymentStatus ?? '');
    setIS(commission.invoiceStatus ?? '');
    setCP(commission.commissionPaymentStatus ?? '');
    setRate(commission.commissionRate === null || commission.commissionRate === undefined
      ? ''
      : String(commission.commissionRate));
    setSeller(commission.sellerName ?? '');
    setInv(commission.invoiceNumber ?? '');
  }, [commission?.id]);

  const rateNum = rate.trim() === '' ? null : Number(rate);
  const rateValid = rateNum === null || (Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100);

  const dirty = commission && (
    (commission.paymentStatus ?? '') !== paymentStatus ||
    (commission.invoiceStatus ?? '') !== invoiceStatus ||
    (commission.commissionPaymentStatus ?? '') !== commissionPayout ||
    (commission.commissionRate ?? null) !== rateNum ||
    (commission.sellerName ?? '') !== seller ||
    (commission.invoiceNumber ?? '') !== invoiceNumber
  );

  const pending = update.isPending || del.isPending;

  const save = () => {
    if (!commission || !rateValid) return;
    // If rate changed, recompute the commission amount so the two stay
    // in sync (orderTotal × rate%).
    const nextAmount = rateNum !== null
      ? commission.orderTotal * (rateNum / 100)
      : commission.commissionAmount;
    update.mutate(
      {
        id: commission.id,
        paymentStatus,
        invoiceStatus: invoiceStatus || null,
        commissionPaymentStatus: commissionPayout,
        commissionRate: rateNum,
        commissionAmount: nextAmount,
        sellerName: seller || null,
        invoiceNumber: invoiceNumber || null,
      },
      {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: `${commission.orderNumber} updated.` });
          onOpenChange(false);
        },
        onError: (err) => toast.push({ kind: 'error', title: 'Update failed', description: err.message }),
      },
    );
  };

  const onDelete = () => {
    if (!commission) return;
    del.mutate(commission.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: commission.orderNumber });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  return (
    <>
    <Drawer
      open={!!commission}
      onOpenChange={onOpenChange}
      title={commission?.orderNumber ?? 'Commission'}
      description={commission?.customerName}
      footer={
        <>
          <Button
            variant="secondary" size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            Cancel
          </Button>
          <Button
            size="sm" onClick={save}
            disabled={!dirty || !rateValid || pending}
            loading={pending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      {commission && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Order total</div>
              <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">
                ${Math.round(commission.orderTotal).toLocaleString('en-US')}
              </div>
            </div>
            <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Commission</div>
              <div className="font-mono tabular-nums text-[16px] text-emerald-400 mt-1">
                ${Math.round(rateNum !== null ? commission.orderTotal * (rateNum / 100) : commission.commissionAmount).toLocaleString('en-US')}
              </div>
            </div>
          </div>

          <FormField>
            <Label>Payment status</Label>
            <Pills options={PAYMENT_STATUS} value={paymentStatus} onChange={setPS} />
          </FormField>

          <FormField>
            <Label>Invoice status</Label>
            <Pills options={INVOICE_STATUS} value={invoiceStatus} onChange={setIS} />
          </FormField>

          <FormField>
            <Label>Commission payout</Label>
            <Pills options={COMMISSION_PAYOUT} value={commissionPayout} onChange={setCP} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Seller</Label>
              <SupabaseSelectField
                source={{
                  table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name',
                  secondaryColumn: 'country', scopeByCompany: true,
                }}
                value={seller}
                onPick={v => setSeller(v)}
              />
            </FormField>
            <FormField>
              <Label>Commission rate (%)</Label>
              <Input type="number" min={0} max={100} step={0.01}
                value={rate} onChange={e => setRate(e.target.value)}
                invalid={!rateValid}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
          </div>

          <FormField>
            <Label>Invoice number</Label>
            <Input value={invoiceNumber} onChange={e => setInv(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            {commission.commissionType && (
              <><span>Type</span><Badge variant="neutral">{commission.commissionType}</Badge></>
            )}
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              #{commission.id.slice(0, 8)}
            </span>
          </div>
        </div>
      )}
    </Drawer>
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      title={`Delete commission ${commission?.orderNumber ?? ''}?`}
      description="This permanently removes the commission record. The underlying sales order and invoice are not touched."
      confirmLabel="Delete"
      loading={del.isPending}
      onConfirm={onDelete}
    />
    </>
  );
};
