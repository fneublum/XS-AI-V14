// v2 Agent Queue — single-page view of the email/document review queue.
//
// History: this used to host three tabs (Email / WhatsApp / Briefing).
// As of v14.16 WhatsApp delivery and daily briefings are owned by HERMES
// agents on the Mac mini, so those tabs were redundant — removed in
// v14.17. The file is kept as a thin wrapper around AiInboxV2 so the
// `connections-tabs` route id and any deep links keep working.

import React from 'react';
import AiInboxV2 from './AiInboxV2';

const ConnectionsTabsV2: React.FC = () => <AiInboxV2 />;

export default ConnectionsTabsV2;
