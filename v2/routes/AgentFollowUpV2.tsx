// Agent Follow Up — operational board for commission-driven sales.
//
// Surfaces what the user actually does day-to-day: chase outstanding
// commissions, track per-agent rollups, and spot stalled orders. Data
// comes from `commission_sales_orders` via `useAgentSalesOrders`; the
// aggregation is in `v2/services/agentFollowUp.ts`.

import React, { useMemo, useState } from 'react';
import { Users, AlertTriangle, ArrowUpRight, RefreshCw, Mail, ExternalLink } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, Button,
  StatGrid, StatCard, Skeleton, EmptyState,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useAgentSalesOrders } from '../queries/useAgentSalesOrders';
import { useSuppliers } from '../queries/useSuppliers';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { CommissionBillingDrawer } from '../components/CommissionBillingDrawer';
import type { AgentOrderRow } from '../queries/useAgentSalesOrders';
import {
  buildAgentFollowUp, type AgentRollup, type OutstandingRow,
} from '../services/agentFollowUp';
import { formatMoney } from '../lib/formatMoney';
import { formatDate as fmtDate } from '../lib/formatDate';

interface Props {
  navigate: (id: string) => void;
}

type Tab = 'agents' | 'outstanding';

const AgentFollowUpV2: React.FC<Props> = ({ navigate }) => {
  const toast = useToast();
  const orders = useAgentSalesOrders('');
  const suppliers = useSuppliers();
  const [tab, setTab] = useState<Tab>('agents');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [billingOrder, setBillingOrder] = useState<AgentOrderRow | null>(null);

  const summary = useMemo(() => buildAgentFollowUp(orders.data ?? []), [orders.data]);

  // Resolve a sellerName to a supplier email. The agent table in this
  // codebase is `suppliers` — agents are themselves suppliers (e.g.
  // FIBERTEX, SGT Enterprises). Match exact name first, then a
  // normalised case/punctuation-tolerant compare, then a contains
  // fallback. Returns null when no email is on file.
  const resolveSupplierEmail = (sellerName: string): { email: string | null; matchedName: string | null } => {
    const list = suppliers.data ?? [];
    if (list.length === 0 || !sellerName) return { email: null, matchedName: null };
    const norm = (s: string) => s.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const target = norm(sellerName);
    let hit = list.find(s => norm(s.name ?? '') === target);
    if (!hit) hit = list.find(s => norm(s.name ?? '').includes(target) || target.includes(norm(s.name ?? '')));
    if (!hit) return { email: null, matchedName: null };
    return { email: (hit.email ?? '').trim() || null, matchedName: hit.name ?? null };
  };

  const openEmail = (row: OutstandingRow) => {
    if (!row.commissionInvoicePdfUrl) {
      // INVOICED stage: PDF doesn't exist yet. Launch the billing
      // sub-drawer right here so the user can roll up the invoices,
      // generate the PDF, and email — all without leaving the board.
      const source = (orders.data ?? []).find(o => o.id === row.id);
      if (!source) {
        toast.push({
          kind: 'error',
          title: 'Order not loaded',
          description: 'Refresh the board and try again.',
        });
        return;
      }
      setBillingOrder(source);
      return;
    }
    const { email, matchedName } = resolveSupplierEmail(row.agent);
    if (!email) {
      toast.push({
        kind: 'warning',
        title: 'No email on file for this agent',
        description: matchedName
          ? `Found supplier "${matchedName}" but no email is set. Update it in Suppliers, then retry.`
          : `Agent "${row.agent}" is not in the suppliers list. Add them with an email, then retry.`,
      });
    }
    const invNumber = row.commissionInvoiceNumber || 'pending';
    const body = [
      `Dear ${row.agent},`,
      '',
      `Please find attached our commission invoice ${invNumber} for sales order ${row.orderNumber}.`,
      `Commission due: ${formatMoney(row.commissionAmount, 'USD')}.`,
      '',
      `PDF: ${row.commissionInvoicePdfUrl}`,
      '',
      'Kindly remit per the agreed terms.',
    ].join('\n');
    setEmailDraft({
      to: email ?? '',
      subject: `Commission invoice ${invNumber} — ${row.orderNumber}`,
      body,
      contextLabel: `Commission invoice · ${row.orderNumber}`,
    });
  };

  return (
    <div className="max-w-[1200px] space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users size={18} className="text-indigo-300" />
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              Agent Follow Up
            </h1>
            <Badge variant="info">live</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Per-agent rollups and outstanding commissions sourced from the agent sales pipeline.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => orders.refetch()}
          disabled={orders.isFetching}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12px]"
        >
          <RefreshCw size={13} className="mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <StatGrid columns={4}>
        <StatCard
          label="Agents active"
          value={String(summary.totals.agents)}
        />
        <StatCard
          label="Commission · YTD"
          value={formatMoney(summary.totals.ytdCommission, 'USD')}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(summary.totals.outstandingAmount, 'USD')}
          delta={summary.totals.stalledCount > 0
            ? { text: `${summary.totals.stalledCount} stalled >30d`, tone: 'negative' }
            : undefined}
        />
        <StatCard
          label="Paid · all-time"
          value={formatMoney(summary.totals.paidAmount, 'USD')}
        />
      </StatGrid>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-md bg-[#0f0f0f] border border-[#1f1f1f] w-fit">
        <TabButton active={tab === 'agents'} onClick={() => setTab('agents')}>
          By agent
          <Badge variant="neutral" dot>{summary.agents.length}</Badge>
        </TabButton>
        <TabButton active={tab === 'outstanding'} onClick={() => setTab('outstanding')}>
          Outstanding
          {summary.outstanding.length > 0 ? (
            <Badge variant="warning">{summary.outstanding.length}</Badge>
          ) : (
            <Badge variant="neutral" dot>0</Badge>
          )}
        </TabButton>
      </div>

      {/* Loading / error / body */}
      {orders.isLoading ? (
        <Card><CardBody><Skeleton className="h-32 w-full" /></CardBody></Card>
      ) : orders.error ? (
        <Card><CardBody>
          <div className="text-[12.5px] text-rose-400">
            Could not load agent orders: {String(orders.error)}
          </div>
        </CardBody></Card>
      ) : tab === 'agents' ? (
        <AgentsTable agents={summary.agents} onJump={() => navigate('sopici')} />
      ) : (
        <OutstandingTable
          rows={summary.outstanding}
          onJump={() => navigate('sopici')}
          onEmail={openEmail}
        />
      )}

      <CommissionBillingDrawer
        open={!!billingOrder}
        onOpenChange={(o) => !o && setBillingOrder(null)}
        order={billingOrder}
        resolveSupplierEmail={resolveSupplierEmail}
        onReady={(draft) => setEmailDraft(draft)}
      />

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`h-7 px-3 inline-flex items-center gap-2 text-[12px] rounded-[4px] font-medium transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'text-slate-400 hover:text-slate-200 hover:bg-[#161616]'
    }`}
  >
    {children}
  </button>
);

const AgentsTable: React.FC<{ agents: AgentRollup[]; onJump: () => void }> = ({ agents, onJump }) => {
  const columns: DataTableColumn<AgentRollup>[] = [
    {
      id: 'agent', header: 'Agent', sortable: true, filterable: true,
      value: r => r.agent,
      cell: r => (
        <div>
          <div className="text-slate-100 font-medium">{r.agent}</div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">
            {r.orderCount} order{r.orderCount === 1 ? '' : 's'} · {formatMoney(r.totalOrderValue, 'USD')} GMV
          </div>
        </div>
      ),
    },
    {
      id: 'totalCommission', header: 'Commission · total', sortable: true, mono: true, align: 'right',
      value: r => r.totalCommission,
      cell: r => <span className="text-slate-200 font-mono tabular-nums">{formatMoney(r.totalCommission, 'USD')}</span>,
    },
    {
      id: 'unpaidAmount', header: 'Outstanding', sortable: true, mono: true, align: 'right',
      value: r => r.invoicedAmount + r.unpaidAmount + r.approvedAmount,
      cell: r => {
        const owed = r.invoicedAmount + r.unpaidAmount + r.approvedAmount;
        const count = r.invoicedCount + r.unpaidCount + r.approvedCount;
        if (owed === 0) return <span className="text-slate-600">—</span>;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-amber-300 font-mono tabular-nums">{formatMoney(owed, 'USD')}</span>
            <span className="text-[10px] text-slate-500">({count})</span>
          </div>
        );
      },
    },
    {
      id: 'paidAmount', header: 'Paid', sortable: true, mono: true, align: 'right',
      value: r => r.paidAmount,
      cell: r => r.paidAmount > 0
        ? <span className="text-emerald-300 font-mono tabular-nums">{formatMoney(r.paidAmount, 'USD')}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'breakdown', header: 'Status mix', sortable: false,
      value: () => '',
      cell: r => (
        <div className="flex items-center gap-1 text-[10.5px]">
          {r.invoicedCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20 font-mono tabular-nums"
              title="Invoiced — commission earned, not yet billed to the agent"
            >
              {r.invoicedCount} I
            </span>
          )}
          {r.unpaidCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 font-mono tabular-nums"
              title="Unpaid — commission invoice sent, awaiting agent payment"
            >
              {r.unpaidCount} U
            </span>
          )}
          {r.approvedCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono tabular-nums"
              title="Approved — agent confirmed, awaiting transfer"
            >
              {r.approvedCount} A
            </span>
          )}
          {r.paidCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono tabular-nums"
              title="Paid — commission settled"
            >
              {r.paidCount} P
            </span>
          )}
          {r.invoicedCount + r.unpaidCount + r.approvedCount + r.paidCount === 0 && (
            <span className="text-slate-600">—</span>
          )}
        </div>
      ),
    },
    {
      id: 'lastActivity', header: 'Last activity', sortable: true, mono: true, align: 'right',
      value: r => r.lastActivity ?? '',
      cell: r => {
        if (!r.lastActivity) return <span className="text-slate-600">—</span>;
        const days = r.daysSinceActivity ?? 0;
        const tone =
          days >= 60 ? 'text-rose-300'
          : days >= 30 ? 'text-amber-300'
          : 'text-slate-400';
        return (
          <div className="flex items-center justify-end gap-1.5">
            <span className={`font-mono tabular-nums text-[11.5px] ${tone}`}>{fmtDate(r.lastActivity)}</span>
            <span className="text-[10px] text-slate-500">({days}d)</span>
          </div>
        );
      },
    },
  ];

  if (agents.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="No agent orders yet"
            description="Once orders land in the agent sales pipeline, per-agent rollups appear here."
            action={{ label: 'Open Agent Sales Orders', onClick: onJump }}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-agent rollup</CardTitle>
        <Badge variant="neutral" dot>{agents.length}</Badge>
        <span className="text-[11.5px] text-slate-500">sorted by outstanding</span>
      </CardHeader>
      <CardBody className="p-0">
        <DataTable<AgentRollup>
          columns={columns}
          rows={agents}
          getRowId={r => r.agent}
        />
      </CardBody>
    </Card>
  );
};

const OutstandingTable: React.FC<{
  rows: OutstandingRow[];
  onJump: () => void;
  onEmail: (row: OutstandingRow) => void;
}> = ({ rows, onJump, onEmail }) => {
  const columns: DataTableColumn<OutstandingRow>[] = [
    {
      id: 'orderNumber', header: 'Order', sortable: true, filterable: true, mono: true,
      value: r => r.orderNumber,
      cell: r => <span className="text-slate-100 font-medium">{r.orderNumber}</span>,
    },
    {
      id: 'agent', header: 'Agent', sortable: true, filterable: true,
      value: r => r.agent,
      cell: r => <span className="text-slate-200">{r.agent}</span>,
    },
    {
      id: 'customerName', header: 'Customer', sortable: true, filterable: true,
      value: r => r.customerName,
      cell: r => <span className="text-slate-300">{r.customerName || '—'}</span>,
    },
    {
      id: 'commissionAmount', header: 'Commission', sortable: true, mono: true, align: 'right',
      value: r => r.commissionAmount,
      cell: r => <span className="text-amber-300 font-mono tabular-nums">{formatMoney(r.commissionAmount, 'USD')}</span>,
    },
    {
      id: 'status', header: 'Status', sortable: true, filterable: true,
      value: r => r.status,
      cell: r => {
        const tone =
          r.status === 'APPROVED' ? 'info'
          : r.status === 'INVOICED' ? 'neutral'
          : 'warning';
        const title =
          r.status === 'INVOICED' ? 'Commission earned — issue the commission invoice next'
          : r.status === 'APPROVED' ? 'Agent confirmed — awaiting transfer'
          : 'Commission invoice sent — awaiting agent payment';
        return <Badge variant={tone} title={title}>{r.status}</Badge>;
      },
    },
    {
      id: 'commissionInvoiceDate', header: 'Invoiced', sortable: true, mono: true, align: 'right',
      value: r => r.commissionInvoiceDate ?? '',
      cell: r => r.commissionInvoiceDate
        ? <span className="text-slate-400 font-mono tabular-nums text-[11.5px]">{fmtDate(r.commissionInvoiceDate)}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'ageDays', header: 'Age', sortable: true, mono: true, align: 'right',
      value: r => r.ageDays,
      cell: r => {
        const tone =
          r.ageDays >= 60 ? 'text-rose-300'
          : r.ageDays >= 30 ? 'text-amber-300'
          : 'text-slate-300';
        return (
          <span className={`font-mono tabular-nums text-[11.5px] ${tone}`}>
            {r.ageDays}d
            {r.ageDays >= 30 && (
              <AlertTriangle size={11} className="inline ml-1 mb-0.5" />
            )}
          </span>
        );
      },
    },
    {
      id: 'actions', header: '', sortable: false, align: 'right',
      value: () => '',
      cell: r => (
        <div className="flex items-center justify-end gap-1">
          {r.commissionInvoicePdfUrl && (
            <a
              href={r.commissionInvoicePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open stored commission PDF in a new tab"
              className="p-1 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-[#161616] transition-colors"
              aria-label="Open commission PDF"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEmail(r); }}
            title={r.commissionInvoicePdfUrl
              ? 'Email the existing commission invoice to the agent'
              : 'Generate the commission invoice and email it'}
            className={r.commissionInvoicePdfUrl
              ? 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors'
              : 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-colors'}
            aria-label="Email commission invoice to agent"
          >
            <Mail size={11} />
            {r.commissionInvoicePdfUrl ? 'Email' : 'Bill & email'}
          </button>
        </div>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="No outstanding commissions"
            description="Every commission invoice is settled. Nothing to chase right now."
            action={{ label: 'Open Commissions', onClick: onJump }}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding commissions</CardTitle>
        <Badge variant="warning">{rows.length}</Badge>
        <span className="text-[11.5px] text-slate-500">sorted by age · oldest first</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="secondary"
          onClick={onJump}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-7 px-2.5 text-[11.5px]"
        >
          <ArrowUpRight size={12} className="mr-1" />
          Open in pipeline
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        <DataTable<OutstandingRow>
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
        />
      </CardBody>
    </Card>
  );
};

export default AgentFollowUpV2;
