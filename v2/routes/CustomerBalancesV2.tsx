// Phase 3B — v2 Customer Balances.
//
// Full balances UI is a 1.1k-LOC v1 module (QuickBooks fetch, statement
// PDF export, emailing, date-preset calculator). Not ported yet —
// instead this page gives users a clear entry point and hands off to
// v1 via sessionStorage, mirroring the Delivery Documents flow on
// Invoices. v1 App.tsx reads `xs_pending_finance_balances` on mount
// and lands the user on FINANCE / BALANCES.

import React from 'react';
import { Card, EmptyState, Button, Badge } from '../primitives';
import { Scale } from 'lucide-react';

const openInV1 = () => {
  try { sessionStorage.setItem('xs_pending_finance_balances', '1'); }
  catch { /* noop */ }
  window.location.href = '/?v2=0';
};

const CustomerBalancesV2: React.FC = () => (
  <div className="max-w-3xl">
    <div className="mb-6 flex items-baseline justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Customer Balances
          </h1>
          <Badge variant="info">v1 module</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1">
          QuickBooks statements, aging, and PDF / email send.
        </p>
      </div>
    </div>

    <Card>
      <div className="p-6 flex items-start gap-4">
        <div className="p-2.5 rounded-md bg-indigo-600/10 text-indigo-300">
          <Scale size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-slate-100">
            Open the full Balances module
          </h2>
          <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
            The v2 preview doesn&apos;t yet port the QuickBooks statement
            generator, date-preset calculator, and PDF / email send. Click
            below to open the full v1 module in this tab — your session and
            company scope carry over. Closing the v1 tab or flipping
            <span className="font-mono tabular-nums text-slate-300 mx-1">?v2=1</span>
            brings you back here.
          </p>
          <div className="mt-4">
            <Button
              size="sm"
              onClick={openInV1}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-8 px-3 text-[12.5px] font-medium rounded-md"
            >
              Open Customer Balances in v1
            </Button>
          </div>
        </div>
      </div>
    </Card>

    <Card className="mt-4">
      <EmptyState
        title="What ships in the port"
        description="Statement fetch per customer, aging buckets, date presets (this/last/next week/month/quarter/year + fiscal variants), PDF export, and in-app email send. Target: Phase 3C after commissions and cost-profit parity."
      />
    </Card>
  </div>
);

export default CustomerBalancesV2;
