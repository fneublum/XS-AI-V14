// Phase 3B — v2 Bill of Ladings.

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
import { useBillOfLadings, BillOfLading } from '../queries/useBillOfLadings';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('RELEASE') || s.includes('SURRENDER'))  return 'success';
  if (s.includes('ISSUED') || s.includes('ACTIVE'))      return 'info';
  if (s.includes('PEND') || s.includes('DRAFT'))         return 'warning';
  if (s.includes('CANCEL'))                              return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<BillOfLading>[] = [
  { id: 'bl', header: 'B/L #', mono: true, sortable: true, filterable: true,
    value: r => r.blNumber, cell: r => r.blNumber },
  { id: 'shipper', header: 'Shipper', sortable: true, filterable: true,
    value: r => r.shipper ?? '',
    cell: r => <span className="text-slate-100">{r.shipper ?? '—'}</span> },
  { id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
    value: r => r.consignee ?? '', cell: r => r.consignee ?? '—' },
  { id: 'route', header: 'POL → POD', sortable: true, filterable: true,
    value: r => `${r.portLoading ?? ''} → ${r.portDischarge ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.portLoading ?? '—')} → {(r.portDischarge ?? '—')}
      </span>
    ) },
  { id: 'vessel', header: 'Vessel / Voyage', sortable: true, filterable: true,
    value: r => r.vesselVoyage ?? '',
    cell: r => <span className="font-mono text-[11.5px] text-slate-400">{r.vesselVoyage ?? '—'}</span> },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'shipped', header: 'Shipped', align: 'right', sortable: true,
    value: r => r.shippedDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.shippedDate)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'blNumber',      label: 'B/L #', required: true, mono: true },
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
  { key: 'vesselVoyage',  label: 'Vessel / Voyage', mono: true, fullWidth: true },
  { key: 'portLoading', label: 'POL', mono: true,
    source: {
      table: 'ports', valueColumn: 'code', labelColumn: 'name',
      secondaryColumn: 'country',
    } },
  { key: 'portDischarge', label: 'POD', mono: true,
    source: {
      table: 'ports', valueColumn: 'code', labelColumn: 'name',
      secondaryColumn: 'country',
    } },
  { key: 'container',     label: 'Container', mono: true },
  { key: 'status',        label: 'Status', type: 'select',
    options: ['DRAFT', 'ISSUED', 'RELEASED', 'SURRENDERED', 'CANCELLED'],
    defaultValue: 'ISSUED' },
  { key: 'shippedDate',   label: 'Shipped date', type: 'date' },
];

interface BLDraft {
  blNumber: string;
  shipper: string;
  consignee: string;
  notify: string;
  vesselVoyage: string;
  portLoading: string;
  portDischarge: string;
  container: string;
  seal: string;
  packages: string;
  grossWeight: string;
  measurement: string;
  status: string;
  shippedDate: string;
}

const emptyBLDraft = (): BLDraft => ({
  blNumber: '', shipper: '', consignee: '', notify: '', vesselVoyage: '',
  portLoading: '', portDischarge: '', container: '', seal: '', packages: '',
  grossWeight: '', measurement: '', status: 'ISSUED', shippedDate: '',
});

const BL_PROMPT = `You are extracting fields from an OCEAN BILL OF LADING (straight or negotiable).
Return JSON with exactly these keys; missing values must be null.

{
  "blNumber":       string | null,
  "shipper":        string | null,
  "consignee":      string | null,
  "notify":         string | null,
  "vesselVoyage":   string | null,
  "portLoading":    string | null,   // 5-char UN/LOCODE origin port
  "portDischarge":  string | null,   // 5-char UN/LOCODE destination port
  "container":      string | null,
  "seal":           string | null,
  "packages":       string | null,
  "grossWeight":    string | null,   // with units preserved if present
  "measurement":    string | null,   // e.g. "67.5 CBM"
  "status":         "DRAFT" | "ISSUED" | "RELEASED" | "SURRENDERED" | "CANCELLED" | null,
  "shippedDate":    string | null    // YYYY-MM-DD
}

Rules:
- UN/LOCODEs are 5 uppercase characters.
- Convert dates to YYYY-MM-DD.
- Return ONLY valid JSON.`;

function normalizeBLJson(parsed: Record<string, unknown>): BLDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const status = str('status').toUpperCase();
  return {
    blNumber:       str('blNumber'),
    shipper:        str('shipper'),
    consignee:      str('consignee'),
    notify:         str('notify'),
    vesselVoyage:   str('vesselVoyage'),
    portLoading:    str('portLoading').toUpperCase().slice(0, 5),
    portDischarge:  str('portDischarge').toUpperCase().slice(0, 5),
    container:      str('container'),
    seal:           str('seal'),
    packages:       str('packages'),
    grossWeight:    str('grossWeight'),
    measurement:    str('measurement'),
    status:         (['DRAFT','ISSUED','RELEASED','SURRENDERED','CANCELLED'].includes(status)
                      ? status : 'ISSUED'),
    shippedDate:    str('shippedDate'),
  };
}

const BillOfLadingsV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const bols = useBillOfLadings(search);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'bill_landings',
    listQueryKeys: ['billOfLadings', 'logisticsDocs'],
    idPrefix: 'BL',
  });

  const { rowActions, drawers, openView } = useRowCrud<BillOfLading>({
    table: 'bill_landings',
    listQueryKeys: ['billOfLadings', 'logisticsDocs'],
    rowLabel: r => r.blNumber,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<BillOfLading>
        title="Bill of Ladings"
        subtitle={
          bols.data
            ? `${bols.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="B/L, shipper, consignee"
        cardTitle="All B/Ls"
        columns={columns}
        getRowId={r => r.id}
        data={bols.data}
        isLoading={bols.isLoading}
        error={bols.error}
        onRetry={bols.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New B/L
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New B/L', onClick: openCreate }}
        skeletonCols={[120, 160, 160, 180, 60, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New bill of lading"
        description="Log a B/L received from the carrier."
        table="bill_landings"
        idPrefix="BL"
        listQueryKeys={['billOfLadings', 'logisticsDocs']}
        scopeByCompany
        fields={fields}
      />
      {aiUploadOpen && (
        <AiUploadModal<BLDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — bill of lading',
            description: 'Drop a B/L PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyBLDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: BL_PROMPT, normalize: normalizeBLJson },
            extractSummary: (d) =>
              [d.blNumber, d.portLoading, d.portDischarge].filter(Boolean).join(' · ') || null,
            validate: (d) => d.blNumber.trim() === '' ? 'B/L # is required.' : null,
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField className="col-span-2">
                  <FieldLabel>B/L # *</FieldLabel>
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
                <FormField className="col-span-2">
                  <FieldLabel>Notify party</FieldLabel>
                  <Input value={d.notify}
                    onChange={e => setD({ ...d, notify: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Vessel / Voyage</FieldLabel>
                  <Input value={d.vesselVoyage}
                    onChange={e => setD({ ...d, vesselVoyage: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>POL</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country' }}
                    value={d.portLoading} mono
                    onPick={v => setD({ ...d, portLoading: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>POD</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country' }}
                    value={d.portDischarge} mono
                    onPick={v => setD({ ...d, portDischarge: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Container</FieldLabel>
                  <Input value={d.container}
                    onChange={e => setD({ ...d, container: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Seal</FieldLabel>
                  <Input value={d.seal}
                    onChange={e => setD({ ...d, seal: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Packages</FieldLabel>
                  <Input value={d.packages}
                    onChange={e => setD({ ...d, packages: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Gross weight</FieldLabel>
                  <Input value={d.grossWeight}
                    onChange={e => setD({ ...d, grossWeight: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Measurement</FieldLabel>
                  <Input value={d.measurement}
                    onChange={e => setD({ ...d, measurement: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Shipped date</FieldLabel>
                  <Input type="date" value={d.shippedDate}
                    onChange={e => setD({ ...d, shippedDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Status</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(['DRAFT','ISSUED','RELEASED','SURRENDERED','CANCELLED'] as const).map(opt => (
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
                blNumber:      d.blNumber.trim(),
                shipper:       d.shipper.trim() || null,
                consignee:     d.consignee.trim() || null,
                notify:        d.notify.trim() || null,
                vesselVoyage:  d.vesselVoyage.trim() || null,
                portLoading:   d.portLoading.trim().toUpperCase() || null,
                portDischarge: d.portDischarge.trim().toUpperCase() || null,
                container:     d.container.trim() || null,
                seal:          d.seal.trim() || null,
                packages:      d.packages.trim() || null,
                grossWeight:   d.grossWeight.trim() || null,
                measurement:   d.measurement.trim() || null,
                status:        d.status || 'ISSUED',
                shippedDate:   d.shippedDate || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({ kind: 'success', title: 'B/L saved', description: d.blNumber });
            },
          }}
        />
      )}
      {drawers}
    </>
  );
};

const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

export default BillOfLadingsV2;
