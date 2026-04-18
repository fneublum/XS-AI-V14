// Phase 3B — v2 Freight Quotes.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';

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

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
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
  { id: 'carrier', header: 'Carrier', sortable: true, filterable: true,
    value: r => r.carrier ?? '', cell: r => r.carrier ?? '—' },
  { id: 'type', header: 'Type', sortable: true, filterable: true,
    value: r => r.freightType ?? '', cell: r => r.freightType ?? '—' },
  { id: 'route', header: 'Route', sortable: true, filterable: true,
    value: r => `${r.originPort ?? ''} → ${r.destinationPort ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.originPort ?? '—')} → {(r.destinationPort ?? '—')}
      </span>
    ) },
  { id: 'rate', header: 'Rate', align: 'right', mono: true, sortable: true,
    value: r => r.rate ?? 0,
    cell: r => fmtMoney(r.rate, r.currency) },
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

const fields: FieldDef[] = [
  { key: 'agentName',       label: 'Agent', required: true, fullWidth: true },
  { key: 'carrier',         label: 'Carrier' },
  { key: 'freightType',     label: 'Type', type: 'select',
    options: ['OCEAN', 'AIR', 'TRUCK', 'RAIL'] },
  { key: 'originPort',      label: 'Origin port', mono: true },
  { key: 'destinationPort', label: 'Destination port', mono: true },
  { key: 'rate',            label: 'Rate', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'currency',        label: 'Currency', mono: true, defaultValue: 'USD' },
  { key: 'transitTime',     label: 'Transit (days)', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'validUntil',      label: 'Valid until', type: 'date' },
  { key: 'status',          label: 'Status', type: 'select',
    options: ['ACTIVE', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED'],
    defaultValue: 'ACTIVE' },
];

const FreightQuotesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
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
        searchPlaceholder="Agent, carrier, port"
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
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New quote
          </Button>
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
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default FreightQuotesV2;
