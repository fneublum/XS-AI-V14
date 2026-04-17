// Phase 3B — SO+PI+CI Commissions (v1 SOPICIComissions, 9,945 LOC).
// Placeholder until the rebuild lands.

import React from 'react';
import { RebuildPendingV2 } from './RebuildPendingV2';

const SopiciCommissionsV2: React.FC = () => (
  <RebuildPendingV2
    title="SO / PI / CI Commissions"
    description="The full Sales Order + Proforma Invoice + Commercial Invoice commission workflow. Tracks every order from quote to payout, with per-seller splits and document linkage."
    v1Path=""
    locEstimate="~9,900 LOC"
    stats={[
      { label: 'Orders tracked', value: '74' },
      { label: 'Modules', value: '4' },
      { label: 'Commission stages', value: '6' },
    ]}
    v1Features={[
      'SO → PI → CI state machine with validation',
      'Per-line-item commission splits across multiple sellers',
      'Document attachment (original SO PDF, BL, PL, signed CI)',
      'Payment tracking + commission payout status',
      'QuickBooks sync for invoice-side entries',
    ]}
    plannedFeatures={[
      'Pipeline view — drag orders across stages (Kanban or list-with-stage-col)',
      'Inline seller-split editor, shadcn-style tag input',
      'Doc drawer reusing Phase 3B PDF viewer primitives',
      'One Supabase query via a materialised view',
      'Keyboard-first stage transitions (⌘1..⌘6)',
    ]}
  />
);

export default SopiciCommissionsV2;
