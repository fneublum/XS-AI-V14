// Phase 3B — v2 Inventory.

import React, { useState } from 'react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useInventory, InventoryItem } from '../queries/useInventory';
import { useToast } from '../primitives/Toast';

const fmtLBS = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} lbs`;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

const columns: DataTableColumn<InventoryItem>[] = [
  { id: 'product', header: 'Product', cell: r => (
      <span className="text-slate-100 font-medium">{r.productName}</span>
    ) },
  { id: 'grade',   header: 'Grade', cell: r => r.grade ?? '—' },
  { id: 'qty',     header: 'Quantity', align: 'right', mono: true,
    cell: r => (
      <span className={r.quantityLBS > 0 ? 'text-slate-100' : 'text-slate-500'}>
        {fmtLBS(r.quantityLBS)}
      </span>
    ) },
  { id: 'loc',     header: 'Location', cell: r => (
      <span className="text-slate-400">{r.warehouseLocation ?? '—'}</span>
    ) },
  { id: 'updated', header: 'Updated', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.lastUpdated)}
      </span>
    ) },
];

const InventoryV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const inv = useInventory(search);
  const totalLBS = (inv.data ?? []).reduce((s, r) => s + r.quantityLBS, 0);

  return (
    <ListPage<InventoryItem>
      title="Inventory"
      subtitle={
        inv.data
          ? `${inv.data.length} items${
              totalLBS > 0 ? ` · ${fmtLBS(totalLBS)} total` : ''
            }${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Product, warehouse, grade"
      columns={columns}
      getRowId={r => r.id}
      data={inv.data}
      isLoading={inv.isLoading}
      error={inv.error}
      onRetry={inv.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.productName,
        description: `${fmtLBS(r.quantityLBS)} · ${r.warehouseLocation ?? 'no location'}`,
      })}
      skeletonCols={[180, 80, 100, 140, 80]}
    />
  );
};

export default InventoryV2;
