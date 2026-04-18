// Phase 3B — v2 P&L.

import React from 'react';
import { Card, CardHeader, CardTitle, CardBody, Skeleton, EmptyState, StatCard, StatGrid } from '../primitives';
import { usePL } from '../queries/usePL';
import { useCompany } from '../providers/CompanyProvider';
import { formatMoney as fmtMoney } from '../lib/formatMoney';

const PLV2: React.FC = () => {
  const pl = usePL();
  const { currentCompanyId } = useCompany();

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Profit &amp; Loss</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          Top-line revenue minus COGS and accepted freight costs, scoped to
          <span className="font-mono tabular-nums ml-1">{currentCompanyId}</span>.
        </p>
      </div>

      {pl.isLoading ? (
        <div className="grid grid-cols-4 gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#0a0a0a] p-4">
              <Skeleton width={70} height={10} />
              <Skeleton width={160} height={26} className="mt-2" />
            </div>
          ))}
        </div>
      ) : pl.error ? (
        <EmptyState
          tone="danger"
          title="Couldn't load P&L"
          description={pl.error.message}
          action={{ label: 'Retry', onClick: pl.refetch }}
        />
      ) : pl.data ? (
        <>
          <StatGrid columns={4}>
            <StatCard
              label="Revenue"
              value={fmtMoney(pl.data.revenue)}
              delta={{ text: `${pl.data.invoiceCount} invoices`, tone: 'neutral' }}
            />
            <StatCard
              label="COGS"
              value={fmtMoney(pl.data.cogs)}
              delta={{ text: `${pl.data.supplierInvoiceCount} bills`, tone: 'neutral' }}
            />
            <StatCard
              label="Freight"
              value={fmtMoney(pl.data.freight)}
              delta={{ text: 'accepted quotes', tone: 'neutral' }}
            />
            <StatCard
              label="Gross margin"
              value={fmtMoney(pl.data.grossMargin)}
              delta={
                pl.data.grossMarginPct !== null
                  ? {
                      text: `${pl.data.grossMarginPct.toFixed(1)}%`,
                      tone: pl.data.grossMargin >= 0 ? 'positive' : 'negative',
                    }
                  : { text: 'no revenue', tone: 'neutral' }
              }
            />
          </StatGrid>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="text-[12.5px] text-slate-500 space-y-1.5 list-disc pl-4">
                <li>
                  Revenue reads from <span className="font-mono">invoices.totalAmount</span>
                </li>
                <li>
                  COGS reads from <span className="font-mono">invoices_suppliers.totalAmount</span>
                </li>
                <li>
                  Freight sums <span className="font-mono">freight_quotes.rate</span> where
                  <span className="font-mono"> status</span> contains "ACCEPT"
                </li>
                <li>
                  Period filter and GL accounts land in Phase 3C alongside a proper ledger.
                </li>
              </ul>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default PLV2;
