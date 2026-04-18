// Phase 3B — Trading Follow Up (stub).
// Open SO / PO / Invoice status board. Port lands after the Data modal
// is wired; for now it links to the existing v2 list views.

import React from 'react';
import { Workflow } from 'lucide-react';
import { Card, Button, Badge } from '../primitives';

interface Props {
  navigate: (id: string) => void;
}

const TradingFollowUpV2: React.FC<Props> = ({ navigate }) => (
  <div className="max-w-3xl">
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Trading Follow Up</h1>
        <Badge variant="info">preview</Badge>
      </div>
      <p className="text-[13px] text-slate-500 mt-1">
        Combined PO / SO / Invoice pipeline view. Stage pipeline lands in Phase 3C.
      </p>
    </div>
    <Card>
      <div className="p-6 space-y-3">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-md bg-indigo-600/10 text-indigo-300">
            <Workflow size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-slate-100">
              Jump into a specific stage
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
              Until the unified board lands, navigate directly to each stage:
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('purchase-orders')}
                className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
                Purchase Orders
              </Button>
              <Button size="sm" onClick={() => navigate('sales-orders')}
                className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
                Sales Orders
              </Button>
              <Button size="sm" onClick={() => navigate('pl-invoice')}
                className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
                Packing list &amp; Invoice
              </Button>
              <Button size="sm" onClick={() => navigate('invoices')}
                className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-3 text-[12.5px]">
                Invoice &amp; docs
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  </div>
);

export default TradingFollowUpV2;
