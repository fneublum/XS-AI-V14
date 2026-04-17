// Phase 3B — v2 Shipments.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useShipments, Shipment } from '../queries/useShipments';
import { useToast } from '../primitives/Toast';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('DELIVER') || s.includes('ARRIVED')) return 'success';
  if (s.includes('TRANSIT') || s.includes('ROUTE'))   return 'info';
  if (s.includes('BOOK') || s.includes('PEND'))       return 'warning';
  if (s.includes('CANCEL') || s.includes('DELAY'))    return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<Shipment>[] = [
  { id: 'container', header: 'Container', mono: true, cell: r => r.containerNumber ?? '—' },
  { id: 'bl',        header: 'B/L', mono: true, cell: r => r.blNumber ?? '—' },
  { id: 'carrier',   header: 'Carrier', cell: r => r.carrier ?? '—' },
  { id: 'origin',    header: 'Origin', cell: r => r.origin ?? '—' },
  { id: 'dest',      header: 'Destination', cell: r => r.destination ?? '—' },
  { id: 'status',    header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'etd',       header: 'ETD', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.etd)}
      </span>
    ) },
  { id: 'eta',       header: 'ETA', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.eta)}
      </span>
    ) },
];

const ShipmentsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const shipments = useShipments(search);

  return (
    <ListPage<Shipment>
      title="Shipments"
      subtitle={
        shipments.data
          ? `${shipments.data.length} shown${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Container, B/L, carrier"
      columns={columns}
      getRowId={r => r.id}
      data={shipments.data}
      isLoading={shipments.isLoading}
      error={shipments.error}
      onRetry={shipments.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.containerNumber ?? r.id,
        description: `${r.origin ?? '—'} → ${r.destination ?? '—'}`,
      })}
      skeletonCols={[120, 100, 140, 120, 120, 60]}
    />
  );
};

export default ShipmentsV2;
