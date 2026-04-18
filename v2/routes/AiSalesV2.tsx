// Phase 3B — AI Sales (stub).
// Port lands in Phase 3C — target behavior is a sales-facing AI
// workspace: lead triage, opportunity follow-up drafting, pricing
// suggestions from the cost / profit calculator. For now it handoffs
// to the v1 AI Dashboard with a clear entry point.

import React from 'react';
import { Bot } from 'lucide-react';
import { Card, Button, Badge } from '../primitives';

const AiSalesV2: React.FC = () => (
  <div className="max-w-3xl">
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">AI Sales</h1>
        <Badge variant="info">preview</Badge>
      </div>
      <p className="text-[13px] text-slate-500 mt-1">
        Agent-assisted sales flows. Port lands in Phase 3C.
      </p>
    </div>
    <Card>
      <div className="p-6 flex items-start gap-4">
        <div className="p-2.5 rounded-md bg-indigo-600/10 text-indigo-300">
          <Bot size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-slate-100">
            Sales AI workspace — coming next
          </h2>
          <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
            Lead triage, pricing suggestions from the cost / profit calculator,
            follow-up drafting against open opportunities. For now, the v1 AI
            Dashboard covers the same ground.
          </p>
          <div className="mt-4">
            <Button
              size="sm"
              onClick={() => { window.location.href = '/?v2=0'; }}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-8 px-3 text-[12.5px] font-medium rounded-md"
            >
              Open v1 AI Dashboard
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </div>
);

export default AiSalesV2;
