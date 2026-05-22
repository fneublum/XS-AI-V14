// Phase 3B — v2 Freight Quotes.

import React, { useState } from 'react';
import { Sparkles, Mail } from 'lucide-react';
import { Badge, Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { SendQuoteRequestModal } from '../components/SendQuoteRequestModal';
import { useRowCrud } from '../components/useRowCrud';
import { useEntityInsert } from '../queries/useEntityMutations';
import { nextFQNumber } from '../lib/fqNumber';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';
import { formatDate as fmtDate } from '../lib/formatDate';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { vividStatusClass, BadgeTone } from '../lib/statusBadge';

const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('ACTIVE') || s.includes('ACCEPT')) return 'success';
  if (s.includes('PEND'))                            return 'warning';
  if (s.includes('EXPIR') || s.includes('REJECT'))   return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<FreightQuote>[] = [
  // `freight_quotes` has no separate number column — `id` (e.g.
  // `FQ1769642878151`) is the only identifier. Surface it up front.
  { id: 'number', header: 'Quote #', mono: true, sortable: true, filterable: true,
    value: r => r.id, cell: r => r.id },
  { id: 'agent', header: 'Agent', sortable: true, filterable: true,
    value: r => r.agentName ?? '',
    cell: r => <span className="text-slate-100 font-medium">{r.agentName ?? '—'}</span> },
  { id: 'type', header: 'Type', sortable: true, filterable: true,
    value: r => r.freightType ?? '', cell: r => r.freightType ?? '—' },
  // Pickup city — replaces the old Route column (POA/POD already
  // covered by the columns to the right). Shows where the cargo
  // physically gets picked up before reaching the origin port.
  { id: 'pickupCity', header: 'Pickup city', sortable: true, filterable: true,
    value: r => r.pickupCity ?? '',
    cell: r => (
      <span className="text-[11.5px] text-slate-300">{r.pickupCity ?? '—'}</span>
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
    cell: r => {
      const tone = statusTone(r.status);
      return <Badge variant={tone} dot className={vividStatusClass(tone)}>{r.status}</Badge>;
    } },
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
  // Status sits next to Carrier per layout. Schema-driven drawer
  // renders fields left-to-right in a 2-col grid so order = layout.
  { key: 'status', label: 'Status', type: 'select',
    options: ['ACTIVE', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED'],
    defaultValue: 'ACTIVE' },
  // Type / freightType is now hidden in the editor (assumes OCEAN by
  // default for this trade lane). Defaults are still written on
  // create via emptyFreightQuote → freightType: ''. AI upload may
  // populate it; existing rows keep their value.
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
  // Shadow fields — the POA/POD code selectors above resolve the
  // human-readable port name via `writeAlso` and write it into these
  // keys. We keep them in the schema so the InspectDrawer's save loop
  // persists them, but flag `hidden` so the drawer doesn't render
  // duplicate inputs. The Freight Quotes table's `Route` column reads
  // from these saved name fields, so without them the route shows
  // blank dashes after a save.
  { key: 'originPort',      dbKey: 'origin_port',      label: 'Origin port (name)',      hidden: true },
  { key: 'destinationPort', dbKey: 'destination_port', label: 'Destination port (name)', hidden: true },
  { key: 'rate', label: 'Rate', type: 'number', mono: true, min: 0, step: 1 },
  // Currency is hidden in the editor (defaulted to USD for this trade
  // lane). Existing rows keep their value; new rows pick up the
  // emptyFreightQuote default.
  { key: 'freeTime', dbKey: 'free_time', label: 'Free time (days)',
    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'transitTime', dbKey: 'transit_time', label: 'Transit (days)',
    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'validUntil', dbKey: 'valid_until', label: 'Valid until', type: 'date' },
  // (Status moved up — appears right of Carrier above.)

  // Pickup / delivery — free-form addresses (e.g. "200 Curtis Harley
  // Drive, Spartanburg, SC"). There's no canonical `locations` table,
  // so we source the dropdown from distinct `pickup_location` /
  // `delivery_location` values already stored on freight_quotes. That
  // surfaces the locations this org has used before as quick picks
  // while `allowFreeText` still lets the agent type a brand-new one.
  { key: 'pickupLocation', dbKey: 'pickup_location', label: 'Pickup location', fullWidth: true,
    source: { table: 'freight_quotes', valueColumn: 'pickup_location',
              orderBy: 'pickup_location', scopeByCompany: true, companyIdColumn: 'company_id' },
    allowFreeText: true },
  { key: 'pickupZip',      dbKey: 'pickup_zip', label: 'Pickup ZIP', mono: true },
  { key: 'pickupCity',     label: 'Pickup city' },
  { key: 'pickupCountry',  label: 'Pickup country' },
  { key: 'deliveryLocation', dbKey: 'delivery_location', label: 'Delivery location', fullWidth: true,
    source: { table: 'freight_quotes', valueColumn: 'delivery_location',
              orderBy: 'delivery_location', scopeByCompany: true, companyIdColumn: 'company_id' },
    allowFreeText: true },
  { key: 'deliveryZip',    dbKey: 'delivery_zip', label: 'Delivery ZIP', mono: true },

  // Equipment + demurrage / release windows.
  { key: 'containerCount',   dbKey: 'container_count',   label: 'Container count',
    type: 'number', mono: true, min: 0, step: 1 },
  // The four container types this trade lane actually uses. Trimmed
  // from the full ISO list so the dropdown is scannable.
  { key: 'containerType', dbKey: 'container_type', label: 'Container type', type: 'select',
    options: ['20DC', '20HC', '40DC', '40HC'] },
  { key: 'containerReturn',  dbKey: 'container_return',  label: 'Container return' },
  // `BL release` and `Chassis` hidden — rarely edited and were
  // cluttering the drawer. Keep their DB columns intact for
  // round-trip; existing values still load and persist via the
  // schema's catch-all.

  // `overweight` flag remains visible. `is_all_in` is a true bool
  // column; we explicitly cast to JSON bool so PostgREST never sees
  // a string "true"/"false".
  { key: 'overweight', label: 'Overweight', type: 'select', castType: 'number',
    options: [{ value: '', label: '—' }, { value: '1', label: 'Yes' }, { value: '0', label: 'No' }] },
  { key: 'isAllIn',    dbKey: 'is_all_in', label: 'All-in rate', type: 'select', castType: 'boolean',
    options: [{ value: '', label: '—' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },

  // Cost breakdown — the "Rate" field above is usually the all-in
  // figure; itemisation is optional but round-trips via the drawer.
  { key: 'pickupCost',      dbKey: 'pickup_cost',      label: 'Pickup cost',      type: 'number', mono: true, min: 0, step: 1 },
  { key: 'oceanCost',       dbKey: 'ocean_cost',       label: 'Ocean cost',       type: 'number', mono: true, min: 0, step: 1 },
  { key: 'deliveryCost',    dbKey: 'delivery_cost',    label: 'Delivery cost',    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'portFees',        dbKey: 'port_fees',        label: 'Port fees',        type: 'number', mono: true, min: 0, step: 1 },
  { key: 'thc',             label: 'THC',              type: 'number', mono: true, min: 0, step: 1 },
  { key: 'isps',            label: 'ISPS',             type: 'number', mono: true, min: 0, step: 1 },
  { key: 'trs',             label: 'TRS',              type: 'number', mono: true, min: 0, step: 1 },
  { key: 'deconsolidation', label: 'Deconsolidation',  type: 'number', mono: true, min: 0, step: 1 },
  { key: 'securityFee',     dbKey: 'security_fee',     label: 'Security fee',     type: 'number', mono: true, min: 0, step: 1 },
  { key: 'bunkerSurcharge', dbKey: 'bunker_surcharge', label: 'Bunker surcharge', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'exwCharges',      dbKey: 'exw_charges',      label: 'EXW charges',      type: 'number', mono: true, min: 0, step: 1 },

  // Notes.
  { key: 'comments',    label: 'Comments',   type: 'textarea', fullWidth: true },
  { key: 'observation', label: 'Observation', type: 'textarea', fullWidth: true },
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
  const [createSeed, setCreateSeed] = useState<Record<string, string> | undefined>(undefined);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const [sendQuoteOpen, setSendQuoteOpen] = useState(false);
  const quotes = useFreightQuotes(search);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    idPrefix: 'FQ',
    withCreatedAt: false,
  });

  const duplicateQuote = (row: FreightQuote) => {
    const { id: _id, ...rest } = row as unknown as Record<string, unknown>;
    const seed: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v == null) continue;
      if (Array.isArray(v)) seed[k] = v.map(String).join(',');
      else seed[k] = String(v);
    }
    setCreateSeed(seed);
    setCreateOpen(true);
  };

  const { rowActions, drawers, openView } = useRowCrud<FreightQuote>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    rowLabel: r => r.agentName ?? r.id,
    fields,
    onDuplicate: duplicateQuote,
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
        density="compact"
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New quote
            </Button>
            <Button size="sm" onClick={() => setSendQuoteOpen(true)}
              className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 hover:text-indigo-100 hover:border-indigo-400/60 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Mail size={12} />
              Send Quote Request
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
        onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateSeed(undefined); }}
        title={createSeed ? 'Duplicate freight quote' : 'New freight quote'}
        description="Record a quote received from a forwarder."
        table="freight_quotes"
        idPrefix="FQ"
        listQueryKeys={['freightQuotes']}
        scopeByCompany
        companyIdColumn="company_id"
        fields={fields}
        seed={createSeed}
        idGenerator={nextFQNumber}
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
                  <FieldLabel>Rate</FieldLabel>
                  <Input type="number" value={d.rate}
                    onChange={e => setD({ ...d, rate: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
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
              try { payload.id = await nextFQNumber(); } catch { /* fall back to random */ }
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
      <SendQuoteRequestModal
        open={sendQuoteOpen}
        onOpenChange={setSendQuoteOpen}
      />
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
