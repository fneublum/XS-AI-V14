// Phase 3B — v2 Bookings.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useBookings, Booking } from '../queries/useBookings';
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
  if (s.includes('CONFIRM') || s.includes('ROLL'))  return 'info';
  if (s.includes('LOAD') || s.includes('DEPART'))   return 'success';
  if (s.includes('BOOK') || s.includes('PEND'))     return 'warning';
  if (s.includes('CANCEL'))                         return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<Booking>[] = [
  { id: 'number',   header: 'Booking #', mono: true, cell: r => r.bookingNumber },
  { id: 'customer', header: 'Customer', cell: r => (
      <span className="text-slate-100">{r.customer ?? '—'}</span>
    ) },
  { id: 'vessel',   header: 'Vessel / Voyage', cell: r => (
      <span className="font-mono text-[11.5px] text-slate-300">{r.vesselVoyage ?? '—'}</span>
    ) },
  { id: 'route',    header: 'POL → POD', cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.pol ?? '—')} → {(r.pod ?? '—')}
      </span>
    ) },
  { id: 'equip',    header: 'Equipment', cell: r => r.equipment ?? '—' },
  { id: 'status',   header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'etd',      header: 'ETD', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.etd)}</span>
    ) },
  { id: 'eta',      header: 'ETA', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.eta)}</span>
    ) },
];

const BookingsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const bookings = useBookings(search);

  return (
    <ListPage<Booking>
      title="Bookings"
      subtitle={
        bookings.data
          ? `${bookings.data.length} shown${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Booking #, customer, vessel"
      columns={columns}
      getRowId={r => r.id}
      data={bookings.data}
      isLoading={bookings.isLoading}
      error={bookings.error}
      onRetry={bookings.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.bookingNumber,
        description: `${r.customer ?? '—'} · ${r.vesselVoyage ?? ''}`.trim(),
      })}
      skeletonCols={[120, 160, 140, 140, 80, 60]}
    />
  );
};

export default BookingsV2;
