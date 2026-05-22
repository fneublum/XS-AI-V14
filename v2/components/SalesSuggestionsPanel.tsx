// "Sales Suggestions" panel — surfaced at the top of AI Sales Agent.
//
// Reads `useSalesSuggestions` (per-customer reorder hints derived from
// the company's sales-order history) and renders them as a ranked list
// with a one-click "Draft proposal" action that prefills the composer
// below.

import React, { useState } from 'react';
import { TrendingUp, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '../primitives';
import { useSalesSuggestions } from '../queries/useSalesSuggestions';
import { buildIntentForSuggestion, type SalesSuggestion } from '../services/salesSuggestions';

interface Props {
  /** Called when the user clicks "Draft proposal" on a row. The parent
   *  switches the composer to `audience='customer'`, picks the matching
   *  recipient, and prefills the intent textarea. */
  onDraft: (args: { customerId: string | null; customerName: string; intent: string }) => void;
}

const bucketLabel: Record<SalesSuggestion['bucket'], string> = {
  'urgent': 'URGENT',
  'overdue': 'OVERDUE',
  'due-soon': 'DUE SOON',
  'single-order': 'RE-ENGAGE',
  'recent': 'RECENT',
};

const bucketTone: Record<SalesSuggestion['bucket'], 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  'urgent': 'danger',
  'overdue': 'warning',
  'due-soon': 'info',
  'single-order': 'neutral',
  'recent': 'success',
};

const fmtMoney = (n: number) =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const SalesSuggestionsPanel: React.FC<Props> = ({ onDraft }) => {
  const { data, isLoading, error, refetch } = useSalesSuggestions();
  const [includeRecent, setIncludeRecent] = useState(false);

  const all = data ?? [];
  const visible = includeRecent
    ? all
    : all.filter(s => s.bucket !== 'recent');

  const actionableCount = all.filter(s =>
    s.bucket === 'urgent' || s.bucket === 'overdue' || s.bucket === 'due-soon' || s.bucket === 'single-order'
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300 shrink-0">
              <TrendingUp size={14} />
            </div>
            <div className="min-w-0">
              <CardTitle>Sales suggestions</CardTitle>
              <p className="text-[11.5px] text-slate-500 mt-0.5 truncate">
                Customers ranked by reorder urgency from your sales-order history.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actionableCount > 0 && (
              <Badge variant="warning">{actionableCount} to act on</Badge>
            )}
            <button
              type="button"
              onClick={() => setIncludeRecent(v => !v)}
              className="text-[11px] px-2 py-1 rounded-md border border-[#1f1f1f] text-slate-400 hover:text-slate-200 hover:border-[#2a2a2a]"
            >
              {includeRecent ? 'Hide recent' : 'Show recent'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading && (
          <div className="px-4 py-6 text-[12.5px] text-slate-500 flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Analyzing purchase history…
          </div>
        )}
        {error && (
          <div className="px-4 py-3 text-[12.5px] text-rose-400">
            Could not load: {String(error)}{' '}
            <button onClick={() => refetch()} className="underline">Retry</button>
          </div>
        )}
        {!isLoading && !error && visible.length === 0 && (
          <div className="px-4 py-6 text-[12.5px] text-slate-500">
            No actionable suggestions right now. Customers are either too new or already up to date with their cadence.
          </div>
        )}
        {visible.length > 0 && (
          <div className="divide-y divide-[#1a1a1a]">
            {visible.map(s => (
              <Row
                key={`${s.customerId ?? s.customerName}`}
                s={s}
                onDraft={onDraft}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

const Row: React.FC<{ s: SalesSuggestion; onDraft: Props['onDraft'] }> = ({ s, onDraft }) => {
  return (
    <div className="px-4 py-3 hover:bg-[#0e0e0e] transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[13px] font-medium text-slate-100 truncate">
              {s.customerName}
            </span>
            <Badge variant={bucketTone[s.bucket]}>{bucketLabel[s.bucket]}</Badge>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {s.orderCount} order{s.orderCount === 1 ? '' : 's'} · {fmtMoney(s.totalSpent)} LTV
            </span>
          </div>
          <p className="text-[11.5px] text-slate-500">{s.reason}</p>
          {s.topProducts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.topProducts.map(p => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] bg-[#161616] border border-[#1f1f1f] text-slate-300"
                >
                  <span className="truncate max-w-[200px]">{p.name}</span>
                  <span className="text-slate-500">×{p.occurrences}</span>
                  {p.avgQuantity > 0 && (
                    <span className="text-slate-600 font-mono tabular-nums">{p.avgQuantity}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => onDraft({
            customerId: s.customerId,
            customerName: s.customerName,
            intent: buildIntentForSuggestion(s),
          })}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 h-7 px-2.5 text-[11.5px] font-medium rounded-md inline-flex items-center gap-1.5 shrink-0"
        >
          <Sparkles size={11} />
          Draft proposal
        </Button>
      </div>
    </div>
  );
};
