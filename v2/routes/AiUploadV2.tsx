// Phase 3B — v2 AI Upload.

import React from 'react';
import { ModuleLanding } from '../components/ModuleLanding';
import { ActivityFeed } from '../components/ActivityFeed';
import { useToast } from '../primitives/Toast';

const AiUploadV2: React.FC = () => {
  const toast = useToast();
  return (
    <ModuleLanding
      title="AI Upload"
      badge="Beta"
      description="Drop a PO, invoice, BL, or packing list — AI extracts the fields, routes the document to the right workflow, and files a draft record you can approve."
      actions={[
        {
          id: 'upload-po',
          label: 'Upload Purchase Order',
          description: 'PDF or image → PO draft',
          onClick: () => toast.push({ kind: 'info', title: 'Upload PO', description: 'Drop zone port lands with Phase 3C.' }),
        },
        {
          id: 'upload-invoice',
          label: 'Upload Invoice',
          description: 'Parse line items + totals',
          onClick: () => toast.push({ kind: 'info', title: 'Upload invoice', description: 'Drop zone port lands with Phase 3C.' }),
        },
        {
          id: 'upload-bl',
          label: 'Upload Bill of Lading',
          description: 'Extract ports, vessel, consignee',
          onClick: () => toast.push({ kind: 'info', title: 'Upload B/L', description: 'Drop zone port lands with Phase 3C.' }),
        },
        {
          id: 'upload-pl',
          label: 'Upload Packing List',
          description: 'Match to SO + B/L automatically',
          onClick: () => toast.push({ kind: 'info', title: 'Upload PL', description: 'Drop zone port lands with Phase 3C.' }),
        },
      ]}
      recent={<ActivityFeed module="AI_UPLOAD" title="Recent extractions" />}
    />
  );
};

export default AiUploadV2;
