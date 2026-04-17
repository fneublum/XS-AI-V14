// Phase 3A — v2 Dashboard. Linear/Vercel styling.
//
// Renders the hero + stat grid + recent sales orders table. Data is mocked
// for the pilot — real TanStack Query wiring is Phase 3B's first commit
// (see v2/queries/useCustomers.ts for the pattern).

import React, { useState } from 'react';
import { StatCard, StatGrid, Card, CardHeader, CardTitle, Badge } from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';

type SalesOrderStatus = 'Shipped' | 'In transit' | 'Pending' | 'Draft';

interface SalesOrderRow {
  id: string;
  customer: string;
  status: SalesOrderStatus;
  amount: number;
  date: string;
}

const MOCK_ROWS: SalesOrderRow[] = [
  { id: 'SO-7A2F', customer: 'Acme Industries',        status: 'Shipped',    amount: 12480, date: 'Apr 14' },
  { id: 'SO-9B1C', customer: 'Zenith Materials Co.',   status: 'In transit', amount: 8920,  date: 'Apr 13' },
  { id: 'SO-4D88', customer: 'Meridian Logistics LLC', status: 'Pending',    amount: 23100, date: 'Apr 12' },
  { id: 'SO-5E30', customer: 'Titan Steel Corp.',      status: 'Draft',      amount: 4650,  date: 'Apr 11' },
  { id: 'SO-1F09', customer: 'Everwell Imports',       status: 'Shipped',    amount: 17280, date: 'Apr 10' },
];

const statusVariant: Record<SalesOrderStatus, 'success' | 'info' | 'warning' | 'neutral'> = {
  'Shipped':    'success',
  'In transit': 'info',
  'Pending':    'warning',
  'Draft':      'neutral',
};

const fmtCurrency = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const columns: DataTableColumn<SalesOrderRow>[] = [
  { id: 'id',       header: 'Order',    mono: true,  cell: r => r.id },
  { id: 'customer', header: 'Customer',              cell: r => r.customer },
  { id: 'status',   header: 'Status',                cell: r => (
      <Badge variant={statusVariant[r.status]} dot>{r.status}</Badge>
    ) },
  { id: 'amount',   header: 'Amount', align: 'right', mono: true, cell: r => fmtCurrency(r.amount) },
  { id: 'date',     header: 'Date',   align: 'right',             cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{r.date}</span>
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

const DashboardV2: React.FC = () => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();
  const toast = useToast();
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');

  const totalRevenue = MOCK_ROWS.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Dashboard
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {user?.name ? `Welcome back, ${user.name}` : 'Last 30 days'}
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
          <StatCard label="Revenue"   value={fmtCurrency(184392)} delta={{ text: '+12.4%',     tone: 'positive' }} />
          <StatCard label="Orders"    value="42"                  delta={{ text: '+8',         tone: 'positive' }} />
          <StatCard label="Customers" value="128"                 delta={{ text: '+3 new',     tone: 'neutral'  }} />
          <StatCard label="Pending"   value={fmtCurrency(28104)}  delta={{ text: '5 overdue',  tone: 'warning'  }} />
        </StatGrid>
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent sales orders</CardTitle>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
            {MOCK_ROWS.length} active · {fmtCurrency(totalRevenue)}
          </span>
        </CardHeader>
        <DataTable
          columns={columns}
          rows={MOCK_ROWS}
          getRowId={r => r.id}
          onRowClick={r => toast.push({
            kind: 'info',
            title: `Opened ${r.id}`,
            description: `${r.customer} · ${fmtCurrency(r.amount)}`,
          })}
        />
      </Card>

      <p className="mt-8 text-[11px] text-slate-600 font-mono">
        v2 pilot · Linear/Vercel · mock data · click a row to trigger a toast
      </p>
    </div>
  );
};

export default DashboardV2;
