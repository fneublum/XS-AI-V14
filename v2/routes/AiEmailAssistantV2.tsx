// v2 AI Email Assistant — imports the v1 view as a base.
//
// v1 [pages/AiEmailAssistant.tsx](../../pages/AiEmailAssistant.tsx)
// owns the inbox list, reader, attachment OCR, doc-type extraction and
// Outlook/Graph auth. We mount it under the same `v2-dark-scope`
// bridge used by DashboardV2 so v1's light classes render correctly
// in v2 dark mode; in light mode the bridge stays inert and v1's
// native light palette shows through.

import React, { useEffect, useState } from 'react';
import { useCompany } from '../providers/CompanyProvider';
import { initializeMsal } from '../../services/smailAuth';

const V1AiEmailAssistant = React.lazy(() => import('../../pages/AiEmailAssistant'));

const AiEmailAssistantV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const [msalReady, setMsalReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initializeMsal()
      .then(() => { if (!cancelled) setMsalReady(true); })
      .catch(err => {
        console.warn('[AiEmailAssistantV2] MSAL init failed', err);
        // Fail open — the component can still render and show its
        // sign-in prompt, letting the user drive login manually.
        if (!cancelled) setMsalReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!msalReady) {
    return (
      <div className="flex items-center justify-center h-[40vh] text-slate-500 text-[13px]">
        Initializing mail authentication…
      </div>
    );
  }

  return (
    <div className="v2-dark-scope h-full -m-6">
      <React.Suspense
        fallback={
          <div className="flex items-center justify-center h-[40vh] text-slate-500 text-[13px]">
            Loading AI Email Assistant…
          </div>
        }
      >
        <V1AiEmailAssistant currentCompanyId={currentCompanyId === 'ALL' ? undefined : currentCompanyId} />
      </React.Suspense>
    </div>
  );
};

export default AiEmailAssistantV2;
