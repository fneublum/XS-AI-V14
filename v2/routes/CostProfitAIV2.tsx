// Phase 3B — Cost / Profit AI (v1 CostProfitAI, 5,071 LOC).
// Placeholder until the rebuild lands.

import React from 'react';
import { RebuildPendingV2 } from './RebuildPendingV2';

const CostProfitAIV2: React.FC = () => (
  <RebuildPendingV2
    title="Cost / Profit AI"
    description="Landed-cost calculator + margin analyser. Pulls freight, duty, and supplier price data, then runs AI-driven sensitivity analysis on target sell prices."
    v1Path=""
    locEstimate="~5,100 LOC"
    stats={[
      { label: 'Cost inputs', value: '18' },
      { label: 'AI prompts', value: '3' },
      { label: 'Output scenarios', value: 'N×3' },
    ]}
    v1Features={[
      'Landed-cost breakdown (FOB → CFR → CIF → DDP)',
      'AI advisor suggesting price / margin adjustments',
      'Scenario comparison (pessimistic / base / optimistic)',
      'Export to PDF + copy-to-proposal',
      'Historical actuals overlay per customer',
    ]}
    plannedFeatures={[
      'Single page, not tabs — everything visible at once',
      'AI advisor becomes an inline "explain" affordance, not a separate button',
      'Scenarios as column-view in the same table, not nested modal',
      'Phase 2A orchestrator for Claude / Gemini routing by sub-task',
      'Proposal export uses the v2 template renderer',
    ]}
  />
);

export default CostProfitAIV2;
