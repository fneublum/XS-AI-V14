// Phase 3B — v2 Bill of Ladings.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useBillOfLadings, BillOfLading } from '../queries/useBillOfLadings';
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
  if (s.includes('RELEASE') || s.includes('SURRENDER'))  return 'success';
  if (s.includes('ISSUED') || s.includes('ACTIVE'))      return 'info';
  if (s.includes('PEND') || s.includes('DRAFT'))         return 'warning';
  if (s.includes('CANCEL'))                              return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<BillOfLading>[] = [
  { id: 'bl',        header: 'B/L #', mono: true, cell: r => r.blNumber },
  { id: 'shipper',   header: 'Shipper', cell: r => (
      <span className="text-slate-100">{r.shipper ?? '—'}</span>
    ) },
  { id: 'consignee', header: 'Consignee', cell: r => r.consignee ?? '—' },
  { id: 'route',     header: 'POL → POD', cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.portLoading ?? '—')} → {(r.portDischarge ?? '—')}
      </span>
    ) },
  { id: 'vessel',    header: 'Vessel / Voyage', cell: r => (
      <span className="font-mono text-[11.5px] text-slate-400">{r.vesselVoyage ?? '—'}</span>
    ) },
  { id: 'status',    header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'shipped',   header: 'Shipped', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.shippedDate)}
      </span>
    ) },
];

const BillOfLadingsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const bols = useBillOfLadings(search);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.blNumber,
        description: `${r.shipper ?? '—'} → ${r.consignee ?? '—'}`,
      })}
      skeletonCols={[120, 160, 160, 180, 60, 60]}
    />
  );
};

export default BillOfLadingsV2;
