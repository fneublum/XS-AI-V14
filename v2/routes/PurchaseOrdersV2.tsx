// Phase 3B — v2 Purchase Orders list.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, Input, FormField, Label, Skeleton, EmptyState, Badge, Button,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { usePurchaseOrders, PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useEditor } from '../providers/EditorProvider';
import { formatDate as fmtDate } from '../lib/formatDate';

const fmtCurrency = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`;
  }
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('RECEIV') || s.includes('COMPLETE') || s.includes('FULFIL')) return 'success';
  if (s.includes('APPROV') || s.includes('OPEN'))                              return 'info';
  if (s.includes('PEND') || s.includes('HOLD'))                                return 'warning';
  if (s.includes('CANCEL') || s.includes('REJECT'))                            return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<PurchaseOrder>[] = [
  { id: 'id', header: 'PO #', mono: true, sortable: true, filterable: true,
    value: r => r.id, cell: r => r.id.slice(0, 12) },
  { id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
    value: r => r.supplierName,
    cell: r => <span className="text-slate-100">{r.supplierName}</span> },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtCurrency(r.totalAmount, r.currency) },
  { id: 'date', header: 'Ordered', align: 'right', sortable: true,
    value: r => r.orderDate,
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate)}
      </span>
    ) },
  { id: 'eta', header: 'Expected', align: 'right', sortable: true,
    value: r => r.expectedDeliveryDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.expectedDeliveryDate ?? '')}
      </span>
    ) },
];

const buildEmailDraft = (r: PurchaseOrder): EmailDraft => ({
  to: '',
  subject: `Purchase Order ${r.id.slice(0, 12)} — ${r.supplierName}`,
  body: [
    `Hello ${r.supplierName},`,
    '',
    `Please confirm receipt of Purchase Order ${r.id.slice(0, 12)}:`,
    r.status ? `Status: ${r.status}` : '',
    r.paymentTerms ? `Payment terms: ${r.paymentTerms}` : '',
    r.totalAmount ? `Total: ${fmtCurrency(r.totalAmount, r.currency)}` : '',
    r.expectedDeliveryDate ? `Expected delivery: ${r.expectedDeliveryDate.slice(0, 10)}` : '',
    '',
    'Best regards',
  ].filter(Boolean).join('\n'),
  contextLabel: `PO ${r.id.slice(0, 12)}`,
});

interface PODraft {
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string;
  paymentTerms: string;
  currency: string;
  notes: string;
  items: Array<{
    productName: string;
    quantity: number | null;
    unitPrice: number | null;
    description?: string;
  }>;
}

const emptyPODraft = (): PODraft => ({
  supplierName: '', orderDate: '', expectedDeliveryDate: '',
  paymentTerms: '', currency: 'USD', notes: '', items: [],
});

const PO_PROMPT = `You are extracting fields from a supplier PURCHASE ORDER CONFIRMATION
or quotation the buyer received. Return JSON with exactly these keys;
missing values must be null — never guess.

{
  "supplierName":         string | null,
  "orderDate":            string | null,   // YYYY-MM-DD
  "expectedDeliveryDate": string | null,   // YYYY-MM-DD
  "paymentTerms":         string | null,   // free text, e.g. "Net 30 Days"
  "currency":             string | null,   // ISO 4217
  "notes":                string | null,
  "items": [
    { "productName": string, "quantity": number|null, "unitPrice": number|null, "description": string|null }
  ]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizePOJson(parsed: Record<string, unknown>): PODraft {
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
    supplierName:         str('supplierName'),
    orderDate:            str('orderDate'),
    expectedDeliveryDate: str('expectedDeliveryDate'),
    paymentTerms:         str('paymentTerms'),
    currency:             str('currency').toUpperCase() || 'USD',
    notes:                str('notes'),
    items: rawItems.map(it => ({
      productName: typeof it.productName === 'string' ? it.productName : '',
      quantity:    num(it.quantity),
      unitPrice:   num(it.unitPrice),
      description: typeof it.description === 'string' ? it.description : '',
    })).filter(it => it.productName),
  };
}

const PurchaseOrdersV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const { openPurchaseOrder, openPurchaseOrderCreate } = useEditor();
  const pos = usePurchaseOrders(search);
  const total = (pos.data ?? []).reduce((s, r) => s + r.totalAmount, 0);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'purchase_orders',
    listQueryKeys: ['purchaseOrders'],
    idPrefix: 'PO',
    withCreatedAt: false,
  });

  const { confirmDelete, deleteDialog } = useRowDelete<PurchaseOrder>({
    table: 'purchase_orders',
    listQueryKeys: ['purchaseOrders'],
    rowLabel: r => r.id.slice(0, 12),
  });

  const rowActions = (row: PurchaseOrder) => (
    <RowActions
      onView={() => openPurchaseOrder(row)}
      onEdit={() => openPurchaseOrder(row)}
      onEmail={() => setEmailDraft(buildEmailDraft(row))}
      onDelete={() => confirmDelete(row)}
    />
  );

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Purchase Orders
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {pos.data
              ? `${pos.data.length} shown${search ? ` · "${search}"` : ''}${
                  total > 0 ? ` · $${Math.round(total).toLocaleString('en-US')}` : ''
                }`
              : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openPurchaseOrderCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New PO
          </Button>
          <Button size="sm" onClick={() => setAiUploadOpen(true)}
            className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
            <Sparkles size={12} />
            AI Upload
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All purchase orders</CardTitle>
          <div className="flex-1 max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="PO id or supplier"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>

        {pos.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={100} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : pos.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load purchase orders"
            description={pos.error.message}
            action={{ label: 'Retry', onClick: pos.refetch }}
          />
        ) : !pos.data || pos.data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No purchase orders yet'}
            description={
              search
                ? `Nothing matched "${search}".`
                : 'Once POs are created they show up here.'
            }
            action={
              search
                ? { label: 'Clear search', onClick: () => setSearch('') }
                : { label: '+ New PO', onClick: openPurchaseOrderCreate }
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={pos.data}
            getRowId={r => r.id}
            onRowClick={r => openPurchaseOrder(r)}
            rowActions={rowActions}
          />
        )}
      </Card>

      {deleteDialog}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
      {aiUploadOpen && (
        <AiUploadModal<PODraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — purchase order',
            description: 'Drop a supplier PO / quote PDF, pick a file, or paste the email text or a screenshot.',
            emptyDraft: emptyPODraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: PO_PROMPT, normalize: normalizePOJson },
            extractSummary: (d) =>
              [d.supplierName, `${d.items.length} item${d.items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            validate: (d) => d.supplierName.trim() === '' ? 'Supplier is required.' : null,
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField className="col-span-2">
                  <FieldLabel>Supplier *</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.supplierName}
                    onPick={v => setD({ ...d, supplierName: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Order date</FieldLabel>
                  <Input type="date" value={d.orderDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, orderDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Expected delivery</FieldLabel>
                  <Input type="date" value={d.expectedDeliveryDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, expectedDeliveryDate: e.target.value })}
                    className={inputCls} />
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
                      Line items are extracted but read-only here. Edit in the PO drawer after saving.
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
                supplierName:         d.supplierName.trim(),
                orderDate:            d.orderDate || null,
                expectedDeliveryDate: d.expectedDeliveryDate || null,
                paymentTerms:         d.paymentTerms || null,
                currency:             d.currency || 'USD',
                notes:                d.notes || null,
                items: d.items.map((it, idx) => ({
                  id: `li-${Date.now()}-${idx}`,
                  productName: it.productName,
                  quantity: it.quantity ?? 0,
                  unitPrice: it.unitPrice ?? 0,
                  total: (it.quantity ?? 0) * (it.unitPrice ?? 0),
                  description: it.description ?? '',
                })),
                totalAmount: subtotal,
                status: 'PENDING',
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Purchase order created',
                description: d.supplierName,
              });
            },
          }}
        />
      )}
    </div>
  );
};

const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

export default PurchaseOrdersV2;
