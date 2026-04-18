// Phase 3B — v2 Inventory.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useInventory, InventoryItem } from '../queries/useInventory';
import { formatDate as fmtDate } from '../lib/formatDate';

const fmtLBS = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} lbs`;

const columns: DataTableColumn<InventoryItem>[] = [
  { id: 'product', header: 'Product', sortable: true, filterable: true,
    value: r => r.productName,
    cell: r => <span className="text-slate-100 font-medium">{r.productName}</span> },
  { id: 'grade', header: 'Grade', sortable: true, filterable: true,
    value: r => r.grade ?? '', cell: r => r.grade ?? '—' },
  { id: 'qty', header: 'Quantity', align: 'right', mono: true, sortable: true,
    value: r => r.quantityLBS,
    cell: r => (
      <span className={r.quantityLBS > 0 ? 'text-slate-100' : 'text-slate-500'}>
        {fmtLBS(r.quantityLBS)}
      </span>
    ) },
  { id: 'loc', header: 'Location', sortable: true, filterable: true,
    value: r => r.warehouseLocation ?? '',
    cell: r => <span className="text-slate-400">{r.warehouseLocation ?? '—'}</span> },
  { id: 'updated', header: 'Updated', align: 'right', sortable: true,
    value: r => r.lastUpdated ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.lastUpdated)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'productName', label: 'Product', required: true, fullWidth: true,
    source: {
      table: 'products', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'grade', scopeByCompany: true,
    } },
  { key: 'grade',             label: 'Grade' },
  { key: 'quantityLBS',       label: 'Quantity (lbs)', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'warehouseLocation', label: 'Warehouse' },
  { key: 'notes',             label: 'Notes', type: 'textarea' },
];

const InventoryV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const inv = useInventory(search);
  const totalLBS = (inv.data ?? []).reduce((s, r) => s + r.quantityLBS, 0);

  const { rowActions, drawers, openView } = useRowCrud<InventoryItem>({
    table: 'inventory',
    listQueryKeys: ['inventory'],
    rowLabel: r => r.productName,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
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
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New inventory
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New inventory', onClick: openCreate }}
        skeletonCols={[180, 80, 100, 140, 80]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New inventory item"
        description="Register a new stock line in the warehouse."
        table="inventory"
        idPrefix="INV"
        listQueryKeys={['inventory']}
        scopeByCompany
        extras={{ lastUpdated: new Date().toISOString() }}
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default InventoryV2;
