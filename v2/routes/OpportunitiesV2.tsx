// Phase 3B — v2 Opportunities (sales pipeline).

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useOpportunities, Opportunity } from '../queries/useOpportunities';
import { formatDate as fmtDate } from '../lib/formatDate';

const fmtMoney = (n: number | null) =>
  n === null || n === undefined
    ? '—'
    : `$${Math.round(n).toLocaleString('en-US')}`;

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
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span className="text-slate-100 font-medium">{r.customerName}</span> },
  { id: 'product', header: 'Product', sortable: true, filterable: true,
    value: r => r.productName ?? '', cell: r => r.productName ?? '—' },
  { id: 'stage', header: 'Stage', sortable: true, filterable: true,
    value: r => r.stage,
    cell: r => <Badge variant={stageTone(r.stage)} dot>{r.stage}</Badge> },
  { id: 'prob', header: 'Prob.', align: 'right', mono: true, sortable: true,
    value: r => r.probability ?? 0, cell: r => fmtPct(r.probability) },
  { id: 'value', header: 'Value', align: 'right', mono: true, sortable: true,
    value: r => r.value ?? 0, cell: r => fmtMoney(r.value) },
  { id: 'assigned', header: 'Owner', sortable: true, filterable: true,
    value: r => r.assignedTo ?? '',
    cell: r => <span className="text-slate-400">{r.assignedTo ?? '—'}</span> },
  { id: 'close', header: 'Close', align: 'right', sortable: true,
    value: r => r.expectedCloseDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.expectedCloseDate)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'customerName', label: 'Customer', required: true, fullWidth: true,
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'productName', label: 'Product',
    source: {
      table: 'products', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'grade', scopeByCompany: true,
    } },
  { key: 'stage',             label: 'Stage', required: true, type: 'select',
    options: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
    defaultValue: 'LEAD' },
  { key: 'probability',       label: 'Probability %', type: 'number', mono: true,
    min: 0, max: 100, step: 1 },
  { key: 'value',             label: 'Value ($)', type: 'number', mono: true, min: 0, step: 100 },
  { key: 'volumeLBS',         label: 'Volume (lbs)', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'expectedCloseDate', label: 'Expected close', type: 'date' },
  { key: 'assignedTo',        label: 'Owner' },
];

const OpportunitiesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const opps = useOpportunities(search);
  const pipeline = (opps.data ?? []).reduce((s, r) => s + (r.value ?? 0), 0);

  const { rowActions, drawers, openView } = useRowCrud<Opportunity>({
    table: 'opportunities',
    listQueryKeys: ['opportunities'],
    rowLabel: r => r.customerName,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
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
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New opportunity
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New opportunity', onClick: openCreate }}
        skeletonCols={[180, 160, 100, 60, 80]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New opportunity"
        description="Add a lead to the sales pipeline."
        table="opportunities"
        idPrefix="OPP"
        listQueryKeys={['opportunities']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default OpportunitiesV2;
