// Phase 3B — v2 Sales Orders list.

import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, Input, FormField, Label, Badge, Skeleton, EmptyState, Button,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { ProformaDocsModal } from '../components/ProformaDocsModal';
import { useSalesOrders, SalesOrder } from '../queries/useSalesOrders';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { cn } from '../primitives/utils';
import { useEditor } from '../providers/EditorProvider';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtCurrency } from '../lib/formatMoney';


type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('FULFIL') || s.includes('SHIP') || s.includes('COMPLETE')) return 'success';
  if (s.includes('APPROV'))                                                  return 'info';
  if (s.includes('PEND') || s.includes('HOLD'))                              return 'warning';
  if (s.includes('CANCEL') || s.includes('REJECT'))                          return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<SalesOrder>[] = [
  { id: 'orderNumber', header: 'Order', mono: true, sortable: true, filterable: true,
    value: r => r.orderNumber, cell: r => r.orderNumber },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span title={tooltipName(r.customerName)}>{shortName(r.customerName)}</span> },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
    value: r => r.incoterm ?? '',
    cell: r => <span className="text-slate-400 font-mono text-[11.5px]">{r.incoterm ?? '—'}</span> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtCurrency(r.totalAmount, r.currency) },
  { id: 'date', header: 'Ordered', align: 'right', sortable: true,
    value: r => r.orderDate || r.createdAt,
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate || r.createdAt)}
      </span>
    ) },
];

const FilterPill: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}> = ({ active, onClick, children, count }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'px-2 py-1 rounded text-[12px] flex items-center gap-1.5 transition-colors',
      active
        ? 'bg-[#161616] text-slate-100'
        : 'border border-[#1f1f1f] text-slate-500 hover:text-slate-200',
    )}
  >
    {children}
    {count !== undefined && (
      <span className={cn(
        'font-mono tabular-nums text-[10px]',
        active ? 'text-slate-500' : 'text-slate-600',
      )}>{count}</span>
    )}
  </button>
);

const buildEmailDraft = (r: SalesOrder): EmailDraft => ({
  to: '',
  subject: `Sales Order ${r.orderNumber} — ${r.customerName}`,
  body: [
    `Hello ${r.customerName},`,
    '',
    `Please find the details of Sales Order ${r.orderNumber}:`,
    r.status ? `Status: ${r.status}` : '',
    r.incoterm ? `Incoterm: ${r.incoterm}` : '',
    r.paymentTerms ? `Payment terms: ${r.paymentTerms}` : '',
    r.totalAmount ? `Total: ${fmtCurrency(r.totalAmount, r.currency)}` : '',
    r.deliveryDate ? `Delivery: ${r.deliveryDate.slice(0, 10)}` : '',
    '',
    'Best regards',
  ].filter(Boolean).join('\n'),
  contextLabel: `SO ${r.orderNumber}`,
});

interface SODraft {
  orderNumber: string;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  incoterm: string;
  paymentTerms: string;
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

const emptySODraft = (): SODraft => ({
  orderNumber: '', customerName: '', orderDate: '', deliveryDate: '',
  incoterm: '', paymentTerms: '', poa: '', pod: '',
  currency: 'USD', notes: '', items: [],
});

const SO_PROMPT = `You are extracting fields from a customer PURCHASE ORDER or PROFORMA
INVOICE that the seller received. Return JSON with exactly these keys;
missing values must be null — never guess.

{
  "orderNumber":   string | null,
  "customerName":  string | null,
  "orderDate":     string | null,   // YYYY-MM-DD
  "deliveryDate":  string | null,   // YYYY-MM-DD
  "incoterm":      "FOB"|"CFR"|"CIF"|"EXW"|"DAP"|"DDP"|"FCA"|"CPT"|"CIP"|"FAS" | null,
  "paymentTerms":  string | null,   // free text, e.g. "Net 30 Days"
  "poa":           string | null,   // port of origin (name e.g. "Santos")
  "pod":           string | null,   // port of destination (name e.g. "Houston")
  "currency":      string | null,   // ISO 4217 (USD, EUR, BRL, ...)
  "notes":         string | null,
  "items": [
    { "productName": string, "quantity": number|null, "unitPrice": number|null, "description": string|null }
  ]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizeSOJson(parsed: Record<string, unknown>): SODraft {
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
    orderNumber:  str('orderNumber'),
    customerName: str('customerName'),
    orderDate:    str('orderDate'),
    deliveryDate: str('deliveryDate'),
    incoterm:     str('incoterm').toUpperCase(),
    paymentTerms: str('paymentTerms'),
    poa:          str('poa'),
    pod:          str('pod'),
    currency:     str('currency').toUpperCase() || 'USD',
    notes:        str('notes'),
    items: rawItems.map(it => ({
      productName: typeof it.productName === 'string' ? it.productName : '',
      quantity:    num(it.quantity),
      unitPrice:   num(it.unitPrice),
      description: typeof it.description === 'string' ? it.description : '',
    })).filter(it => it.productName),
  };
}

const SalesOrdersV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const [proformaViewOrder, setProformaViewOrder]       = useState<SalesOrder | null>(null);
  const [proformaEmailOrder, setProformaEmailOrder]     = useState<SalesOrder | null>(null);
  const { openSalesOrder, openSalesOrderCreate } = useEditor();
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders', 'dashboardStats'],
    idPrefix: 'SO',
  });

  const all = useSalesOrders({ search });
  const rows = useMemo(() => {
    if (!all.data) return [];
    if (statusFilter === 'ALL') return all.data;
    return all.data.filter(r => r.status === statusFilter);
  }, [all.data, statusFilter]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of all.data ?? []) {
      map.set(r.status, (map.get(r.status) ?? 0) + 1);
    }
    return map;
  }, [all.data]);

  const statuses = useMemo(
    () => Array.from(counts.keys()).sort(),
    [counts],
  );

  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);

  const { confirmDelete, deleteDialog } = useRowDelete<SalesOrder>({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders'],
    rowLabel: r => r.orderNumber,
  });

  const duplicateOrder = (row: SalesOrder) => {
    const { id: _id, createdAt: _createdAt, orderNumber: _orderNumber, ...rest } = row;
    openSalesOrderCreate({
      ...rest,
      orderNumber: '',
      status: 'PENDING',
      approvedBy: null,
      orderDate: new Date().toISOString().slice(0, 10),
    });
  };

  // View previews the Proforma PDF; Email opens the Proforma email
  // draft. Edit still opens the bespoke drawer.
  const rowActions = (row: SalesOrder) => (
    <RowActions
      onView={() => setProformaViewOrder(row)}
      onEdit={() => openSalesOrder(row)}
      onEmail={() => setProformaEmailOrder(row)}
      onDuplicate={() => duplicateOrder(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Sales Orders
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {all.data
              ? `${rows.length} shown${statusFilter !== 'ALL' ? ` · ${statusFilter}` : ''}${search ? ` · "${search}"` : ''}`
              : 'Loading…'}
            {all.data && rows.length > 0 && (
              <> · <span className="font-mono tabular-nums">{fmtCurrency(totalAmount)}</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => openSalesOrderCreate()}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
          >
            + New order
          </Button>
          <Button
            size="sm"
            onClick={() => setAiUploadOpen(true)}
            className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5"
          >
            <Sparkles size={12} />
            AI Upload
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FilterPill
          active={statusFilter === 'ALL'}
          onClick={() => setStatusFilter('ALL')}
          count={all.data?.length}
        >
          All
        </FilterPill>
        {statuses.map(status => (
          <FilterPill
            key={status}
            active={statusFilter === status}
            onClick={() => setStatusFilter(status)}
            count={counts.get(status)}
          >
            {status}
          </FilterPill>
        ))}

        <div className="ml-auto w-64">
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order # or customer"
            className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === 'ALL' ? 'All sales orders' : statusFilter}
          </CardTitle>
        </CardHeader>

        {all.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={90} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={80} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : all.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load sales orders"
            description={all.error.message}
            action={{ label: 'Retry', onClick: all.refetch }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              search
                ? 'No matches'
                : statusFilter === 'ALL'
                  ? 'No sales orders yet'
                  : `No ${statusFilter.toLowerCase()} orders`
            }
            description={
              search
                ? `Nothing matched "${search}".`
                : statusFilter !== 'ALL'
                  ? 'Try clearing the status filter.'
                  : 'New orders show up here as they are created.'
            }
            action={
              search
                ? { label: 'Clear search', onClick: () => setSearch('') }
                : statusFilter !== 'ALL'
                  ? { label: 'Show all', onClick: () => setStatusFilter('ALL') }
                  : { label: '+ New order', onClick: openSalesOrderCreate }
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={r => r.id}
            onRowClick={r => openSalesOrder(r)}
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
      <ProformaDocsModal
        order={proformaViewOrder}
        autoAction="preview"
        onOpenChange={(o) => !o && setProformaViewOrder(null)}
      />
      <ProformaDocsModal
        order={proformaEmailOrder}
        autoAction="email"
        onOpenChange={(o) => !o && setProformaEmailOrder(null)}
      />
      {aiUploadOpen && (
        <AiUploadModal<SODraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — sales order',
            description: 'Drop a customer PO / PI PDF, pick a file, or paste the email text or a screenshot. Gemini extracts the header + line items; you review and save.',
            emptyDraft: emptySODraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: SO_PROMPT, normalize: normalizeSOJson },
            extractSummary: (d) =>
              [d.orderNumber, d.customerName, `${d.items.length} item${d.items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            validate: (d) => {
              if (!d.orderNumber.trim()) return 'Order # is required.';
              if (!d.customerName.trim()) return 'Customer is required.';
              return null;
            },
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <FieldLabel>Order # *</FieldLabel>
                  <Input value={d.orderNumber}
                    onChange={e => setD({ ...d, orderNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Order date</FieldLabel>
                  <Input type="date" value={d.orderDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, orderDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Customer *</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'customers', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.customerName}
                    onPick={v => setD({ ...d, customerName: v })} />
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
                <FormField>
                  <FieldLabel>POA (origin)</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'code',
                    }}
                    value={d.poa}
                    onPick={v => setD({ ...d, poa: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>POD (destination)</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'code',
                    }}
                    value={d.pod}
                    onPick={v => setD({ ...d, pod: v })} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Delivery date</FieldLabel>
                  <Input type="date" value={d.deliveryDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, deliveryDate: e.target.value })}
                    className={inputCls} />
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
                      Line items are extracted but read-only here. Edit in the Sales Order drawer after saving.
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
                orderNumber:  d.orderNumber.trim(),
                customerName: d.customerName.trim(),
                orderDate:    d.orderDate || null,
                deliveryDate: d.deliveryDate || null,
                incoterm:     d.incoterm || null,
                paymentTerms: d.paymentTerms || null,
                poa:          d.poa || null,
                pod:          d.pod || null,
                currency:     d.currency || 'USD',
                notes:        d.notes || null,
                items:        d.items.map((it, idx) => ({
                  id: `li-${Date.now()}-${idx}`,
                  productName: it.productName,
                  quantity: it.quantity ?? 0,
                  unitPrice: it.unitPrice ?? 0,
                  total: (it.quantity ?? 0) * (it.unitPrice ?? 0),
                  description: it.description ?? '',
                })),
                totalAmount:  subtotal,
                status:       'PENDING',
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Sales order created',
                description: `${d.orderNumber} · ${d.customerName}`,
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

export default SalesOrdersV2;
