// Phase 3B — v2 Invoices (AR).
//
// Row actions: View / Edit (drawer) · Email (mailto compose) ·
// Delivery Documents · Delete. The "Delivery Documents" icon hands off
// to v1 PLInvoiceEngine by writing the invoice id to sessionStorage
// and switching to v1; v1 picks the key up and auto-opens the existing
// Documents Modal (preview / download / email Invoice, PL, SLI, BOL).

import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { useInvoices, Invoice } from '../queries/useInvoices';
import { useBookings } from '../queries/useBookings';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { useProducts } from '../queries/useProducts';
import { usePackingLists } from '../queries/usePackingLists';
import { usePorts } from '../queries/usePorts';
import { useCompanyImages } from '../queries/useCompanyImages';
import { usePaymentTerms } from '../queries/usePaymentTerms';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useEditor } from '../providers/EditorProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { Button, Input, FormField, Label } from '../primitives';
import { DeliveryDocsModal } from '../components/DeliveryDocsModal';
import { InvoicePreviewDialog } from '../components/InvoicePreviewDialog';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { saveToDropbox, dropboxFolderName } from '../services/saveToDropbox';
import { findCompany, InvoicePdfCtx, PdfInvoice, PdfBankRow } from '../services/pdf/types';
import { isEc4Company } from '../services/pdf/isEc4Company';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';

// Extract the POD code from either a UN/LOCODE (`BRPEC`) or a labeled
// form like `Manaus (BRMAO)` — the field is stored both ways across
// historical rows.
const podShort = (pod: string | null): string => {
  if (!pod) return '—';
  const m = pod.match(/\(([A-Z]{5})\)/);
  return m ? m[1] : pod;
};

const buildColumns = (
  termsCodeByDescription: Map<string, string>,
  etdByBookingNumber: Map<string, string | null>,
): DataTableColumn<Invoice>[] => [
  { id: 'inv', header: 'Invoice', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber, cell: r => r.invoiceNumber },
  { id: 'sold', header: 'Sold to', sortable: true, filterable: true,
    value: r => r.soldTo ?? r.billToName ?? '',
    cell: r => {
      const full = r.soldTo ?? r.billToName;
      return <span className="text-slate-100" title={tooltipName(full)}>{shortName(full)}</span>;
    } },
  { id: 'so', header: 'SO', mono: true, sortable: true, filterable: true,
    value: r => r.soNumber ?? '',
    cell: r => <span className="text-slate-500">{r.soNumber ?? '—'}</span> },
  { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
    value: r => r.incoterm ?? '',
    cell: r => <span className="font-mono text-[11.5px] text-slate-400">{r.incoterm ?? '—'}</span> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    // Lookup the reference row so the column shows the short code
    // (NET60, CAD, …) instead of the long description that is stored
    // on the invoice row.
    value: r => (r.paymentTerms ? termsCodeByDescription.get(r.paymentTerms.trim()) ?? r.paymentTerms : ''),
    cell: r => {
      const code = r.paymentTerms ? termsCodeByDescription.get(r.paymentTerms.trim()) : null;
      return <span className="font-mono text-[11.5px] text-slate-400" title={r.paymentTerms ?? ''}>{code ?? r.paymentTerms ?? '—'}</span>;
    } },
  { id: 'pod', header: 'POD', mono: true, sortable: true, filterable: true,
    value: r => podShort(r.pod),
    cell: r => <span className="font-mono text-[11.5px] text-slate-400" title={r.pod ?? ''}>{podShort(r.pod)}</span> },
  { id: 'etd', header: 'ETD', align: 'right', sortable: true,
    // Resolve via the booking row — invoices don't store ETD directly.
    value: r => (r.bookingNumber ? etdByBookingNumber.get(r.bookingNumber) ?? '' : ''),
    cell: r => {
      const etd = r.bookingNumber ? etdByBookingNumber.get(r.bookingNumber) : null;
      return (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {etd ? fmtDate(etd) : '—'}
        </span>
      );
    } },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtMoney(r.totalAmount, r.currency) },
  { id: 'date', header: 'Issued', align: 'right', sortable: true,
    value: r => r.invoiceDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.invoiceDate)}
      </span>
    ) },
];

// The row action now opens the native v2 Delivery Docs modal instead of
// handing off to v1. The modal itself still offers a "Open full v1 flow"
// escape hatch for PL / SLI / BOL pieces that aren't native yet.

interface InvDraft {
  invoiceNumber: string;
  invoiceDate: string;
  soldTo: string;
  billToName: string;
  soNumber: string;
  incoterm: string;
  paymentTerms: string;
  carrier: string;
  poa: string;
  pod: string;
  currency: string;
  notes: string;
  items: Array<{
    productName: string;
    quantity: number | null;
    unitPrice: number | null;
    description?: string;
  }>;
}

const emptyInvDraft = (): InvDraft => ({
  invoiceNumber: '', invoiceDate: '', soldTo: '', billToName: '',
  soNumber: '', incoterm: '', paymentTerms: '', carrier: '',
  poa: '', pod: '', currency: 'USD', notes: '', items: [],
});

const INV_PROMPT = `You are extracting fields from a COMMERCIAL INVOICE (export or
domestic AR). Return JSON with exactly these keys; missing values must
be null — never guess.

{
  "invoiceNumber": string | null,
  "invoiceDate":   string | null,   // YYYY-MM-DD
  "soldTo":        string | null,   // customer legal name
  "billToName":    string | null,   // bill-to if different from soldTo
  "soNumber":      string | null,   // related sales order #
  "incoterm":      "FOB"|"CFR"|"CIF"|"EXW"|"DAP"|"DDP"|"FCA"|"CPT"|"CIP"|"FAS" | null,
  "paymentTerms":  string | null,   // e.g. "Net 30 Days"
  "carrier":       string | null,
  "poa":           string | null,   // port of origin (name, e.g. "Santos")
  "pod":           string | null,   // port of destination (name, e.g. "Houston")
  "currency":      string | null,   // ISO 4217
  "notes":         string | null,
  "items": [
    { "productName": string, "quantity": number|null, "unitPrice": number|null, "description": string|null }
  ]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizeInvJson(parsed: Record<string, unknown>): InvDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? n : null;
    }
    return null;
  };
  const rawItems = Array.isArray(parsed.items) ? parsed.items as Array<Record<string, unknown>> : [];
  return {
    invoiceNumber: str('invoiceNumber'),
    invoiceDate:   str('invoiceDate'),
    soldTo:        str('soldTo'),
    billToName:    str('billToName'),
    soNumber:      str('soNumber'),
    incoterm:      str('incoterm').toUpperCase(),
    paymentTerms:  str('paymentTerms'),
    carrier:       str('carrier'),
    poa:           str('poa'),
    pod:           str('pod'),
    currency:      str('currency').toUpperCase() || 'USD',
    notes:         str('notes'),
    items: rawItems.map(it => ({
      productName: typeof it.productName === 'string' ? it.productName : '',
      quantity:    num(it.quantity),
      unitPrice:   num(it.unitPrice),
      description: typeof it.description === 'string' ? it.description : '',
    })).filter(it => it.productName),
  };
}

const InvoicesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [deliveryDocsInvId, setDeliveryDocsInvId] = useState<string | null>(null);
  // When the row-level Email action is used we open the same
  // DeliveryDocsModal with Invoice + PL pre-selected and the email
  // preview auto-opened, so the user gets PDFs attached and the
  // broker CC'd without extra clicks.
  const [emailAutoMode, setEmailAutoMode] = useState(false);
  const [previewInvId, setPreviewInvId] = useState<string | null>(null);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const { openInvoice, openInvoiceCreate } = useEditor();
  const invoices = useInvoices(search);
  const bookings = useBookings();
  const paymentTerms = usePaymentTerms();
  // Aux queries needed to build the InvoicePdfCtx for Dropbox save.
  // These are cached at the QueryClient level so reopening the modal
  // (or hitting Save first) shares the same data.
  const companies = useCompanies();
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const packingLists = usePackingLists();
  const ports = usePorts();
  const logos = useCompanyImages('LOGO');
  const banks = useSupabaseQuery<PdfBankRow[]>(
    ['banks', 'invoice-ctx'],
    async () => {
      const { data, error } = await getSupabaseClient().from('banks').select('*').limit(500);
      if (error) throw new Error(error.message);
      return (data as PdfBankRow[] | null) ?? [];
    },
  );
  const total = (invoices.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  // Track per-row Save state so the Save icon shows a spinner only for
  // the row the user clicked. Keyed by invoice.id.
  const [savingId, setSavingId] = useState<string | null>(null);

  // EC4 stamp loaded once, same as DeliveryDocsModal. Fetched on mount
  // so the first Save click doesn't have to wait on network for the
  // stamp image — though it's not strictly required for the Dropbox
  // save flow (PDFs are stored, not printed).
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/ec4_stamp.png');
        if (!resp.ok) return;
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onload = () => { if (!cancelled) setStampUrl(reader.result as string); };
        reader.readAsDataURL(blob);
      } catch { /* no stamp */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  const buildCtx = (): InvoicePdfCtx => {
    const company = findCompany(companies.data ?? [], currentCompanyId);
    return {
      company,
      customers: customers.data ?? [],
      suppliers: suppliers.data ?? [],
      products: products.data ?? [],
      packingLists: packingLists.data ?? [],
      bookings: bookings.data ?? [],
      ports: (ports.data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country ?? undefined })),
      banks: banks.data ?? [],
      logoUrl,
      stampUrl: isEc4Company(company) ? stampUrl : null,
      brMode: false,
    };
  };

  const handleSaveToDropbox = async (row: Invoice) => {
    setSavingId(row.id);
    try {
      const pdfInvoice: PdfInvoice = {
        ...row,
        incoterm: row.incoterm ?? undefined,
        date: row.invoiceDate ?? undefined,
      } as PdfInvoice;
      const result = await saveToDropbox({
        invoice: row,
        pdfInvoice,
        ctx: buildCtx(),
      });
      toast.push({
        kind: 'success',
        title: 'Saved to Dropbox',
        description: `${dropboxFolderName(row)} · ${result.uploaded.length} files`,
      });
    } catch (e: any) {
      toast.push({
        kind: 'error',
        title: 'Save failed',
        description: e?.message ?? 'Unknown error',
      });
    } finally {
      setSavingId(null);
    }
  };

  // Lookups drive the Terms code (description → code), POD, and ETD
  // (bookingNumber → etd) columns.
  const termsCodeByDescription = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of paymentTerms.data ?? []) {
      if (t.description && t.code) m.set(t.description.trim(), t.code);
    }
    return m;
  }, [paymentTerms.data]);
  const etdByBookingNumber = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of bookings.data ?? []) {
      if (b.bookingNumber) m.set(b.bookingNumber, b.etd);
    }
    return m;
  }, [bookings.data]);
  const columns = useMemo(
    () => buildColumns(termsCodeByDescription, etdByBookingNumber),
    [termsCodeByDescription, etdByBookingNumber],
  );
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'invoices',
    listQueryKeys: ['invoices'],
    idPrefix: 'INV',
  });

  const { confirmDelete, deleteDialog } = useRowDelete<Invoice>({
    table: 'invoices',
    listQueryKeys: ['invoices'],
    rowLabel: r => r.invoiceNumber,
  });

  // Re-derive from the live query so edits flow through to the
  // delivery-docs / preview modals without re-opening them.
  const deliveryDocsInv = useMemo(
    () => invoices.data?.find(i => i.id === deliveryDocsInvId) ?? null,
    [invoices.data, deliveryDocsInvId],
  );
  const previewInv = useMemo(
    () => invoices.data?.find(i => i.id === previewInvId) ?? null,
    [invoices.data, previewInvId],
  );

  const duplicateInvoice = (row: Invoice) => {
    const { id: _id, createdAt: _createdAt, invoiceNumber: _inv, ...rest } = row;
    openInvoiceCreate({
      ...rest,
      invoiceNumber: '',
      invoiceDate: new Date().toISOString().slice(0, 10),
    });
  };

  const rowActions = (row: Invoice) => (
    <RowActions
      onView={() => setPreviewInvId(row.id)}
      onEdit={() => openInvoice(row)}
      onEmail={() => { setEmailAutoMode(true); setDeliveryDocsInvId(row.id); }}
      onDeliveryDocs={() => { setEmailAutoMode(false); setDeliveryDocsInvId(row.id); }}
      onSave={() => handleSaveToDropbox(row)}
      saving={savingId === row.id}
      saveLabel={`Save to Dropbox · ${dropboxFolderName(row)}`}
      onDuplicate={() => duplicateInvoice(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  return (
    <>
      <ListPage<Invoice>
        title="Invoices"
        subtitle={
          invoices.data
            ? `${invoices.data.length} shown${total > 0 ? ` · ${fmtMoney(total)}` : ''}${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => openInvoiceCreate()}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New invoice
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Invoice # or customer"
        columns={columns}
        getRowId={r => r.id}
        data={invoices.data}
        isLoading={invoices.isLoading}
        error={invoices.error}
        onRetry={invoices.refetch}
        onRowClick={r => openInvoice(r)}
        rowActions={rowActions}
        emptyAction={{ label: '+ New invoice', onClick: openInvoiceCreate }}
        skeletonCols={[100, 200, 80, 80, 80, 60, 60, 70, 80, 70]}
        zebra
      />
      {deleteDialog}
      <DeliveryDocsModal
        invoice={deliveryDocsInv}
        onOpenChange={(o) => { if (!o) { setDeliveryDocsInvId(null); setEmailAutoMode(false); } }}
        initialSelection={emailAutoMode ? { invoice: true, pl: true } : undefined}
        autoEmail={emailAutoMode}
      />
      <InvoicePreviewDialog
        invoice={previewInv}
        onOpenChange={(o) => !o && setPreviewInvId(null)}
        onOpenDeliveryDocs={(inv) => setDeliveryDocsInvId(inv.id)}
      />
      {aiUploadOpen && (
        <AiUploadModal<InvDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — commercial invoice',
            description: 'Drop an invoice PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyInvDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: INV_PROMPT, normalize: normalizeInvJson },
            extractSummary: (d) =>
              [d.invoiceNumber, d.soldTo, `${d.items.length} item${d.items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            validate: (d) => {
              if (!d.invoiceNumber.trim()) return 'Invoice # is required.';
              return null;
            },
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <FieldLabel>Invoice # *</FieldLabel>
                  <Input value={d.invoiceNumber}
                    onChange={e => setD({ ...d, invoiceNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Invoice date</FieldLabel>
                  <Input type="date" value={d.invoiceDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, invoiceDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Sold to</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                    value={d.soldTo}
                    onPick={v => setD({ ...d, soldTo: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Bill to</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                    value={d.billToName}
                    onPick={v => setD({ ...d, billToName: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>SO #</FieldLabel>
                  <Input value={d.soNumber}
                    onChange={e => setD({ ...d, soNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Incoterm</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {(['FOB','CFR','CIF','EXW','DAP','DDP','FCA','CPT','CIP','FAS'] as const).map(opt => (
                      <button key={opt} type="button"
                        onClick={() => setD({ ...d, incoterm: opt })}
                        className={d.incoterm === opt
                          ? 'px-2 py-0.5 rounded text-[10.5px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'px-2 py-0.5 rounded text-[10.5px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </FormField>
                <FormField>
                  <FieldLabel>Currency</FieldLabel>
                  <Input value={d.currency}
                    onChange={e => setD({ ...d, currency: e.target.value.toUpperCase() })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Payment terms</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'payment_terms', valueColumn: 'description', labelColumn: 'description', secondaryColumn: 'code', scopeByCompany: true }}
                    value={d.paymentTerms}
                    onPick={v => setD({ ...d, paymentTerms: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Carrier</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'carriers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'scac', scopeByCompany: true }}
                    value={d.carrier}
                    onPick={v => setD({ ...d, carrier: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>POA</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'code' }}
                    value={d.poa}
                    onPick={v => setD({ ...d, poa: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>POD</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'code' }}
                    value={d.pod}
                    onPick={v => setD({ ...d, pod: v })} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Notes</FieldLabel>
                  <textarea value={d.notes}
                    onChange={e => setD({ ...d, notes: e.target.value })}
                    rows={2}
                    className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y" />
                </FormField>
                {d.items.length > 0 && (
                  <div className="col-span-2">
                    <FieldLabel>Line items ({d.items.length})</FieldLabel>
                    <div className="mt-1 rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f]">
                      {d.items.map((it, i) => (
                        <div key={i} className="grid grid-cols-[1fr_80px_100px] gap-2 px-2 py-1.5 text-[11.5px]">
                          <div className="text-slate-200 truncate">{it.productName}</div>
                          <div className="text-slate-400 font-mono tabular-nums text-right">
                            {it.quantity != null ? it.quantity.toLocaleString('en-US') : '—'}
                          </div>
                          <div className="text-slate-400 font-mono tabular-nums text-right">
                            {it.unitPrice != null ? it.unitPrice.toLocaleString('en-US', { style: 'currency', currency: d.currency }) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10.5px] text-slate-500 mt-1">
                      Line items extracted but read-only here. Edit in the Invoice drawer after saving.
                    </div>
                  </div>
                )}
              </div>
            ),
            save: async (d) => {
              const subtotal = d.items.reduce((s, it) => {
                const q = it.quantity ?? 0;
                const p = it.unitPrice ?? 0;
                return s + q * p;
              }, 0);
              const payload: Record<string, unknown> = {
                invoiceNumber: d.invoiceNumber.trim(),
                invoiceDate:   d.invoiceDate || null,
                soldTo:        d.soldTo || null,
                billToName:    d.billToName || d.soldTo || null,
                soNumber:      d.soNumber || null,
                incoterm:      d.incoterm || null,
                paymentTerms:  d.paymentTerms || null,
                carrier:       d.carrier || null,
                poa:           d.poa || null,
                pod:           d.pod || null,
                currency:      d.currency || 'USD',
                notes:         d.notes || null,
                items: JSON.stringify(d.items.map((it, idx) => ({
                  id: `li-${Date.now()}-${idx}`,
                  productName: it.productName,
                  quantity: it.quantity ?? 0,
                  unitPrice: it.unitPrice ?? 0,
                  total: (it.quantity ?? 0) * (it.unitPrice ?? 0),
                  description: it.description ?? '',
                }))),
                totalAmount: subtotal,
                subtotal:    subtotal,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              // Flip the linked SO to FULFILLED so it drops off the
              // Trading Follow Up "To Ship" table. Same logic as the
              // InvoiceDrawer save path.
              const soNo = (d.soNumber || '').trim();
              if (soNo) {
                try {
                  const sb = getSupabaseClient();
                  await sb
                    .from('sales_orders')
                    .update({ status: 'FULFILLED' })
                    .eq('orderNumber', soNo)
                    .neq('status', 'FULFILLED');
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.warn('[InvoicesV2.aiUpload] linkSalesOrder failed:', e);
                }
              }
              toast.push({
                kind: 'success',
                title: 'Invoice created',
                description: `${d.invoiceNumber} · ${d.soldTo || 'draft'}`,
              });
            },
          }}
        />
      )}
    </>
  );
};

const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

export default InvoicesV2;
