// Phase 3B — Invoice editor drawer.

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button, Badge } from '../primitives';
import { Invoice } from '../queries/useInvoices';
import { useEntityMutation } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';

interface InvoicePatch {
  id: string;
  invoiceNumber?: string;
  paymentTerms?: string | null;
  incoterm?: string | null;
  soldTo?: string | null;
}

interface Props {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}

export const InvoiceDrawer: React.FC<Props> = ({ invoice, onOpenChange }) => {
  const [invoiceNumber, setNumber] = useState('');
  const [soldTo, setSoldTo] = useState('');
  const [terms, setTerms] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const toast = useToast();
  const mut = useEntityMutation<InvoicePatch>({
    table: 'invoices',
    listQueryKeys: ['invoices', 'recentSalesOrders', 'dashboardStats'],
  });

  useEffect(() => {
    if (!invoice) return;
    setNumber(invoice.invoiceNumber ?? '');
    setSoldTo(invoice.soldTo ?? '');
    setTerms(invoice.paymentTerms ?? '');
    setIncoterm(invoice.incoterm ?? '');
  }, [invoice?.id]);

  const dirty = invoice && (
    (invoice.invoiceNumber ?? '') !== invoiceNumber ||
    (invoice.soldTo ?? '') !== soldTo ||
    (invoice.paymentTerms ?? '') !== terms ||
    (invoice.incoterm ?? '') !== incoterm
  );

  const save = () => {
    if (!invoice) return;
    mut.mutate(
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
        onError: (err) => {
          toast.push({ kind: 'error', title: 'Update failed', description: err.message });
        },
      },
    );
  };

  return (
    <Drawer
      open={!!invoice}
      onOpenChange={onOpenChange}
      title={invoice?.invoiceNumber ?? 'Invoice'}
      description={invoice?.soldTo ?? invoice?.billToName ?? undefined}
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
      {invoice && (
        <div className="space-y-4">
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

          <FormField>
            <Label>Invoice #</Label>
            <Input value={invoiceNumber} onChange={e => setNumber(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
          <FormField>
            <Label>Sold to</Label>
            <Input value={soldTo} onChange={e => setSoldTo(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
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

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            {invoice.soNumber && <><span>SO</span><span className="font-mono tabular-nums text-slate-400">{invoice.soNumber}</span></>}
            {invoice.plNumber && <><span>· PL</span><span className="font-mono tabular-nums text-slate-400">{invoice.plNumber}</span></>}
            {invoice.bookingNumber && <><span>· Booking</span><span className="font-mono tabular-nums text-slate-400">{invoice.bookingNumber}</span></>}
            <span className="ml-auto font-mono tabular-nums text-slate-600">#{invoice.id.slice(0, 8)}</span>
          </div>
        </div>
      )}
    </Drawer>
  );
};
