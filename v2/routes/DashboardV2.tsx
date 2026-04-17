// Phase 3B — v2 Dashboard with live Supabase data.

import React, { useState } from 'react';
import {
  StatCard, StatGrid, Card, CardHeader, CardTitle, Badge,
  Skeleton, EmptyState,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { useDashboardStats, DashboardRange } from '../queries/useDashboardStats';
import { useRecentSalesOrders, SalesOrderListItem } from '../queries/useRecentSalesOrders';

const fmtCurrency = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('SHIP') || s.includes('DELIVER') || s.includes('COMPLETE')) return 'success';
  if (s.includes('TRANSIT') || s.includes('PROGRESS'))                         return 'info';
  if (s.includes('PEND') || s.includes('HOLD'))                                return 'warning';
  if (s.includes('CANCEL') || s.includes('REJECT'))                            return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<SalesOrderListItem>[] = [
  { id: 'orderNumber', header: 'Order', mono: true, cell: r => r.orderNumber },
  { id: 'customer',    header: 'Customer',           cell: r => r.customerName },
  { id: 'status',      header: 'Status',             cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'amount',      header: 'Amount', align: 'right', mono: true,
    cell: r => fmtCurrency(r.totalAmount) },
  { id: 'date',        header: 'Date',   align: 'right',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate)}
      </span>
    ) },
];

const RangeButton: React.FC<{ active?: boolean; children: React.ReactNode; onClick: () => void }> = ({
  active, children, onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={
      active
        ? 'px-2 py-1 rounded bg-[#161616] text-slate-100 text-[12px]'
        : 'px-2 py-1 rounded border border-[#1f1f1f] text-slate-500 hover:text-slate-200 text-[12px]'
    }
  >
    {children}
  </button>
);

const StatCardSkeleton: React.FC = () => (
  <div className="bg-[#0a0a0a] p-4">
    <Skeleton width={70} height={10} />
    <Skeleton width={140} height={26} className="mt-2" />
    <Skeleton width={60} height={10} className="mt-2" />
  </div>
);

const DashboardV2: React.FC = () => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();
  const toast = useToast();
  const [range, setRange] = useState<DashboardRange>('30d');

  const stats = useDashboardStats(range);
  const orders = useRecentSalesOrders(8);

  const revenueDelta = stats.data?.revenueDeltaPct;
  const orderDelta = stats.data?.orderDelta;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Dashboard
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {user?.name ? `Welcome back, ${user.name}` : 'Signed out — showing all accessible data'}
            {' · '}
            <span className="font-mono tabular-nums">{currentCompanyId}</span>
          </p>
        </div>
        <div className="flex gap-1">
          <RangeButton active={range === '7d'}  onClick={() => setRange('7d')}>7d</RangeButton>
          <RangeButton active={range === '30d'} onClick={() => setRange('30d')}>30d</RangeButton>
          <RangeButton active={range === '90d'} onClick={() => setRange('90d')}>90d</RangeButton>
        </div>
      </div>

      {/* Stat grid */}
      <div className="mb-8">
        <StatGrid columns={4}>
          {stats.isLoading ? (
            <>
              <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
            </>
          ) : stats.error ? (
            <div className="col-span-4 bg-[#0a0a0a]">
              <EmptyState
                tone="danger"
                title="Couldn't load stats"
                description={stats.error.message}
                action={{ label: 'Retry', onClick: stats.refetch }}
              />
            </div>
          ) : stats.data ? (
            <>
              <StatCard
                label="Revenue"
                value={fmtCurrency(stats.data.revenue)}
                delta={revenueDelta !== null && revenueDelta !== undefined
                  ? {
                      text: `${revenueDelta >= 0 ? '+' : ''}${revenueDelta.toFixed(1)}%`,
                      tone: revenueDelta >= 0 ? 'positive' : 'negative',
                    }
                  : { text: 'no prior', tone: 'neutral' }}
              />
              <StatCard
                label="Orders"
                value={String(stats.data.orderCount)}
                delta={orderDelta !== null && orderDelta !== undefined
                  ? {
                      text: `${orderDelta >= 0 ? '+' : ''}${orderDelta}`,
                      tone: orderDelta >= 0 ? 'positive' : 'negative',
                    }
                  : { text: 'no prior', tone: 'neutral' }}
              />
              <StatCard
                label="Customers"
                value={stats.data.customerCount.toLocaleString()}
                delta={{ text: 'total', tone: 'neutral' }}
              />
              <StatCard
                label="Pending"
                value={fmtCurrency(stats.data.pending)}
                delta={{
                  text: stats.data.pending > 0 ? 'open invoices' : 'all clear',
                  tone: stats.data.pending > 0 ? 'warning' : 'positive',
                }}
              />
            </>
          ) : null}
        </StatGrid>
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent sales orders</CardTitle>
          {!orders.isLoading && !orders.error && orders.data && (
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {orders.data.length} shown
            </span>
          )}
        </CardHeader>

        {orders.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={80} height={14} />
                <Skeleton width={200} height={14} />
                <Skeleton width={80} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : orders.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load sales orders"
            description={orders.error.message}
            action={{ label: 'Retry', onClick: orders.refetch }}
          />
        ) : !orders.data || orders.data.length === 0 ? (
          <EmptyState
            title="No sales orders yet"
            description={
              currentCompanyId === 'ALL'
                ? 'No rows returned. Sign into v1 first to scope to your company.'
                : `No orders found for company ${currentCompanyId}.`
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={orders.data}
            getRowId={r => r.id}
            onRowClick={r => toast.push({
              kind: 'info',
              title: `Opened ${r.orderNumber}`,
              description: `${r.customerName} · ${fmtCurrency(r.totalAmount)}`,
            })}
          />
        )}
      </Card>

      <p className="mt-8 text-[11px] text-slate-600 font-mono">
        v2 pilot · Linear/Vercel · live Supabase data · scope: {currentCompanyId}
      </p>
    </div>
  );
};

export default DashboardV2;
