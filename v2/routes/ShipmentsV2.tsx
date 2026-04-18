// Phase 3B — v2 Shipments.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useShipments, Shipment } from '../queries/useShipments';
import { formatDate as fmtDate } from '../lib/formatDate';

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
  { id: 'container', header: 'Container', mono: true, sortable: true, filterable: true,
    value: r => r.containerNumber ?? '', cell: r => r.containerNumber ?? '—' },
  { id: 'bl', header: 'B/L', mono: true, sortable: true, filterable: true,
    value: r => r.blNumber ?? '', cell: r => r.blNumber ?? '—' },
  { id: 'carrier', header: 'Carrier', sortable: true, filterable: true,
    value: r => r.carrier ?? '', cell: r => r.carrier ?? '—' },
  { id: 'origin', header: 'Origin', sortable: true, filterable: true,
    value: r => r.origin ?? '', cell: r => r.origin ?? '—' },
  { id: 'dest', header: 'Destination', sortable: true, filterable: true,
    value: r => r.destination ?? '', cell: r => r.destination ?? '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'etd', header: 'ETD', align: 'right', sortable: true,
    value: r => r.etd ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.etd)}
      </span>
    ) },
  { id: 'eta', header: 'ETA', align: 'right', sortable: true,
    value: r => r.eta ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.eta)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'containerNumber', label: 'Container', mono: true },
  { key: 'blNumber',        label: 'B/L #', mono: true },
  { key: 'carrier', label: 'Carrier',
    source: {
      table: 'carriers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'scac', scopeByCompany: true,
    } },
  { key: 'origin', label: 'Origin', mono: true,
    source: {
      table: 'ports', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'code',
    } },
  { key: 'destination', label: 'Destination', mono: true,
    source: {
      table: 'ports', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'code',
    } },
  { key: 'status',          label: 'Status', required: true, type: 'select',
    options: ['BOOKED', 'IN TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED'],
    defaultValue: 'BOOKED' },
  { key: 'etd',             label: 'ETD', type: 'date' },
  { key: 'eta',             label: 'ETA', type: 'date' },
];

const ShipmentsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const shipments = useShipments(search);

  const { rowActions, drawers, openView } = useRowCrud<Shipment>({
    table: 'shipments',
    listQueryKeys: ['shipments'],
    rowLabel: r => r.containerNumber ?? r.id,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
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
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New shipment
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New shipment', onClick: openCreate }}
        skeletonCols={[120, 100, 140, 120, 120, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New shipment"
        description="Manually log a shipment. Data usually flows in from B/L or Booking."
        table="shipments"
        idPrefix="SHP"
        listQueryKeys={['shipments']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default ShipmentsV2;
