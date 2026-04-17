// Phase 3B — v2 Freight Quotes.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';
import { useToast } from '../primitives/Toast';

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
  { id: 'agent',   header: 'Agent', cell: r => (
      <span className="text-slate-100 font-medium">{r.agentName ?? '—'}</span>
    ) },
  { id: 'carrier', header: 'Carrier', cell: r => r.carrier ?? '—' },
  { id: 'type',    header: 'Type', cell: r => r.freightType ?? '—' },
  { id: 'route',   header: 'Route', cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.originPort ?? '—')} → {(r.destinationPort ?? '—')}
      </span>
    ) },
  { id: 'rate',    header: 'Rate', align: 'right', mono: true,
    cell: r => fmtMoney(r.rate, r.currency) },
  { id: 'transit', header: 'Transit', align: 'right', mono: true,
    cell: r => r.transitTime !== null ? `${r.transitTime} d` : '—' },
  { id: 'status',  header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'until',   header: 'Valid until', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.validUntil)}
      </span>
    ) },
];

const FreightQuotesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const quotes = useFreightQuotes(search);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.agentName ?? r.id,
        description: `${(r.originPort ?? '—')} → ${(r.destinationPort ?? '—')} · ${fmtMoney(r.rate, r.currency)}`,
      })}
      skeletonCols={[140, 120, 80, 200, 80, 60]}
    />
  );
};

export default FreightQuotesV2;
