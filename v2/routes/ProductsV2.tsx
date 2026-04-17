// Phase 3B — v2 Products catalog.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useProducts, Product } from '../queries/useProducts';
import { useToast } from '../primitives/Toast';

const fmtPrice = (n: number | null) =>
  n === null || n === undefined
    ? '—'
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const stockTone = (status: string | null): BadgeTone => {
  if (!status) return 'neutral';
  const s = status.toUpperCase();
  if (s.includes('IN STOCK') || s.includes('AVAILABLE')) return 'success';
  if (s.includes('LOW'))                                 return 'warning';
  if (s.includes('OUT'))                                 return 'danger';
  return 'info';
};

const columns: DataTableColumn<Product>[] = [
  { id: 'name',    header: 'Name',     cell: r => (
      <span className="text-slate-100 font-medium">{r.name}</span>
    ) },
  { id: 'sku',     header: 'SKU', mono: true, cell: r => r.sku ?? '—' },
  { id: 'category',header: 'Category', cell: r => r.category ?? '—' },
  { id: 'grade',   header: 'Grade',    cell: r => r.grade ?? '—' },
  { id: 'hsCode',  header: 'HS Code',  cell: r => (
      <span className="font-mono tabular-nums text-[11.5px]">{r.hsCode ?? '—'}</span>
    ) },
  { id: 'supplier',header: 'Supplier', cell: r => (
      <span className="text-slate-400">{r.supplier ?? '—'}</span>
    ) },
  { id: 'price',   header: 'Price', align: 'right', mono: true,
    cell: r => fmtPrice(r.price) },
  { id: 'stock',   header: 'Stock',
    cell: r => r.stockStatus
      ? <Badge variant={stockTone(r.stockStatus)} dot>{r.stockStatus}</Badge>
      : <span className="text-slate-600">—</span> },
];

const ProductsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const products = useProducts(search);

  return (
    <ListPage<Product>
      title="Products"
      subtitle={
        products.data
          ? `${products.data.length} shown${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Name, SKU, category"
      columns={columns}
      getRowId={r => r.id}
      data={products.data}
      isLoading={products.isLoading}
      error={products.error}
      onRetry={products.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.name,
        description: `${r.sku ?? ''} · ${r.category ?? ''}`.trim() || r.id,
      })}
      skeletonCols={[180, 80, 120, 80, 80]}
    />
  );
};

export default ProductsV2;
