// Phase 3B — v2 Freight Quotes.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { useRowCrud } from '../components/useRowCrud';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';
import { formatDate as fmtDate } from '../lib/formatDate';

const fmtMoney = (n: number | null, currency: string) => {
  if (n === null) return '—';
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
  if (s.includes('ACTIVE') || s.includes('ACCEPT')) return 'success';
  if (s.includes('PEND'))                            return 'warning';
  if (s.includes('EXPIR') || s.includes('REJECT'))   return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<FreightQuote>[] = [
  { id: 'agent', header: 'Agent', sortable: true, filterable: true,
    value: r => r.agentName ?? '',
    cell: r => <span className="text-slate-100 font-medium">{r.agentName ?? '—'}</span> },
  { id: 'type', header: 'Type', sortable: true, filterable: true,
    value: r => r.freightType ?? '', cell: r => r.freightType ?? '—' },
  { id: 'route', header: 'Route', sortable: true, filterable: true,
    value: r => `${r.originPort ?? ''} → ${r.destinationPort ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.originPort ?? '—')} → {(r.destinationPort ?? '—')}
      </span>
    ) },
  // POA / POD — UN/LOCODE-style 5-char codes pulled directly from
  // origin_port_code / destination_port_code on the freight_quotes row.
  { id: 'poa', header: 'POA', mono: true, sortable: true, filterable: true,
    value: r => (r.originPortCode ?? '').slice(0, 5),
    cell: r => (
      <span className="font-mono uppercase tracking-wider text-[11.5px] text-slate-300">
        {(r.originPortCode ?? '—').slice(0, 5)}
      </span>
    ) },
  { id: 'pod', header: 'POD', mono: true, sortable: true, filterable: true,
    value: r => (r.destinationPortCode ?? '').slice(0, 5),
    cell: r => (
      <span className="font-mono uppercase tracking-wider text-[11.5px] text-slate-300">
        {(r.destinationPortCode ?? '—').slice(0, 5)}
      </span>
    ) },
  { id: 'rate', header: 'Rate', align: 'right', mono: true, sortable: true,
    value: r => r.rate ?? 0,
    cell: r => fmtMoney(r.rate, r.currency) },
  { id: 'free', header: 'Free time', align: 'right', mono: true, sortable: true,
    value: r => r.freeTime ?? 0,
    cell: r => r.freeTime !== null ? `${r.freeTime} d` : '—' },
  { id: 'transit', header: 'Transit', align: 'right', mono: true, sortable: true,
    value: r => r.transitTime ?? 0,
    cell: r => r.transitTime !== null ? `${r.transitTime} d` : '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'until', header: 'Valid until', align: 'right', sortable: true,
    value: r => r.validUntil ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.validUntil)}
      </span>
    ) },
];

// Row objects come back camelCase from useFreightQuotes (mapped in the
// query), but freight_quotes itself is snake_case. `dbKey` bridges the
// two: read via `key`, write via `dbKey`. Reference-table dropdowns
// use `source` so the user picks from live data. Picking a port writes
// the code and auto-fills the friendly name via `writeAlso`.
const fields: FieldDef[] = [
  { key: 'agentName', dbKey: 'agent_name', label: 'Agent', required: true, fullWidth: true,
    source: {
      table: 'cargo_agents',
      valueColumn: 'name',
      labelColumn: 'name',
      secondaryColumn: 'country',
      scopeByCompany: true,
    } },
  { key: 'carrier', label: 'Carrier',
    source: {
      table: 'carriers',
      valueColumn: 'name',
      labelColumn: 'name',
      secondaryColumn: 'scac',
      scopeByCompany: true,
    } },
  { key: 'freightType', dbKey: 'freight_type', label: 'Type', type: 'select',
    options: ['OCEAN', 'AIR', 'TRUCK', 'RAIL'] },
  { key: 'originPortCode', dbKey: 'origin_port_code',
    label: 'POA (origin port code)', mono: true,
    source: {
      table: 'ports',
      valueColumn: 'code',
      labelColumn: 'name',
      secondaryColumn: 'country',
      writeAlso: [{ sourceColumn: 'name', targetKey: 'originPort' }],
    } },
  { key: 'destinationPortCode', dbKey: 'destination_port_code',
    label: 'POD (destination port code)', mono: true,
    source: {
      table: 'ports',
      valueColumn: 'code',
      labelColumn: 'name',
      secondaryColumn: 'country',
      writeAlso: [{ sourceColumn: 'name', targetKey: 'destinationPort' }],
    } },
  { key: 'originPort', dbKey: 'origin_port', label: 'Origin port (name)' },
  { key: 'destinationPort', dbKey: 'destination_port', label: 'Destination port (name)' },
  { key: 'rate', label: 'Rate', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'currency', label: 'Currency', mono: true, defaultValue: 'USD' },
  { key: 'freeTime', dbKey: 'free_time', label: 'Free time (days)',
    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'transitTime', dbKey: 'transit_time', label: 'Transit (days)',
    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'validUntil', dbKey: 'valid_until', label: 'Valid until', type: 'date' },
  { key: 'status', label: 'Status', type: 'select',
    options: ['ACTIVE', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED'],
    defaultValue: 'ACTIVE' },
];

interface FQDraft {
  agentName: string;
  carrier: string;
  freightType: string;
  originPort: string;
  originPortCode: string;
  destinationPort: string;
  destinationPortCode: string;
  rate: string;
  currency: string;
  freeTime: string;
  transitTime: string;
  validUntil: string;
  status: string;
  notes: string;
}

const emptyFQDraft = (): FQDraft => ({
  agentName: '', carrier: '', freightType: '',
  originPort: '', originPortCode: '',
  destinationPort: '', destinationPortCode: '',
  rate: '', currency: 'USD', freeTime: '', transitTime: '',
  validUntil: '', status: 'ACTIVE', notes: '',
});

const FQ_PROMPT = `You are extracting fields from a FREIGHT QUOTE (ocean, air, or trucking).
Return a JSON object with exactly these keys. Missing values must be null.

{
  "agentName":           string | null,
  "carrier":             string | null,
  "freightType":         "OCEAN" | "AIR" | "TRUCK" | "RAIL" | null,
  "originPort":          string | null,
  "originPortCode":      string | null,   // 5-char UN/LOCODE
  "destinationPort":     string | null,
  "destinationPortCode": string | null,
  "rate":                number | null,
  "currency":            string | null,
  "freeTime":            number | null,
  "transitTime":         number | null,
  "validUntil":          string | null,   // YYYY-MM-DD
  "status":              "ACTIVE" | "PENDING" | "EXPIRED" | null,
  "notes":               string | null
}

Return ONLY valid JSON.`;

function normalizeFQJson(parsed: Record<string, unknown>): FQDraft {
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
  const ft = str('freightType').toUpperCase();
  const status = str('status').toUpperCase();
  return {
    agentName:           str('agentName'),
    carrier:             str('carrier'),
    freightType:         (['OCEAN','AIR','TRUCK','RAIL'].includes(ft) ? ft : ''),
    originPort:          str('originPort'),
    originPortCode:      str('originPortCode').toUpperCase().slice(0, 5),
    destinationPort:     str('destinationPort'),
    destinationPortCode: str('destinationPortCode').toUpperCase().slice(0, 5),
    rate:                num('rate'),
    currency:            str('currency').toUpperCase() || 'USD',
    freeTime:            num('freeTime'),
    transitTime:         num('transitTime'),
    validUntil:          str('validUntil'),
    status:              (['ACTIVE','PENDING','EXPIRED'].includes(status) ? status : 'ACTIVE'),
    notes:               str('notes'),
  };
}

const FreightQuotesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const quotes = useFreightQuotes(search);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    idPrefix: 'FQ',
    withCreatedAt: false,
  });

  const { rowActions, drawers, openView } = useRowCrud<FreightQuote>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    rowLabel: r => r.agentName ?? r.id,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<FreightQuote>
        title="Freight Quotes"
        subtitle={
          quotes.data
            ? `${quotes.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Agent, port, POA / POD code"
        cardTitle="All freight quotes"
        columns={columns}
        getRowId={r => r.id}
        data={quotes.data}
        isLoading={quotes.isLoading}
        error={quotes.error}
        onRetry={quotes.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New quote
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New quote', onClick: openCreate }}
        skeletonCols={[140, 120, 80, 200, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New freight quote"
        description="Record a quote received from a forwarder."
        table="freight_quotes"
        idPrefix="FQ"
        listQueryKeys={['freightQuotes']}
        scopeByCompany
        companyIdColumn="company_id"
        fields={fields}
      />
      {aiUploadOpen && (
        <AiUploadModal<FQDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — freight quote',
            description: 'Drop a PDF / image, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyFQDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: FQ_PROMPT, normalize: normalizeFQJson },
            extractSummary: (d) =>
              [d.agentName, d.originPortCode, d.destinationPortCode].filter(Boolean).join(' · '),
            validate: (d) => d.agentName.trim() === '' ? 'Agent is required.' : null,
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField className="col-span-2">
                  <FieldLabel>Agent *</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                    value={d.agentName}
                    onPick={v => setD({ ...d, agentName: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Carrier</FieldLabel>
                  <SupabaseSelectField
                    source={{ table: 'carriers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'scac', scopeByCompany: true }}
                    value={d.carrier}
                    onPick={v => setD({ ...d, carrier: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Type</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(['OCEAN','AIR','TRUCK','RAIL'] as const).map(opt => (
                      <button key={opt} type="button"
                        onClick={() => setD({ ...d, freightType: opt })}
                        className={d.freightType === opt
                          ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </FormField>
                <FormField>
                  <FieldLabel>POA (origin port)</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'code', labelColumn: 'name',
                      secondaryColumn: 'country',
                      writeAlso: [{ sourceColumn: 'name', targetKey: 'originPort' }],
                    }}
                    value={d.originPortCode} mono
                    onPick={(v, extras) => setD({
                      ...d,
                      originPortCode: v,
                      originPort: extras.originPort ?? d.originPort,
                    })} />
                </FormField>
                <FormField>
                  <FieldLabel>POD (destination port)</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'code', labelColumn: 'name',
                      secondaryColumn: 'country',
                      writeAlso: [{ sourceColumn: 'name', targetKey: 'destinationPort' }],
                    }}
                    value={d.destinationPortCode} mono
                    onPick={(v, extras) => setD({
                      ...d,
                      destinationPortCode: v,
                      destinationPort: extras.destinationPort ?? d.destinationPort,
                    })} />
                </FormField>
                <FormField>
                  <FieldLabel>Origin port (name)</FieldLabel>
                  <Input value={d.originPort}
                    onChange={e => setD({ ...d, originPort: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Destination port (name)</FieldLabel>
                  <Input value={d.destinationPort}
                    onChange={e => setD({ ...d, destinationPort: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Rate</FieldLabel>
                  <Input type="number" value={d.rate}
                    onChange={e => setD({ ...d, rate: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Currency</FieldLabel>
                  <Input value={d.currency}
                    onChange={e => setD({ ...d, currency: e.target.value.toUpperCase() })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Free time (days)</FieldLabel>
                  <Input type="number" value={d.freeTime}
                    onChange={e => setD({ ...d, freeTime: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Transit (days)</FieldLabel>
                  <Input type="number" value={d.transitTime}
                    onChange={e => setD({ ...d, transitTime: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Valid until</FieldLabel>
                  <Input type="date" value={d.validUntil}
                    onChange={e => setD({ ...d, validUntil: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Status</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(['ACTIVE','PENDING','ACCEPTED','EXPIRED','REJECTED'] as const).map(opt => (
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
                agent_name:            d.agentName.trim() || null,
                carrier:               d.carrier.trim() || null,
                freight_type:          d.freightType.trim() || null,
                origin_port:           d.originPort.trim() || null,
                origin_port_code:      d.originPortCode.trim().toUpperCase() || null,
                destination_port:      d.destinationPort.trim() || null,
                destination_port_code: d.destinationPortCode.trim().toUpperCase() || null,
                rate:                  d.rate.trim() === '' ? null : Number(d.rate),
                currency:              d.currency.trim().toUpperCase() || 'USD',
                free_time:             d.freeTime.trim() === '' ? null : Number(d.freeTime),
                transit_time:          d.transitTime.trim() === '' ? null : Number(d.transitTime),
                valid_until:           d.validUntil.trim() || null,
                status:                d.status.trim().toUpperCase() || 'ACTIVE',
                observation:           d.notes.trim() || null,
                date_added:            new Date().toISOString().slice(0, 10),
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.company_id = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Freight quote saved',
                description: `${d.agentName} · ${d.originPortCode || d.originPort} → ${d.destinationPortCode || d.destinationPort}`,
              });
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

export default FreightQuotesV2;
