// v2 Connections Hub — imports the v1 view as a base.
//
// v1 [pages/ConnectionsHub.tsx](../../pages/ConnectionsHub.tsx) owns
// the Email (Outlook/Graph + Gmail) + WhatsApp (Twilio) + Briefing
// tabs. Mounted under the `v2-dark-scope` bridge (same pattern as
// DashboardV2 / AiEmailAssistantV2) so v1's light Tailwind classes
// render correctly in v2 dark mode; light mode leaves the bridge
// inert and v1's native palette shows through.

import React, { useEffect, useState } from 'react';
import { useCompany } from '../providers/CompanyProvider';
import { useAuth } from '../providers/AuthProvider';
import { initializeMsal } from '../../services/smailAuth';

const V1ConnectionsHub = React.lazy(() => import('../../pages/ConnectionsHub'));

const ConnectionsHubV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const { user } = useAuth();
  const [msalReady, setMsalReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initializeMsal()
      .then(() => { if (!cancelled) setMsalReady(true); })
      .catch(err => {
        console.warn('[ConnectionsHubV2] MSAL init failed', err);
        if (!cancelled) setMsalReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!msalReady) {
    return (
      <div className="flex items-center justify-center h-[40vh] text-slate-500 text-[13px]">
        Initializing authentication…
      </div>
    );
  }

  return (
    <div className="v2-dark-scope h-full -m-6">
      <React.Suspense
        fallback={
          <div className="flex items-center justify-center h-[40vh] text-slate-500 text-[13px]">
            Loading Connections…
          </div>
        }
      >
        <V1ConnectionsHub
          currentCompanyId={currentCompanyId === 'ALL' ? undefined : currentCompanyId}
          currentUser={user ?? undefined}
        />
      </React.Suspense>
    </div>
  );
};

export default ConnectionsHubV2;
