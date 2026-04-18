// Phase 3B — Agent Follow Up (stub).
// Overview of agent commissions + pending payouts. Port lands after
// the Data modal; for now it links to the Commissions pipeline.

import React from 'react';
import { Users } from 'lucide-react';
import { Card, Button, Badge } from '../primitives';

interface Props {
  navigate: (id: string) => void;
}

const AgentFollowUpV2: React.FC<Props> = ({ navigate }) => (
  <div className="max-w-3xl">
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Agent Follow Up</h1>
        <Badge variant="info">preview</Badge>
      </div>
      <p className="text-[13px] text-slate-500 mt-1">
        Agent-attributed sales &amp; commission payouts. Dedicated board ships in Phase 3C.
      </p>
    </div>
    <Card>
      <div className="p-6 flex items-start gap-4">
        <div className="p-2.5 rounded-md bg-indigo-600/10 text-indigo-300">
          <Users size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-slate-100">
            Jump to related views
          </h2>
          <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
            The commission pipeline and per-order breakdown are already live. A
            dedicated agent-facing overview with payout schedules, seller
            attribution audit, and follow-up tasks is next.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate('sopici')}
              className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
              Agent Sales Orders
            </Button>
            <Button size="sm" onClick={() => navigate('commissions')}
              className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
              Commission Invoices
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </div>
);

export default AgentFollowUpV2;
