// Phase 3B — v2 Packing Lists.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { AiUploadModal } from '../components/AiUploadModal';
import { useRowCrud } from '../components/useRowCrud';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { useEntityInsert } from '../queries/useEntityMutations';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { usePackingLists, PackingList } from '../queries/usePackingLists';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('SHIPPED') || s.includes('DELIVER')) return 'success';
  if (s.includes('ISSUED') || s.includes('CONFIRM'))  return 'info';
  if (s.includes('DRAFT') || s.includes('PEND'))      return 'warning';
  if (s.includes('CANCEL'))                           return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<PackingList>[] = [
  { id: 'pl', header: 'PL #', mono: true, sortable: true, filterable: true,
    value: r => r.plNumber, cell: r => r.plNumber },
  { id: 'bl', header: 'B/L #', mono: true, sortable: true, filterable: true,
    value: r => r.blNumber ?? '',
    cell: r => <span className="text-slate-500">{r.blNumber ?? '—'}</span> },
  { id: 'so', header: 'SO #', mono: true, sortable: true, filterable: true,
    value: r => r.soNumber ?? '',
    cell: r => <span className="text-slate-500">{r.soNumber ?? '—'}</span> },
  { id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
    value: r => r.consignee ?? '',
    cell: r => <span className="text-slate-100">{r.consignee ?? '—'}</span> },
  { id: 'container', header: 'Container', mono: true, sortable: true, filterable: true,
    value: r => r.containerNumber ?? '', cell: r => r.containerNumber ?? '—' },
  { id: 'carrier', header: 'Carrier', sortable: true, filterable: true,
    value: r => r.carrier ?? '', cell: r => r.carrier ?? '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'ship', header: 'Ship date', align: 'right', sortable: true,
    value: r => r.scheduledShipDate ?? r.date ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.scheduledShipDate ?? r.date)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'plNumber',          label: 'PL #', required: true, mono: true },
  { key: 'soNumber',          label: 'SO #', mono: true },
  { key: 'blNumber',          label: 'B/L #', mono: true },
  { key: 'shipper', label: 'Shipper',
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'consignee', label: 'Consignee',
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'carrier', label: 'Carrier',
    source: {
      table: 'carriers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'scac', scopeByCompany: true,
    } },
  { key: 'containerNumber',   label: 'Container', mono: true },
  { key: 'status',            label: 'Status', type: 'select',
    options: ['DRAFT', 'ISSUED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    defaultValue: 'DRAFT' },
  { key: 'scheduledShipDate', label: 'Scheduled ship', type: 'date' },
  { key: 'date',              label: 'Actual ship', type: 'date' },
];

interface PLDraft {
  plNumber: string;
  soNumber: string;
  blNumber: string;
  shipper: string;
  consignee: string;
  carrier: string;
  containerNumber: string;
  status: string;
  scheduledShipDate: string;
  date: string;
}

const emptyPLDraft = (): PLDraft => ({
  plNumber: '', soNumber: '', blNumber: '', shipper: '', consignee: '',
  carrier: '', containerNumber: '', status: 'DRAFT',
  scheduledShipDate: '', date: '',
});

const PL_PROMPT = `You are extracting fields from a PACKING LIST or straight B/L that
functions as a packing list. Return JSON with exactly these keys; missing
values must be null.

{
  "plNumber":          string | null,
  "soNumber":          string | null,
  "blNumber":          string | null,
  "shipper":           string | null,
  "consignee":         string | null,
  "carrier":           string | null,
  "containerNumber":   string | null,
  "status":            "DRAFT" | "ISSUED" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | null,
  "scheduledShipDate": string | null,  // YYYY-MM-DD
  "date":              string | null   // YYYY-MM-DD (actual ship date if shipped)
}

Rules:
- Convert dates to YYYY-MM-DD.
- Return ONLY valid JSON.`;

function normalizePLJson(parsed: Record<string, unknown>): PLDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const status = str('status').toUpperCase();
  return {
    plNumber:          str('plNumber'),
    soNumber:          str('soNumber'),
    blNumber:          str('blNumber'),
    shipper:           str('shipper'),
    consignee:         str('consignee'),
    carrier:           str('carrier'),
    containerNumber:   str('containerNumber'),
    status:            (['DRAFT','ISSUED','CONFIRMED','SHIPPED','DELIVERED','CANCELLED'].includes(status)
                         ? status : 'DRAFT'),
    scheduledShipDate: str('scheduledShipDate'),
    date:              str('date'),
  };
}

const PackingListsV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const pls = usePackingLists(search);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    idPrefix: 'PL',
  });

  const { rowActions, drawers, openView } = useRowCrud<PackingList>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    rowLabel: r => r.plNumber,
    fields,
    onEmail: (r) => setEmailDraft({
      to: '',
      subject: `Packing List ${r.plNumber}${r.soNumber ? ` — SO ${r.soNumber}` : ''}`,
      body: [
        `Hello${r.consignee ? ' ' + r.consignee : ''},`,
        '',
        `Please find attached the packing list ${r.plNumber}.`,
        r.containerNumber ? `Container: ${r.containerNumber}` : '',
        r.carrier ? `Carrier: ${r.carrier}` : '',
        r.scheduledShipDate ? `Scheduled ship: ${r.scheduledShipDate.slice(0, 10)}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `PL ${r.plNumber}`,
    }),
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<PackingList>
        title="Packing Lists"
        subtitle={
          pls.data
            ? `${pls.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="PL, B/L, consignee"
        columns={columns}
        getRowId={r => r.id}
        data={pls.data}
        isLoading={pls.isLoading}
        error={pls.error}
        onRetry={pls.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New packing list
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New packing list', onClick: openCreate }}
        skeletonCols={[100, 100, 100, 160, 120, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New packing list"
        description="Create a packing list for an outgoing shipment."
        table="packing_lists"
        idPrefix="PL"
        listQueryKeys={['packingLists', 'logisticsDocs']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
      {aiUploadOpen && (
        <AiUploadModal<PLDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — packing list',
            description: 'Drop a PL PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyPLDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: PL_PROMPT, normalize: normalizePLJson },
            extractSummary: (d) =>
              [d.plNumber, d.containerNumber].filter(Boolean).join(' · ') || null,
            validate: (d) => d.plNumber.trim() === '' ? 'PL # is required.' : null,
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField className="col-span-2">
                  <FieldLabel>PL # *</FieldLabel>
                  <Input value={d.plNumber}
                    onChange={e => setD({ ...d, plNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>SO #</FieldLabel>
                  <Input value={d.soNumber}
                    onChange={e => setD({ ...d, soNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>B/L #</FieldLabel>
                  <Input value={d.blNumber}
                    onChange={e => setD({ ...d, blNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Shipper</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                    value={d.shipper}
                    onPick={v => setD({ ...d, shipper: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Consignee</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                    value={d.consignee}
                    onPick={v => setD({ ...d, consignee: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Carrier</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'carriers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'scac', scopeByCompany: true }}
                    value={d.carrier}
                    onPick={v => setD({ ...d, carrier: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Container</FieldLabel>
                  <Input value={d.containerNumber}
                    onChange={e => setD({ ...d, containerNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Scheduled ship</FieldLabel>
                  <Input type="date" value={d.scheduledShipDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, scheduledShipDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Actual ship</FieldLabel>
                  <Input type="date" value={d.date?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, date: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Status</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(['DRAFT','ISSUED','CONFIRMED','SHIPPED','DELIVERED','CANCELLED'] as const).map(opt => (
                      <button key={opt} type="button"
                        onClick={() => setD({ ...d, status: opt })}
                        className={d.status === opt
                          ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </FormField>
              </div>
            ),
            save: async (d) => {
              const payload: Record<string, unknown> = {
                plNumber:          d.plNumber.trim(),
                soNumber:          d.soNumber.trim() || null,
                blNumber:          d.blNumber.trim() || null,
                shipper:           d.shipper.trim() || null,
                consignee:         d.consignee.trim() || null,
                carrier:           d.carrier.trim() || null,
                containerNumber:   d.containerNumber.trim() || null,
                status:            d.status || 'DRAFT',
                scheduledShipDate: d.scheduledShipDate || null,
                date:              d.date || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({ kind: 'success', title: 'Packing list saved', description: d.plNumber });
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

export default PackingListsV2;
