// Phase 3B — v2 AI Logistics Manager.

import React from 'react';
import { ModuleLanding } from '../components/ModuleLanding';
import { ActivityFeed } from '../components/ActivityFeed';
import { useToast } from '../primitives/Toast';

const AiLogisticsManagerV2: React.FC = () => {
  const toast = useToast();
  return (
    <ModuleLanding
      title="AI Logistics Manager"
      badge="Beta"
      description="Autonomous logistics agent — compares freight quotes, books the best option, watches ETD/ETA across carriers, and alerts on rolls or delays."
      stats={[
        { label: 'Quotes compared', value: '—' },
        { label: 'Bookings created', value: '—', tone: 'positive' },
        { label: 'Delays flagged', value: '—', tone: 'warning' },
      ]}
      actions={[
        {
          id: 'run-compare',
          label: 'Compare quotes for a lane',
          description: 'Pick origin/destination and rank by all-in rate.',
          onClick: () => toast.push({ kind: 'info', title: 'Compare', description: 'Flow ships with Phase 3C.' }),
        },
        {
          id: 'watch-shipment',
          label: 'Add a shipment watcher',
          description: 'Alerts on carrier ETD/ETA changes.',
          onClick: () => toast.push({ kind: 'info', title: 'Watch', description: 'Flow ships with Phase 3C.' }),
        },
      ]}
      recent={<ActivityFeed module="AI_LOGISTICS" title="Recent logistics actions" />}
    />
  );
};

export default AiLogisticsManagerV2;
