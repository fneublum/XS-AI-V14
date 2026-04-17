// Phase 3B — v2 AI Dashboard.

import React from 'react';
import { ModuleLanding } from '../components/ModuleLanding';
import { ActivityFeed } from '../components/ActivityFeed';
import { useToast } from '../primitives/Toast';

const AiDashboardV2: React.FC = () => {
  const toast = useToast();
  return (
    <ModuleLanding
      title="AI Dashboard"
      badge="Beta"
      description="Unified view of AI-driven automations — emails processed, documents extracted, insights generated. Every AI call across the platform is tracked here."
      stats={[
        { label: 'Runs today',   value: '—' },
        { label: 'Avg latency',  value: '—' },
        { label: 'Success rate', value: '—', tone: 'positive' },
        { label: 'Open tasks',   value: '—', tone: 'warning' },
      ]}
      actions={[
        {
          id: 'run-diag',
          label: 'Run Brain diagnostics',
          description: 'Probe the AI pipeline end-to-end.',
          onClick: () => toast.push({ kind: 'info', title: 'Brain diagnostics', description: 'Port lands with Phase 3C.' }),
        },
        {
          id: 'view-telemetry',
          label: 'View AI telemetry',
          description: 'Token usage, cache hit rate, circuit breaker state.',
          onClick: () => toast.push({ kind: 'info', title: 'Telemetry', description: 'Phase 2A orchestrator table.' }),
        },
      ]}
      recent={<ActivityFeed title="Recent AI events" />}
    />
  );
};

export default AiDashboardV2;
