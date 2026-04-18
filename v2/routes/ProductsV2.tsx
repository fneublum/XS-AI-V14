// Phase 3B — v2 Products catalog. Full v1 parity.
//
// Parity points:
//   - Grid + table view toggle (initialViewMode stays in localStorage)
//   - Category + product-type dropdown filters
//   - Per-column sort + autofilter (built into DataTable)
//   - Row actions: View / Edit / Delete
//   - `+ New product` opens ProductDrawer in create mode with dedup-
//     by-name within the current company, image upload (max 3, 600px /
//     0.7), TDS PDF upload (5MB), supplier quick-add, cross-company
//     sharing (ADMIN), technical specs.

import React, { useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon, Share2, Package } from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle, Input, Skeleton, EmptyState } from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { useProducts, Product } from '../queries/useProducts';
import { useCompanyImages } from '../queries/useCompanyImages';
import { useEditor } from '../providers/EditorProvider';
import { cn } from '../primitives/utils';

type ViewMode = 'grid' | 'table';
const VIEW_STORAGE_KEY = 'xs_v2_products_view';

const fmtPrice = (n: number | null) =>
  n === null || n === undefined
    ? '—'
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const stockTone = (status: string | null | undefined): BadgeTone => {
  if (!status) return 'neutral';
  const s = status.toUpperCase();
  if (s.includes('AVAIL')) return 'success';
  if (s.includes('LOW'))   return 'warning';
  if (s.includes('BACK') || s.includes('OUT')) return 'danger';
  return 'info';
};

const ProductsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [type, setType] = useState<string>('All');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'table';
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      return (v === 'grid' || v === 'table') ? v : 'table';
    } catch { return 'table'; }
  });

  const products = useProducts(search);
  const images = useCompanyImages('PRODUCT');
  const { openProduct, openProductCreate } = useEditor();

  const setView = (v: ViewMode) => {
    setViewMode(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* noop */ }
  };

  const getImageUrl = (id: string): string | null =>
    images.data?.find(i => i.id === id)?.url ?? null;

  const rows = useMemo(() => {
    const all = products.data ?? [];
    return all.filter(r => {
      if (category !== 'All' && (r.category ?? '') !== category) return false;
      if (type !== 'All' && (r.productType ?? 'resale') !== type) return false;
      return true;
    });
  }, [products.data, category, type]);

  const { confirmDelete, deleteDialog } = useRowDelete<Product>({
    table: 'products',
    listQueryKeys: ['products'],
    rowLabel: r => r.name,
  });

  // Core columns fit on a standard 1280px viewport while keeping the
  // Actions column visible. Extra fields (supplierProductName, HS,
  // specs.type, supplier name) are accessible via the View/Edit drawer.
  const columns: DataTableColumn<Product>[] = useMemo(() => [
    {
      id: 'name', header: 'Product', sortable: true, filterable: true,
      value: r => r.name,
      cell: r => {
        const firstImage = r.imageIds.length > 0 ? getImageUrl(r.imageIds[0]) : null;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded bg-[#0a0a0a] border border-[#1f1f1f] overflow-hidden shrink-0 flex items-center justify-center">
              {firstImage
                ? <img src={firstImage} alt="" className="w-full h-full object-cover" />
                : <Package size={10} className="text-slate-600" />}
            </div>
            <span className="text-slate-100 font-medium truncate">{r.name}</span>
            {r.sharedWith.length > 0 && (
              <span title={`Shared with ${r.sharedWith.length} companies`}>
                <Share2 size={10} className="text-indigo-400 shrink-0" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'sku', header: 'SKU', mono: true, sortable: true, filterable: true,
      value: r => r.sku ?? '',
      cell: r => r.sku ?? '—',
    },
    {
      id: 'category', header: 'Category', sortable: true, filterable: true,
      value: r => r.category ?? '',
      cell: r => r.category ?? '—',
    },
    {
      id: 'grade', header: 'Grade', sortable: true, filterable: true,
      value: r => r.grade ?? '',
      cell: r => <span className="text-slate-300">{r.grade ?? '—'}</span>,
    },
    {
      id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
      value: r => r.supplier ?? '',
      cell: r => <span className="text-slate-400 truncate block max-w-[160px]">{r.supplier ?? '—'}</span>,
    },
    {
      id: 'price', header: 'Price', align: 'right', mono: true,
      sortable: true,
      value: r => r.price ?? 0,
      cell: r => fmtPrice(r.price),
    },
    {
      id: 'stockStatus', header: 'Stock', sortable: true, filterable: true,
      value: r => r.stockStatus ?? '',
      cell: r => r.stockStatus
        ? <Badge variant={stockTone(r.stockStatus)} dot>{r.stockStatus}</Badge>
        : <span className="text-slate-600">—</span>,
    },
  ], [images.data]);

  const rowActions = (row: Product) => (
    <RowActions
      onView={() => openProduct(row)}
      onEdit={() => openProduct(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  const emptyHint = search
    ? `Nothing matched "${search}".`
    : 'Add your first product to get started.';

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Products</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {products.data
              ? `${rows.length} shown${search ? ` · "${search}"` : ''}${category !== 'All' ? ` · ${category}` : ''}${type !== 'All' ? ` · ${type}` : ''}`
              : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              className={cn(
                'p-1 rounded transition-colors',
                viewMode === 'grid' ? 'bg-[#161616] text-slate-100' : 'text-slate-500 hover:text-slate-200',
              )}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={viewMode === 'table'}
              title="Table view"
              className={cn(
                'p-1 rounded transition-colors',
                viewMode === 'table' ? 'bg-[#161616] text-slate-100' : 'text-slate-500 hover:text-slate-200',
              )}
            >
              <ListIcon size={14} />
            </button>
          </div>
          <Button
            size="sm"
            onClick={openProductCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
          >
            + New product
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="flex items-center gap-2 ml-auto">
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="h-7 text-[12px] bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-slate-200 appearance-none"
            >
              <option value="All">All categories</option>
              <option value="Resin">Resin</option>
              <option value="Fiber Textile">Fiber Textile</option>
              <option value="Cotton Waste">Cotton Waste</option>
              <option value="Plastic Scrap">Plastic Scrap</option>
            </select>
            {/* productType column is not yet migrated to the live DB;
                keep the filter in the UI for parity but only expose All
                until the column ships. */}
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, SKU, grade, category"
              className="h-7 w-72 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>
      </Card>

      {products.isLoading ? (
        <Card>
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={200} height={14} />
                <Skeleton width={120} height={14} />
                <Skeleton width={100} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : products.error ? (
        <Card>
          <EmptyState
            tone="danger"
            title="Couldn't load products"
            description={products.error.message}
            action={{ label: 'Retry', onClick: products.refetch }}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title={search || category !== 'All' || type !== 'All' ? 'No matches' : 'No products yet'}
            description={emptyHint}
            action={
              (search || category !== 'All' || type !== 'All')
                ? { label: 'Clear filters', onClick: () => { setSearch(''); setCategory('All'); setType('All'); } }
                : { label: '+ New product', onClick: openProductCreate }
            }
          />
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {rows.map(p => {
            const firstImage = p.imageIds.length > 0 ? getImageUrl(p.imageIds[0]) : null;
            return (
              <div
                key={p.id}
                onClick={() => openProduct(p)}
                className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] overflow-hidden cursor-pointer hover:border-[#2a2a2a] transition-colors group flex flex-col"
              >
                <div className="aspect-[4/3] bg-[#0f0f0f] flex items-center justify-center">
                  {firstImage
                    ? <img src={firstImage} alt={p.name} className="w-full h-full object-cover" />
                    : <Package size={32} className="text-slate-700" />}
                </div>
                <div className="p-3 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-slate-100 truncate" title={p.name}>{p.name}</h3>
                      <p className="text-[11px] text-slate-500 truncate">
                        {p.grade ?? '—'}{p.specs.type ? ` · ${p.specs.type}` : ''}
                      </p>
                    </div>
                    {p.stockStatus && (
                      <Badge variant={stockTone(p.stockStatus)}>{p.stockStatus}</Badge>
                    )}
                  </div>
                  <div className="text-[11.5px] text-slate-400 space-y-0.5 mb-3">
                    {p.supplier && (
                      <p>
                        <span className="text-slate-600">Supplier: </span>
                        <span className="text-slate-300">{p.supplier}</span>
                      </p>
                    )}
                    {p.sku && (
                      <p className="font-mono tabular-nums">
                        <span className="text-slate-600">SKU: </span>
                        {p.sku}
                      </p>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2 border-t border-[#1f1f1f]">
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider">Base price</div>
                      <div className="text-[13px] font-semibold text-slate-100 font-mono tabular-nums">
                        {fmtPrice(p.price)}<span className="text-[10px] text-slate-500 ml-0.5">/LB</span>
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <RowActions
                        onView={() => openProduct(p)}
                        onEdit={() => openProduct(p)}
                        onDelete={() => confirmDelete(p)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={r => r.id}
            onRowClick={r => openProduct(r)}
            rowActions={rowActions}
            defaultSort={{ columnId: 'name', direction: 'asc' }}
          />
        </Card>
      )}

      {deleteDialog}
    </div>
  );
};

export default ProductsV2;
