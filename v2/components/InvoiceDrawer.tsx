// Phase 3B — Invoice editor drawer (create + edit).

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button, Badge } from '../primitives';
import { Invoice } from '../queries/useInvoices';
import { useEntityUpdate, useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import type { EditorMode } from '../providers/EditorProvider';

interface Props {
  invoice: Invoice | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const InvoiceDrawer: React.FC<Props> = ({ invoice, mode, onOpenChange }) => {
  const [invoiceNumber, setNumber] = useState('');
  const [soldTo, setSoldTo] = useState('');
  const [terms, setTerms] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [totalAmount, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [invoiceDate, setDate] = useState('');
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const update = useEntityUpdate<{
    id: string; invoiceNumber?: string;
    paymentTerms?: string | null; incoterm?: string | null; soldTo?: string | null;
  }>({ table: 'invoices', listQueryKeys: ['invoices', 'recentSalesOrders', 'dashboardStats', 'pl'] });

  const insert = useEntityInsert<{
    companyId: string; invoiceNumber: string; soldTo: string | null;
    invoiceDate: string | null; paymentTerms: string | null;
    incoterm: string | null; totalAmount: number; currency: string;
  }>({ table: 'invoices', listQueryKeys: ['invoices', 'pl'], idPrefix: 'INV' });

  useEffect(() => {
    if (!invoice) return;
    setNumber(invoice.invoiceNumber ?? '');
    setSoldTo(invoice.soldTo ?? '');
    setTerms(invoice.paymentTerms ?? '');
    setIncoterm(invoice.incoterm ?? '');
    setTotal(String(invoice.totalAmount ?? ''));
    setCurrency(invoice.currency ?? 'USD');
    setDate(invoice.invoiceDate ?? '');
  }, [invoice?.id, mode]);

  const totalNum = Number(totalAmount);
  const totalValid = totalAmount === '' || (Number.isFinite(totalNum) && totalNum >= 0);

  const dirty = mode === 'create'
    ? invoiceNumber.trim().length > 0
    : invoice && (
        (invoice.invoiceNumber ?? '') !== invoiceNumber ||
        (invoice.soldTo ?? '') !== soldTo ||
        (invoice.paymentTerms ?? '') !== terms ||
        (invoice.incoterm ?? '') !== incoterm
      );

  const pending = update.isPending || insert.isPending;

  const save = () => {
    if (!invoice || !totalValid) return;
    if (mode === 'create') {
      const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
      insert.mutate(
        {
          companyId,
          invoiceNumber,
          soldTo: soldTo || null,
          invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
          paymentTerms: terms || null,
          incoterm: incoterm || null,
          totalAmount: Number.isFinite(totalNum) ? totalNum : 0,
          currency,
        },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Invoice created', description: invoiceNumber });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
        },
      );
    } else {
      update.mutate(
        {
          id: invoice.id,
          invoiceNumber,
          soldTo: soldTo || null,
          paymentTerms: terms || null,
          incoterm: incoterm || null,
        },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Saved', description: `${invoiceNumber} updated.` });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Update failed', description: err.message }),
        },
      );
    }
  };

  const title = mode === 'create' ? 'New invoice' : (invoice?.invoiceNumber ?? 'Invoice');
  const description = mode === 'create'
    ? 'Create an invoice in the current workspace.'
    : (invoice?.soldTo ?? invoice?.billToName ?? undefined);

  return (
    <Drawer
      open={!!invoice}
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
      {invoice && (
        <div className="space-y-4">
          {mode === 'edit' && (
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total</div>
                <div className="font-mono tabular-nums text-[16px] text-slate-100 mt-1">
                  ${Math.round(invoice.totalAmount).toLocaleString('en-US')} <Badge variant="neutral">{invoice.currency}</Badge>
                </div>
              </div>
              <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Issued</div>
                <div className="font-mono tabular-nums text-[13px] text-slate-200 mt-1">
                  {invoice.invoiceDate ?? '—'}
                </div>
              </div>
            </div>
          )}

          <FormField>
            <Label required>Invoice #</Label>
            <Input value={invoiceNumber} onChange={e => setNumber(e.target.value)}
              autoFocus={mode === 'create'}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
          <FormField>
            <Label>Sold to</Label>
            <Input value={soldTo} onChange={e => setSoldTo(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>

          {mode === 'create' && (
            <>
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
              <FormField>
                <Label>Invoice date</Label>
                <Input type="date" value={invoiceDate} onChange={e => setDate(e.target.value)}
                  className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
              </FormField>
            </>
          )}

          <FormField>
            <Label>Incoterm</Label>
            <Input value={incoterm} onChange={e => setIncoterm(e.target.value)}
              placeholder="CFR, FOB, EXW…"
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
          <FormField>
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>

          {mode === 'edit' && (
            <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
              {invoice.soNumber && <><span>SO</span><span className="font-mono tabular-nums text-slate-400">{invoice.soNumber}</span></>}
              {invoice.plNumber && <><span>· PL</span><span className="font-mono tabular-nums text-slate-400">{invoice.plNumber}</span></>}
              {invoice.bookingNumber && <><span>· Booking</span><span className="font-mono tabular-nums text-slate-400">{invoice.bookingNumber}</span></>}
              <span className="ml-auto font-mono tabular-nums text-slate-600">#{invoice.id.slice(0, 8)}</span>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};
