// Phase 3B — v2 Payables.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { useRowCrud } from '../components/useRowCrud';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { usePayables, Payable } from '../queries/usePayables';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtMoney } from '../lib/formatMoney';

const columns: DataTableColumn<Payable>[] = [
  { id: 'inv', header: 'Invoice #', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber, cell: r => r.invoiceNumber },
  { id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
    value: r => r.supplier ?? '',
    cell: r => <span className="text-slate-100" title={tooltipName(r.supplier)}>{shortName(r.supplier)}</span> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
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

const fields: FieldDef[] = [
  { key: 'invoiceNumber', label: 'Invoice #', required: true, mono: true },
  { key: 'shipperName', label: 'Supplier', fullWidth: true,
    source: {
      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'invoiceDate',   label: 'Invoice date', type: 'date' },
  { key: 'paymentTerms', label: 'Payment terms',
    source: {
      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
      secondaryColumn: 'code', scopeByCompany: true,
    } },
  { key: 'totalAmount',   label: 'Amount', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'currency',      label: 'Currency', mono: true, defaultValue: 'USD' },
];

interface PayableDraft {
  invoiceNumber: string;
  shipperName: string;
  invoiceDate: string;
  paymentTerms: string;
  totalAmount: string;
  currency: string;
  notes: string;
}

const emptyPayableDraft = (): PayableDraft => ({
  invoiceNumber: '', shipperName: '', invoiceDate: '',
  paymentTerms: '', totalAmount: '', currency: 'USD', notes: '',
});

const PAYABLE_PROMPT = `You are extracting fields from a SUPPLIER INVOICE (an incoming bill
the buyer received and needs to pay). Return JSON with exactly these
keys; missing values must be null.

{
  "invoiceNumber":  string | null,
  "shipperName":    string | null,   // supplier legal name that issued the invoice
  "invoiceDate":    string | null,   // YYYY-MM-DD
  "paymentTerms":   string | null,   // e.g. "Net 30 Days"
  "totalAmount":    number | null,   // numeric, no currency symbol
  "currency":       string | null,   // ISO 4217
  "notes":          string | null
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizePayableJson(parsed: Record<string, unknown>): PayableDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (k: string): string => {
    const v = parsed[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? String(n) : '';
    }
    return '';
  };
  return {
    invoiceNumber: str('invoiceNumber'),
    shipperName:   str('shipperName'),
    invoiceDate:   str('invoiceDate'),
    paymentTerms:  str('paymentTerms'),
    totalAmount:   num('totalAmount'),
    currency:      str('currency').toUpperCase() || 'USD',
    notes:         str('notes'),
  };
}

const PayablesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const pay = usePayables(search);
  const total = (pay.data ?? []).reduce((s, r) => s + r.totalAmount, 0);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'invoices_suppliers',
    listQueryKeys: ['payables'],
    idPrefix: 'SINV',
  });

  const { rowActions, drawers, openView } = useRowCrud<Payable>({
    table: 'invoices_suppliers',
    listQueryKeys: ['payables'],
    rowLabel: r => r.invoiceNumber,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<Payable>
        title="Payables"
        subtitle={
          pay.data
            ? `${pay.data.length} bills${total > 0 ? ` · ${fmtMoney(total)}` : ''}${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Invoice # or supplier"
        cardTitle="Supplier invoices"
        columns={columns}
        getRowId={r => r.id}
        data={pay.data}
        isLoading={pay.isLoading}
        error={pay.error}
        onRetry={pay.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New bill
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New bill', onClick: openCreate }}
        skeletonCols={[100, 200, 100, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New supplier bill"
        description="Log an incoming supplier invoice (payable)."
        table="invoices_suppliers"
        idPrefix="SINV"
        listQueryKeys={['payables']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
      {aiUploadOpen && (
        <AiUploadModal<PayableDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — supplier bill',
            description: 'Drop a supplier invoice PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyPayableDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: PAYABLE_PROMPT, normalize: normalizePayableJson },
            extractSummary: (d) =>
              [d.invoiceNumber, d.shipperName].filter(Boolean).join(' · '),
            validate: (d) => {
              if (!d.invoiceNumber.trim()) return 'Invoice # is required.';
              if (!d.shipperName.trim()) return 'Supplier is required.';
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
                <FormField className="col-span-2">
                  <FieldLabel>Supplier *</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.shipperName}
                    onPick={v => setD({ ...d, shipperName: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Amount</FieldLabel>
                  <Input type="number" value={d.totalAmount}
                    onChange={e => setD({ ...d, totalAmount: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Currency</FieldLabel>
                  <Input value={d.currency}
                    onChange={e => setD({ ...d, currency: e.target.value.toUpperCase() })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Payment terms</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
                      secondaryColumn: 'code', scopeByCompany: true,
                    }}
                    value={d.paymentTerms}
                    onPick={v => setD({ ...d, paymentTerms: v })} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Notes</FieldLabel>
                  <textarea value={d.notes}
                    onChange={e => setD({ ...d, notes: e.target.value })}
                    rows={2}
                    className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y" />
                </FormField>
              </div>
            ),
            save: async (d) => {
              const payload: Record<string, unknown> = {
                invoiceNumber: d.invoiceNumber.trim(),
                shipperName:   d.shipperName.trim(),
                invoiceDate:   d.invoiceDate || null,
                paymentTerms:  d.paymentTerms || null,
                totalAmount:   d.totalAmount.trim() === '' ? null : Number(d.totalAmount),
                currency:      d.currency || 'USD',
                notes:         d.notes || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Supplier bill saved',
                description: `${d.invoiceNumber} · ${d.shipperName}`,
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

export default PayablesV2;
