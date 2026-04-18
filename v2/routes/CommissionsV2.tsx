// Phase 3B — v2 Commissions (lite list view).

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useRowCrud } from '../components/useRowCrud';
import { FieldDef } from '../components/QuickCreateDrawer';
import { useCommissions, CommissionRow } from '../queries/useCommissions';
import { useEditor } from '../providers/EditorProvider';
import { shortName, tooltipName } from '../lib/formatName';

const fmtPct = (n: number | null): string => {
  if (n === null) return '—';
  const scaled = n > 1 ? n : n * 100;
  return `${scaled.toFixed(2)}%`;
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const commissionTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('PAID'))                         return 'success';
  if (s.includes('APPROV'))                       return 'info';
  if (s.includes('PEND'))                         return 'warning';
  if (s.includes('UNPAID') || s.includes('OPEN')) return 'neutral';
  if (s.includes('CANCEL'))                       return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<CommissionRow>[] = [
  { id: 'order', header: 'Order', mono: true, sortable: true, filterable: true,
    value: r => r.orderNumber, cell: r => r.orderNumber },
  { id: 'invoice', header: 'Invoice', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber ?? '',
    cell: r => <span className="text-slate-500">{r.invoiceNumber ?? '—'}</span> },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span className="text-slate-100" title={tooltipName(r.customerName)}>{shortName(r.customerName)}</span> },
  { id: 'seller', header: 'Seller', sortable: true, filterable: true,
    value: r => r.sellerName ?? '', cell: r => r.sellerName ?? '—' },
  { id: 'rate', header: 'Rate', align: 'right', mono: true, sortable: true,
    value: r => r.commissionRate ?? 0,
    cell: r => fmtPct(r.commissionRate) },
  { id: 'amount', header: 'Commission', align: 'right', mono: true, sortable: true,
    value: r => r.commissionAmount,
    cell: r => `$${Math.round(r.commissionAmount).toLocaleString('en-US')}` },
  { id: 'total', header: 'Order total', align: 'right', mono: true, sortable: true,
    value: r => r.orderTotal,
    cell: r => (
      <span className="text-slate-400">
        ${Math.round(r.orderTotal).toLocaleString('en-US')}
      </span>
    ) },
  { id: 'status', header: 'Payout', sortable: true, filterable: true,
    value: r => r.commissionPaymentStatus,
    cell: r => (
      <Badge variant={commissionTone(r.commissionPaymentStatus)} dot>
        {r.commissionPaymentStatus}
      </Badge>
    ) },
];

const fields: FieldDef[] = [
  { key: 'orderNumber',             label: 'Order #', mono: true },
  { key: 'invoiceNumber',           label: 'Invoice #', mono: true },
  { key: 'customerName', label: 'Customer', fullWidth: true,
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'sellerName', label: 'Seller',
    source: {
      table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'commissionRate',          label: 'Rate (%)', type: 'number', mono: true, min: 0, max: 100, step: 0.01 },
  { key: 'commissionAmount',        label: 'Commission ($)', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'commissionPaymentStatus', label: 'Payout', type: 'select',
    options: ['UNPAID', 'APPROVED', 'PAID', 'HOLD'] },
  { key: 'paymentStatus',           label: 'Payment', type: 'select',
    options: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'] },
];

const CommissionsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const commissions = useCommissions(search);
  const { openSalesOrderCreate } = useEditor();
  const totalCommissions = (commissions.data ?? []).reduce((s, r) => s + r.commissionAmount, 0);

  const { rowActions, drawers, openView } = useRowCrud<CommissionRow>({
    table: 'commission_sales_orders',
    listQueryKeys: ['commissions', 'receivables'],
    rowLabel: r => r.orderNumber,
    fields,
  });

  return (
    <>
      <ListPage<CommissionRow>
        title="Commissions"
        subtitle={
          commissions.data
            ? `${commissions.data.length} orders${totalCommissions > 0 ? ` · $${Math.round(totalCommissions).toLocaleString('en-US')} total` : ''}${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Order, customer, seller"
        cardTitle="Commission pipeline"
        columns={columns}
        getRowId={r => r.id}
        data={commissions.data}
        isLoading={commissions.isLoading}
        error={commissions.error}
        onRetry={commissions.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openSalesOrderCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New sales order
          </Button>
        }
        emptyTitle="No commissions yet"
        emptyDescription="Commissions are generated automatically from sales orders. Create one to get started."
        emptyAction={search ? undefined : { label: '+ New sales order', onClick: openSalesOrderCreate }}
        skeletonCols={[100, 100, 180, 120, 60, 80]}
      />
      {drawers}
    </>
  );
};

export default CommissionsV2;
