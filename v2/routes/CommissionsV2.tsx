// Phase 3B — v2 Commissions (lite list view).
//
// The full Commissions experience in v1 is a 9.9K-LOC module; this is
// the read-only overview. The edit flow ships later.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useCommissions, CommissionRow } from '../queries/useCommissions';
import { useToast } from '../primitives/Toast';

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
  { id: 'order',    header: 'Order', mono: true, cell: r => r.orderNumber },
  { id: 'invoice',  header: 'Invoice', mono: true, cell: r => (
      <span className="text-slate-500">{r.invoiceNumber ?? '—'}</span>
    ) },
  { id: 'customer', header: 'Customer', cell: r => (
      <span className="text-slate-100">{r.customerName}</span>
    ) },
  { id: 'seller',   header: 'Seller', cell: r => r.sellerName ?? '—' },
  { id: 'rate',     header: 'Rate', align: 'right', mono: true,
    cell: r => fmtPct(r.commissionRate) },
  { id: 'amount',   header: 'Commission', align: 'right', mono: true,
    cell: r => `$${Math.round(r.commissionAmount).toLocaleString('en-US')}` },
  { id: 'total',    header: 'Order total', align: 'right', mono: true,
    cell: r => (
      <span className="text-slate-400">
        ${Math.round(r.orderTotal).toLocaleString('en-US')}
      </span>
    ) },
  { id: 'status',   header: 'Payout', cell: r => (
      <Badge variant={commissionTone(r.commissionPaymentStatus)} dot>
        {r.commissionPaymentStatus}
      </Badge>
    ) },
];

const CommissionsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const commissions = useCommissions(search);
  const totalCommissions = (commissions.data ?? []).reduce((s, r) => s + r.commissionAmount, 0);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.orderNumber,
        description: `${r.sellerName ?? '—'} → $${Math.round(r.commissionAmount).toLocaleString('en-US')}`,
      })}
      skeletonCols={[100, 100, 180, 120, 60, 80]}
    />
  );
};

export default CommissionsV2;
