// Phase 3B — v2 AI Email Assistant.

import React from 'react';
import { ModuleLanding } from '../components/ModuleLanding';
import { ActivityFeed } from '../components/ActivityFeed';
import { useToast } from '../primitives/Toast';

const AiEmailAssistantV2: React.FC = () => {
  const toast = useToast();
  return (
    <ModuleLanding
      title="AI Email Assistant"
      badge="Beta"
      description="Triage your inbox, draft replies in your tone, and auto-extract PO / invoice references. Connects to Outlook and Gmail via OAuth."
      stats={[
        { label: 'Inbox', value: '—' },
        { label: 'Drafts',  value: '—' },
        { label: 'Extracted POs', value: '—', tone: 'positive' },
      ]}
      actions={[
        {
          id: 'triage',
          label: 'Triage inbox',
          description: 'Classify unread and suggest actions.',
          onClick: () => toast.push({ kind: 'info', title: 'Triage', description: 'Full flow ships with Phase 3C.' }),
        },
        {
          id: 'draft',
          label: 'Draft a reply',
          description: 'Open the composer with AI suggestions.',
          onClick: () => toast.push({ kind: 'info', title: 'Compose', description: 'Full flow ships with Phase 3C.' }),
        },
      ]}
      recent={<ActivityFeed module="AI_EMAIL" title="Recent emails handled" />}
    />
  );
};

export default AiEmailAssistantV2;
