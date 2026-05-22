// Phase 3B — Commission pipeline Kanban.
//
// Groups commission_sales_orders by a single inferred stage, so the
// user can see where each order sits: DRAFT → APPROVED → INVOICED →
// PAID. Cards show the SO, customer, rate, and commission amount;
// clicking a card opens the CommissionDrawer for edit.

import React from 'react';
import { Badge } from '../primitives';
import { CommissionRow } from '../queries/useCommissions';
import { cn } from '../primitives/utils';
import { shortName, tooltipName } from '../lib/formatName';

type Stage = 'DRAFT' | 'APPROVED' | 'INVOICED' | 'PAID' | 'ISSUE';

const STAGES: Array<{ id: Stage; label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = [
  { id: 'DRAFT',     label: 'Draft',     tone: 'neutral' },
  { id: 'APPROVED',  label: 'Approved',  tone: 'info' },
  { id: 'INVOICED',  label: 'Invoiced',  tone: 'warning' },
  { id: 'PAID',      label: 'Paid',      tone: 'success' },
  { id: 'ISSUE',     label: 'Issue',     tone: 'danger' },
];

/**
 * Roll up every status field onto a single stage. The combinations are
 * many — this captures the happy path and surfaces problems on the
 * `ISSUE` column rather than losing them in a single filtered view.
 */
function stageOf(row: CommissionRow): Stage {
  const payment = (row.paymentStatus ?? '').toUpperCase();
  const payout  = (row.commissionPaymentStatus ?? '').toUpperCase();
  const invoice = (row.invoiceStatus ?? '').toUpperCase();

  if (payment.includes('CANCEL') || payout.includes('CANCEL')) return 'ISSUE';
  if (payment === 'OVERDUE')                                    return 'ISSUE';

  if (payout === 'PAID')                                        return 'PAID';
  if (payment === 'PAID' || payout === 'APPROVED')              return 'INVOICED';
  if (invoice.includes('INVOICED') || invoice.includes('SENT')) return 'INVOICED';
  if (payment === 'PENDING' || payment === 'PARTIAL')           return 'APPROVED';
  return 'DRAFT';
}

const fmtMoney = (n: number): string => `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number | null): string => {
  if (n === null) return '—';
  const scaled = n > 1 ? n : n * 100;
  return `${scaled.toFixed(1)}%`;
};

interface Props {
  rows: CommissionRow[];
  onCardClick: (row: CommissionRow) => void;
}

export const CommissionPipeline: React.FC<Props> = ({ rows, onCardClick }) => {
  // Group in one pass so we don't O(stages × rows).
  const buckets = new Map<Stage, CommissionRow[]>();
  for (const s of STAGES) buckets.set(s.id, []);
  for (const r of rows) buckets.get(stageOf(r))!.push(r);

  const totals = new Map<Stage, number>();
  for (const s of STAGES) {
    totals.set(s.id, (buckets.get(s.id) ?? []).reduce((sum, r) => sum + r.commissionAmount, 0));
  }

  return (
    <div className="grid grid-cols-5 gap-3">
      {STAGES.map(stage => {
        const items = buckets.get(stage.id) ?? [];
        return (
          <div key={stage.id} className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] overflow-hidden flex flex-col min-h-[320px]">
            <div className="px-3 py-2 border-b border-[#1f1f1f] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={stage.tone} dot>{stage.label}</Badge>
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {items.length}
                </span>
              </div>
              <span className="text-[10px] text-slate-600 font-mono tabular-nums">
                {fmtMoney(totals.get(stage.id) ?? 0)}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[70vh]">
              {items.length === 0 ? (
                <div className="text-[11px] text-slate-600 text-center py-4">
                  Empty
                </div>
              ) : (
                items.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onCardClick(r)}
                    className={cn(
                      'block w-full text-left rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-2.5',
                      'hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono tabular-nums text-[11.5px] text-slate-200">
                        {r.orderNumber}
                      </span>
                      {r.invoiceNumber && (
                        <span className="font-mono tabular-nums text-[10px] text-slate-500">
                          · {r.invoiceNumber}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-slate-100 font-medium truncate"
                         title={tooltipName(r.customerName)}>
                      {shortName(r.customerName)}
                    </div>
                    {r.sellerName && (
                      <div className="text-[10.5px] text-slate-500 truncate mt-0.5"
                           title={tooltipName(r.sellerName)}>
                        via {shortName(r.sellerName)}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2 text-[11px]">
                      <span className="text-slate-500 font-mono tabular-nums">
                        {fmtPct(r.commissionRate)}
                      </span>
                      <span className="text-emerald-400 font-mono tabular-nums font-semibold">
                        {fmtMoney(r.commissionAmount)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
