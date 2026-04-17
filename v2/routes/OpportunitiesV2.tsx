// Phase 3B — v2 Opportunities (sales pipeline).

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useOpportunities, Opportunity } from '../queries/useOpportunities';
import { useToast } from '../primitives/Toast';

const fmtMoney = (n: number | null) =>
  n === null || n === undefined
    ? '—'
    : `$${Math.round(n).toLocaleString('en-US')}`;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

const fmtPct = (n: number | null) =>
  n === null || n === undefined ? '—' : `${Math.round(n)}%`;

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const stageTone = (stage: string): BadgeTone => {
  const s = stage.toUpperCase();
  if (s.includes('WON') || s.includes('CLOSE')) return 'success';
  if (s.includes('NEGOT') || s.includes('PROP')) return 'info';
  if (s.includes('QUAL') || s.includes('LEAD')) return 'warning';
  if (s.includes('LOST'))                       return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<Opportunity>[] = [
  { id: 'customer', header: 'Customer', cell: r => (
      <span className="text-slate-100 font-medium">{r.customerName}</span>
    ) },
  { id: 'product', header: 'Product', cell: r => r.productName ?? '—' },
  { id: 'stage',   header: 'Stage', cell: r => (
      <Badge variant={stageTone(r.stage)} dot>{r.stage}</Badge>
    ) },
  { id: 'prob',    header: 'Prob.', align: 'right', mono: true, cell: r => fmtPct(r.probability) },
  { id: 'value',   header: 'Value', align: 'right', mono: true, cell: r => fmtMoney(r.value) },
  { id: 'assigned',header: 'Owner', cell: r => (
      <span className="text-slate-400">{r.assignedTo ?? '—'}</span>
    ) },
  { id: 'close',   header: 'Close', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.expectedCloseDate)}
      </span>
    ) },
];

const OpportunitiesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const opps = useOpportunities(search);
  const pipeline = (opps.data ?? []).reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <ListPage<Opportunity>
      title="Opportunities"
      subtitle={
        opps.data
          ? `${opps.data.length} open${
              pipeline > 0 ? ` · $${Math.round(pipeline).toLocaleString('en-US')} pipeline` : ''
            }${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Customer, product, stage"
      columns={columns}
      getRowId={r => r.id}
      data={opps.data}
      isLoading={opps.isLoading}
      error={opps.error}
      onRetry={opps.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.customerName,
        description: `${r.stage} · ${fmtMoney(r.value)}`,
      })}
      skeletonCols={[180, 160, 100, 60, 80]}
    />
  );
};

export default OpportunitiesV2;
