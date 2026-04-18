// Phase 3B — v2 Freight Quotes.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { FreightQuoteAiUploadModal } from '../components/FreightQuoteAiUploadModal';
import { useRowCrud } from '../components/useRowCrud';
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

const FreightQuotesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const quotes = useFreightQuotes(search);

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
        <FreightQuoteAiUploadModal
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
        />
      )}
      {drawers}
    </>
  );
};

export default FreightQuotesV2;
