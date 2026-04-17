// Phase 3B — PL Invoice Engine (v1 PLInvoiceEngine, 5,943 LOC).
// Placeholder until the rebuild lands.

import React from 'react';
import { RebuildPendingV2 } from './RebuildPendingV2';

const PLInvoiceEngineV2: React.FC = () => (
  <RebuildPendingV2
    title="P&L Invoice Engine"
    description="Generates supplier-side P&L invoices — reconciles line items across supplier POs, packing lists, and BLs, then emits the P&L-ready invoice."
    v1Path=""
    locEstimate="~5,900 LOC"
    stats={[
      { label: 'Lookups per invoice', value: '12' },
      { label: 'Mapping rules',       value: '40+' },
      { label: 'QB accounts touched', value: '8' },
    ]}
    v1Features={[
      'Line-item matching across PO / PL / BL / supplier invoice',
      'Freight cost allocation across SKUs by weight / volume',
      'Customs duty + brokerage pro-rata by landed cost',
      'QuickBooks journal entry preview + push',
      'Side-by-side source-vs-calculated preview',
    ]}
    plannedFeatures={[
      'Step wizard — 4 phases instead of one 5,900-LOC page',
      'Reusable PO / PL / BL pickers from Phase 3B Drawer primitive',
      'Cost-allocation rules editor with live preview',
      'Invoice preview driven by v2 templates (same renderer as SOs)',
      'QuickBooks preview becomes a read-only pane, not an inline editor',
    ]}
  />
);

export default PLInvoiceEngineV2;
