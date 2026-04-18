// Phase 3B — Invoice editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useState } from 'react';
import { Mail, FileText } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { Invoice } from '../queries/useInvoices';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';
import { DeliveryDocsModal } from './DeliveryDocsModal';
import { SupabaseSelectField } from './SupabaseSelectField';
import type { EditorMode } from '../providers/EditorProvider';

const INCOTERMS = ['FOB', 'CFR', 'CIF', 'EXW', 'DAP', 'DDP', 'FCA', 'CPT', 'CIP', 'FAS'];
const FREIGHT_TERMS = ['Prepaid', 'Collect', 'Prepaid & Added', 'Third Party'];
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

// Native DeliveryDocsModal handles the flow inline; the modal itself
// keeps a "Open in v1" escape hatch for PL / SLI / BOL until those
// generators are extracted.

interface Props {
  invoice: Invoice | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const InvoiceDrawer: React.FC<Props> = ({ invoice, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();

  // Header
  const [companyId, setCompanyId]     = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dateOrder, setDateOrder]     = useState('');
  const [customerPo, setCustomerPo]   = useState('');
  const [soNumber, setSoNumber]       = useState('');
  const [plNumber, setPlNumber]       = useState('');
  const [bookingNumber, setBookingNumber] = useState('');

  // Parties
  const [shipperName, setShipperName]     = useState('');
  const [shipperAddress, setShipperAddress] = useState('');
  const [soldTo, setSoldTo]               = useState('');
  const [shipTo, setShipTo]               = useState('');
  const [consignee, setConsignee]         = useState('');
  const [billToName, setBillToName]       = useState('');

  // Commercial
  const [paymentTerms, setPaymentTerms]   = useState('Net 30 Days');
  const [incoterm, setIncoterm]           = useState('FOB');
  const [currency, setCurrency]           = useState('USD');
  const [freightTerms, setFreightTerms]   = useState('');

  // Shipment
  const [carrier, setCarrier]             = useState('');
  const [transportRef, setTransportRef]   = useState('');
  const [pod, setPod]                     = useState('');
  const [poa, setPoa]                     = useState('');
  const [containers, setContainers]       = useState('');

  // Weights
  const [grossWeight, setGrossWeight]     = useState('');
  const [netWeight, setNetWeight]         = useState('');
  const [tareWeight, setTareWeight]       = useState('');
  const [totalQuantity, setTotalQuantity] = useState('');

  // Banking
  const [remitTo, setRemitTo]             = useState('');
  const [bankName, setBankName]           = useState('');
  const [bankAddress, setBankAddress]     = useState('');
  const [swiftCode, setSwiftCode]         = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  // Items + memo
  const [items, setItems]                 = useState<LineItem[]>([]);
  const [memo, setMemo]                   = useState('');
  const [originalDocument, setOriginalDocument] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emailDraft, setEmailDraft]       = useState<EmailDraft | null>(null);
  const [docsOpen, setDocsOpen]           = useState(false);

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'], idPrefix: 'INV',
  });
  const del = useEntityDelete({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'],
  });

  useEffect(() => {
    if (!invoice) return;
    setCompanyId(invoice.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setInvoiceNumber(invoice.invoiceNumber ?? '');
    setInvoiceDate(invoice.invoiceDate ?? new Date().toISOString().slice(0, 10));
    setDateOrder(invoice.dateOrder ?? '');
    setCustomerPo(invoice.customerPo ?? '');
    setSoNumber(invoice.soNumber ?? '');
    setPlNumber(invoice.plNumber ?? '');
    setBookingNumber(invoice.bookingNumber ?? '');
    setShipperName(invoice.shipperName ?? '');
    setShipperAddress(invoice.shipperAddress ?? '');
    setSoldTo(invoice.soldTo ?? '');
    setShipTo(invoice.shipTo ?? '');
    setConsignee(invoice.consignee ?? '');
    setBillToName(invoice.billToName ?? '');
    setPaymentTerms(invoice.paymentTerms ?? 'Net 30 Days');
    setIncoterm(invoice.incoterm ?? 'FOB');
    setCurrency(invoice.currency ?? 'USD');
    setFreightTerms(invoice.freightTerms ?? '');
    setCarrier(invoice.carrier ?? '');
    setTransportRef(invoice.transportRef ?? '');
    setPod(invoice.pod ?? '');
    setPoa(invoice.poa ?? '');
    setContainers(invoice.containers ?? '');
    setGrossWeight(invoice.grossWeight ?? '');
    setNetWeight(invoice.netWeight ?? '');
    setTareWeight(invoice.tareWeight ?? '');
    setTotalQuantity(invoice.totalQuantity ?? '');
    setRemitTo(invoice.remitTo ?? '');
    setBankName(invoice.bankName ?? '');
    setBankAddress(invoice.bankAddress ?? '');
    setSwiftCode(invoice.swiftCode ?? '');
    setRoutingNumber(invoice.routingNumber ?? '');
    setAccountNumber(invoice.accountNumber ?? '');
    setItems(invoice.items ?? []);
    setMemo(invoice.memo ?? '');
    setOriginalDocument(invoice.originalDocument ?? '');
  }, [invoice?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const availableCustomers = customers.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  const total = subtotal;

  const canSave = invoiceNumber.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const selectSoldTo = (customerId: string) => {
    const c = availableCustomers.find(c => c.id === customerId);
    if (!c) return;
    setSoldTo(c.name);
    if (!billToName) setBillToName(c.name);
    if (!shipTo) setShipTo([c.location, c.city, c.state, c.zip, c.country].filter(Boolean).join(', '));
    if (c.paymentTerms && !paymentTerms) setPaymentTerms(c.paymentTerms);
    if (c.pod && !pod) setPod(c.pod);
  };

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    invoiceNumber: invoiceNumber.trim(),
    invoiceDate: invoiceDate || null,
    dateOrder: dateOrder || null,
    customerPo: customerPo || null,
    soNumber: soNumber || null,
    plNumber: plNumber || null,
    bookingNumber: bookingNumber || null,
    shipperName: shipperName || null,
    shipperAddress: shipperAddress || null,
    soldTo: soldTo || null,
    shipTo: shipTo || null,
    consignee: consignee || null,
    billToName: billToName || null,
    paymentTerms: paymentTerms || null,
    incoterm: incoterm || null,
    incoterms: incoterm || null,
    currency,
    freightTerms: freightTerms || null,
    carrier: carrier || null,
    transportRef: transportRef || null,
    pod: pod || null,
    poa: poa || null,
    containers: containers || null,
    grossWeight: grossWeight || null,
    netWeight: netWeight || null,
    tareWeight: tareWeight || null,
    totalQuantity: totalQuantity || null,
    remitTo: remitTo || null,
    bankName: bankName || null,
    bankAddress: bankAddress || null,
    swiftCode: swiftCode || null,
    routingNumber: routingNumber || null,
    accountNumber: accountNumber || null,
    // `items` is a text column in the live schema — stringify before insert.
    items: JSON.stringify(sanitizeItems(items)),
    subtotal,
    totalAmount: total,
    memo: memo || null,
    originalDocument: originalDocument || null,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Invoice # is required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Invoice created', description: payload.invoiceNumber });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (invoice) {
      update.mutate({ id: invoice.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.invoiceNumber });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Save failed', description: err.message,
        }),
      });
    }
  };

  const deleteInvoice = () => {
    if (!invoice) return;
    del.mutate(invoice.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: invoice.invoiceNumber });
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
    setEmailDraft({
      to: '',
      subject: `Invoice ${invoiceNumber} — ${soldTo ?? billToName ?? ''}`.trim(),
      body: [
        `Hello${billToName ? ' ' + billToName : ''},`,
        '',
        `Please find the details of Invoice ${invoiceNumber}:`,
        soNumber ? `Sales order: ${soNumber}` : '',
        incoterm ? `Incoterm: ${incoterm}` : '',
        paymentTerms ? `Payment terms: ${paymentTerms}` : '',
        `Total: ${fmtMoney(total, currency)}`,
        invoiceDate ? `Issued: ${invoiceDate}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `Invoice ${invoiceNumber}`,
    });
  };

  if (!invoice) return null;

  return (
    <>
      <Drawer
        open={!!invoice}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New invoice' : `Invoice ${invoice.invoiceNumber || invoice.id}`}
        description={mode === 'edit' ? (soldTo || billToName || undefined) : 'Create a customer invoice.'}
        widthClass="w-[min(98vw,1020px)]"
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
            {mode === 'edit' && invoice && (
              <Button
                variant="secondary" size="sm"
                onClick={() => setDocsOpen(true)}
                disabled={pending}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <FileText size={12} /> Delivery docs
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
              {pending ? 'Saving…' : mode === 'create' ? 'Create invoice' : 'Save changes'}
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
            <div className="grid grid-cols-4 gap-2">
              <FormField>
                <Label className={labelClass}>Invoice # <span className="text-red-400 ml-1">*</span></Label>
                <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Invoice date</Label>
                <Input type="date" value={invoiceDate ? invoiceDate.slice(0, 10) : ''}
                  onChange={e => setInvoiceDate(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Customer PO</Label>
                <Input value={customerPo} onChange={e => setCustomerPo(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Order date</Label>
                <Input type="date" value={dateOrder ? dateOrder.slice(0, 10) : ''}
                  onChange={e => setDateOrder(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>SO #</Label>
                <Input value={soNumber} onChange={e => setSoNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>PL #</Label>
                <Input value={plNumber} onChange={e => setPlNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Booking #</Label>
                <Input value={bookingNumber} onChange={e => setBookingNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          {/* Parties */}
          <div className={sectionClass}>
            <Label className={labelClass}>Parties</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Shipper</Label>
                <Input value={shipperName} onChange={e => setShipperName(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Shipper address</Label>
                <Input value={shipperAddress} onChange={e => setShipperAddress(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Sold to</Label>
                <select
                  value={availableCustomers.find(c => c.name === soldTo)?.id ?? ''}
                  onChange={e => selectSoldTo(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}
                >
                  <option value="">{soldTo || '—'}</option>
                  {[...availableCustomers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Bill to</Label>
                <Input value={billToName} onChange={e => setBillToName(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Ship to</Label>
                <Input value={shipTo} onChange={e => setShipTo(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Consignee</Label>
                <Input value={consignee} onChange={e => setConsignee(e.target.value)} className={inputClass} />
              </FormField>
            </div>
          </div>

          {/* Line items */}
          <div className={sectionClass}>
            <Label className={labelClass}>Line items</Label>
            <LineItemsEditor items={items} onChange={setItems} currency={currency} showHsCode />
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
                <Label className={labelClass}>Freight terms</Label>
                <select value={freightTerms} onChange={e => setFreightTerms(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">—</option>
                  {FREIGHT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
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

          {/* Shipment */}
          <div className={sectionClass}>
            <Label className={labelClass}>Shipment</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Carrier</Label>
                <SupabaseSelectField
                  source={{
                    table: 'carriers', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'scac', scopeByCompany: true,
                  }}
                  value={carrier}
                  onPick={v => setCarrier(v)}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Transport ref</Label>
                <Input value={transportRef} onChange={e => setTransportRef(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>POA (origin)</Label>
                <SupabaseSelectField
                  source={{
                    table: 'ports', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'code',
                  }}
                  value={poa}
                  onPick={v => setPoa(v)}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>POD (destination)</Label>
                <SupabaseSelectField
                  source={{
                    table: 'ports', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'code',
                  }}
                  value={pod}
                  onPick={v => setPod(v)}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Containers</Label>
                <Input value={containers} onChange={e => setContainers(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} placeholder="MRKU1234567" />
              </FormField>
            </div>
          </div>

          {/* Weights */}
          <div className={sectionClass}>
            <Label className={labelClass}>Weights &amp; totals</Label>
            <div className="grid grid-cols-4 gap-2">
              <FormField>
                <Label className={labelClass}>Total qty</Label>
                <Input value={totalQuantity} onChange={e => setTotalQuantity(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Gross (kg)</Label>
                <Input value={grossWeight} onChange={e => setGrossWeight(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Net (kg)</Label>
                <Input value={netWeight} onChange={e => setNetWeight(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Tare (kg)</Label>
                <Input value={tareWeight} onChange={e => setTareWeight(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          {/* Banking */}
          <div className={sectionClass}>
            <Label className={labelClass}>Remittance / banking</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Remit to</Label>
                <Input value={remitTo} onChange={e => setRemitTo(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Bank name</Label>
                <Input value={bankName} onChange={e => setBankName(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <FormField>
              <Label className={labelClass}>Bank address</Label>
              <Input value={bankAddress} onChange={e => setBankAddress(e.target.value)} className={inputClass} />
            </FormField>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Swift</Label>
                <Input value={swiftCode} onChange={e => setSwiftCode(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Routing</Label>
                <Input value={routingNumber} onChange={e => setRoutingNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Account</Label>
                <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          {/* Memo */}
          <div className={sectionClass}>
            <Label className={labelClass}>Memo</Label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3}
              className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed w-full"
              placeholder="Memo / remarks printed on the invoice" />
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">invoices</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-600">
              Total <span className="font-mono tabular-nums text-indigo-300 font-semibold">{fmtMoney(total, currency)}</span>
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${invoice.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete invoice ${invoice?.invoiceNumber ?? ''}?`}
        description="Removes the invoice and breaks any commission / receivable rows that depend on it."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteInvoice}
      />

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />

      <DeliveryDocsModal
        invoice={docsOpen ? invoice : null}
        onOpenChange={(o) => !o && setDocsOpen(false)}
      />
    </>
  );
};
