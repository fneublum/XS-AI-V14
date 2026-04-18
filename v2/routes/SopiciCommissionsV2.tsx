// Phase 3B — SO / PI / CI Commissions (first iteration rebuild).
//
// Replaces the Phase 3B placeholder with a working pipeline view over
// commission_sales_orders. Header with stats + search + view toggle;
// body is a 5-column Kanban (Draft / Approved / Invoiced / Paid /
// Issue) that lets you see every order's place in the pipeline and
// click through to edit inline.
//
// Not full parity with v1's 9,945-LOC SOPICIComissions:
//   - No per-line-item seller splits
//   - No document attachment surfacing inside the drawer yet
//   - No drag-and-drop between columns (click → edit → save)
//   - No QuickBooks sync trigger
// These are Phase 3C work. First iteration proves the core flow.

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge,
} from '../primitives';
import { useCommissions, CommissionRow } from '../queries/useCommissions';
import { useEditor } from '../providers/EditorProvider';
import { CommissionPipeline } from '../components/CommissionPipeline';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { cn } from '../primitives/utils';

const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtPct = (n: number | null): string => {
  if (n === null) return '—';
  const scaled = n > 1 ? n : n * 100;
  return `${scaled.toFixed(2)}%`;
};

const listColumns: DataTableColumn<CommissionRow>[] = [
  { id: 'order',    header: 'Order', mono: true, cell: r => r.orderNumber },
  { id: 'invoice',  header: 'Invoice', mono: true,
    cell: r => <span className="text-slate-500">{r.invoiceNumber ?? '—'}</span> },
  { id: 'customer', header: 'Customer',
    cell: r => <span className="text-slate-100">{r.customerName}</span> },
  { id: 'seller',   header: 'Seller', cell: r => r.sellerName ?? '—' },
  { id: 'rate',     header: 'Rate', align: 'right', mono: true,
    cell: r => fmtPct(r.commissionRate) },
  { id: 'amount',   header: 'Commission', align: 'right', mono: true,
    cell: r => fmtMoney(r.commissionAmount) },
  { id: 'payment',  header: 'Payment',
    cell: r => <Badge variant="neutral" dot>{r.paymentStatus}</Badge> },
  { id: 'payout',   header: 'Payout',
    cell: r => <Badge
      variant={r.commissionPaymentStatus.toUpperCase() === 'PAID' ? 'success' : 'neutral'}
      dot>{r.commissionPaymentStatus}</Badge> },
];

type ViewMode = 'pipeline' | 'list';

const SopiciCommissionsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('pipeline');
  const commissions = useCommissions(search);
  const { openCommission } = useEditor();

  const rows = commissions.data ?? [];
  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.commissionAmount, 0);
    const paid = rows
      .filter(r => r.commissionPaymentStatus.toUpperCase() === 'PAID')
      .reduce((s, r) => s + r.commissionAmount, 0);
    const unpaid = total - paid;
    return { total, paid, unpaid, orders: rows.length };
  }, [rows]);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              SO / PI / CI Commissions
            </h1>
            <Badge variant="info">v2 preview</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Full commission pipeline. Click any card to edit status, rate, or seller.
          </p>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
          <ViewToggle active={view === 'pipeline'} onClick={() => setView('pipeline')}>Pipeline</ViewToggle>
          <ViewToggle active={view === 'list'}     onClick={() => setView('list')}>List</ViewToggle>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden mb-6">
        <Stat label="Orders"     value={commissions.isLoading ? '—' : String(stats.orders)} />
        <Stat label="Total owed" value={commissions.isLoading ? '—' : fmtMoney(stats.total)} />
        <Stat label="Paid out"   value={commissions.isLoading ? '—' : fmtMoney(stats.paid)} tone="positive" />
        <Stat label="Unpaid"     value={commissions.isLoading ? '—' : fmtMoney(stats.unpaid)} tone={stats.unpaid > 0 ? 'warning' : 'neutral'} />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order, customer, seller"
            className="h-7 w-64 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 ml-auto"
          />
        </CardHeader>
      </Card>

      {commissions.isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-md border border-[#1f1f1f] p-3 space-y-2">
              <Skeleton width={80} height={14} />
              <Skeleton height={60} />
              <Skeleton height={60} />
            </div>
          ))}
        </div>
      ) : commissions.error ? (
        <Card>
          <EmptyState
            tone="danger"
            title="Couldn't load commissions"
            description={commissions.error.message}
            action={{ label: 'Retry', onClick: commissions.refetch }}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title={search ? 'No matches' : 'No commissions yet'}
            description={search
              ? `Nothing matched "${search}".`
              : 'Commission records appear here as sales orders flow through the pipeline.'}
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        </Card>
      ) : view === 'pipeline' ? (
        <CommissionPipeline rows={rows} onCardClick={openCommission} />
      ) : (
        <Card>
          <DataTable
            columns={listColumns}
            rows={rows}
            getRowId={r => r.id}
            onRowClick={openCommission}
          />
        </Card>
      )}
    </div>
  );
};

const Stat: React.FC<{
  label: string; value: string;
  tone?: 'positive' | 'warning' | 'neutral';
}> = ({ label, value, tone = 'neutral' }) => (
  <div className="bg-[#0a0a0a] p-4">
    <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">{label}</div>
    <div className={cn('font-mono tabular-nums text-[22px] font-semibold mt-1',
      tone === 'positive' ? 'text-emerald-400'
      : tone === 'warning' ? 'text-amber-400'
      : 'text-slate-100',
    )}>
      {value}
    </div>
  </div>
);

const ViewToggle: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={
      active
        ? 'px-2.5 py-1 rounded text-[12px] font-medium bg-[#161616] text-slate-100'
        : 'px-2.5 py-1 rounded text-[12px] text-slate-500 hover:text-slate-200'
    }
  >
    {children}
  </button>
);

export default SopiciCommissionsV2;
