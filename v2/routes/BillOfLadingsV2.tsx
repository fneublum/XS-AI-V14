// Phase 3B — v2 Bill of Ladings.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
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
  { key: 'shipper',       label: 'Shipper' },
  { key: 'consignee',     label: 'Consignee' },
  { key: 'vesselVoyage',  label: 'Vessel / Voyage', mono: true, fullWidth: true },
  { key: 'portLoading',   label: 'POL', mono: true },
  { key: 'portDischarge', label: 'POD', mono: true },
  { key: 'container',     label: 'Container', mono: true },
  { key: 'status',        label: 'Status', type: 'select',
    options: ['DRAFT', 'ISSUED', 'RELEASED', 'SURRENDERED', 'CANCELLED'],
    defaultValue: 'ISSUED' },
  { key: 'shippedDate',   label: 'Shipped date', type: 'date' },
];

const BillOfLadingsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const bols = useBillOfLadings(search);

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
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New B/L
          </Button>
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
      {drawers}
    </>
  );
};

export default BillOfLadingsV2;
