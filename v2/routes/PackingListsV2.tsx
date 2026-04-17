// Phase 3B — v2 Packing Lists.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { usePackingLists, PackingList } from '../queries/usePackingLists';
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
  if (s.includes('SHIPPED') || s.includes('DELIVER')) return 'success';
  if (s.includes('ISSUED') || s.includes('CONFIRM'))  return 'info';
  if (s.includes('DRAFT') || s.includes('PEND'))      return 'warning';
  if (s.includes('CANCEL'))                           return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<PackingList>[] = [
  { id: 'pl',        header: 'PL #', mono: true, cell: r => r.plNumber },
  { id: 'bl',        header: 'B/L #', mono: true, cell: r => (
      <span className="text-slate-500">{r.blNumber ?? '—'}</span>
    ) },
  { id: 'so',        header: 'SO #', mono: true, cell: r => (
      <span className="text-slate-500">{r.soNumber ?? '—'}</span>
    ) },
  { id: 'consignee', header: 'Consignee', cell: r => (
      <span className="text-slate-100">{r.consignee ?? '—'}</span>
    ) },
  { id: 'container', header: 'Container', mono: true, cell: r => r.containerNumber ?? '—' },
  { id: 'carrier',   header: 'Carrier', cell: r => r.carrier ?? '—' },
  { id: 'status',    header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'ship',      header: 'Ship date', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.scheduledShipDate ?? r.date)}
      </span>
    ) },
];

const PackingListsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const pls = usePackingLists(search);

  return (
    <ListPage<PackingList>
      title="Packing Lists"
      subtitle={
        pls.data
          ? `${pls.data.length} shown${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="PL, B/L, consignee"
      columns={columns}
      getRowId={r => r.id}
      data={pls.data}
      isLoading={pls.isLoading}
      error={pls.error}
      onRetry={pls.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.plNumber,
        description: `${r.consignee ?? '—'} · ${r.containerNumber ?? ''}`.trim(),
      })}
      skeletonCols={[100, 100, 100, 160, 120, 60]}
    />
  );
};

export default PackingListsV2;
