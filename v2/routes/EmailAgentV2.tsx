// Phase 3B — v2 Email Agent (autonomous inbox watcher).

import React from 'react';
import { ModuleLanding } from '../components/ModuleLanding';
import { ActivityFeed } from '../components/ActivityFeed';
import { useToast } from '../primitives/Toast';

const EmailAgentV2: React.FC = () => {
  const toast = useToast();
  return (
    <ModuleLanding
      title="Email Agent"
      badge="Beta"
      description="Runs in the background, scanning shared inboxes on a schedule. Extracts POs, acknowledges customer emails, and escalates edge cases."
      stats={[
        { label: 'Watchers', value: '—' },
        { label: 'Handled 24h', value: '—' },
        { label: 'Escalated', value: '—', tone: 'warning' },
      ]}
      actions={[
        {
          id: 'toggle',
          label: 'Toggle watchers on / off',
          description: 'Master switch for the agent.',
          onClick: () => toast.push({ kind: 'info', title: 'Toggle', description: 'Scheduler lands with Phase 3C.' }),
        },
        {
          id: 'rules',
          label: 'Edit triage rules',
          description: 'Configure what gets auto-handled vs escalated.',
          onClick: () => toast.push({ kind: 'info', title: 'Rules', description: 'Editor lands with Phase 3C.' }),
        },
      ]}
      recent={<ActivityFeed module="EMAIL_AGENT" title="Recent agent runs" />}
    />
  );
};

export default EmailAgentV2;
