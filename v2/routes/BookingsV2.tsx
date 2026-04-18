// Phase 3B — v2 Bookings.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useBookings, Booking } from '../queries/useBookings';

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
  { id: 'number', header: 'Booking #', mono: true, sortable: true, filterable: true,
    value: r => r.bookingNumber, cell: r => r.bookingNumber },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customer ?? '',
    cell: r => <span className="text-slate-100">{r.customer ?? '—'}</span> },
  { id: 'vessel', header: 'Vessel / Voyage', sortable: true, filterable: true,
    value: r => r.vesselVoyage ?? '',
    cell: r => <span className="font-mono text-[11.5px] text-slate-300">{r.vesselVoyage ?? '—'}</span> },
  { id: 'route', header: 'POL → POD', sortable: true, filterable: true,
    value: r => `${r.pol ?? ''} → ${r.pod ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.pol ?? '—')} → {(r.pod ?? '—')}
      </span>
    ) },
  { id: 'equip', header: 'Equipment', sortable: true, filterable: true,
    value: r => r.equipment ?? '', cell: r => r.equipment ?? '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'etd', header: 'ETD', align: 'right', sortable: true,
    value: r => r.etd ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.etd)}</span>
    ) },
  { id: 'eta', header: 'ETA', align: 'right', sortable: true,
    value: r => r.eta ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.eta)}</span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'bookingNumber', label: 'Booking #', required: true, mono: true },
  { key: 'customer',      label: 'Customer' },
  { key: 'vesselVoyage',  label: 'Vessel / Voyage', mono: true, fullWidth: true },
  { key: 'pol',           label: 'POL', mono: true },
  { key: 'pod',           label: 'POD', mono: true },
  { key: 'equipment',     label: 'Equipment' },
  { key: 'status',        label: 'Status', type: 'select',
    options: ['BOOKED', 'CONFIRMED', 'LOADED', 'DEPARTED', 'CANCELLED'],
    defaultValue: 'BOOKED' },
  { key: 'etd',           label: 'ETD', type: 'date' },
  { key: 'eta',           label: 'ETA', type: 'date' },
];

const BookingsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const bookings = useBookings(search);

  const { rowActions, drawers, openView } = useRowCrud<Booking>({
    table: 'bookings',
    listQueryKeys: ['bookings', 'logisticsDocs'],
    rowLabel: r => r.bookingNumber,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
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
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New booking
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New booking', onClick: openCreate }}
        skeletonCols={[120, 160, 140, 140, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New booking"
        description="Register a booking with a carrier or forwarder."
        table="bookings"
        idPrefix="BKG"
        listQueryKeys={['bookings']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default BookingsV2;
