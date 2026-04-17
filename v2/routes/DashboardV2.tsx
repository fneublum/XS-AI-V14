// Phase 3A — Placeholder v2 Dashboard route.
// Real migration happens in Phase 3B. This exists so AppV2 has something
// to render when the `?v2=1` flag is on.

import React from 'react';
import { Button } from '../primitives';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';

const DashboardV2: React.FC = () => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();
  const toast = useToast();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold text-slate-900">XS-ERP v2 — Dashboard (scaffold)</h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed-in user: <span className="font-medium">{user?.name ?? user?.email ?? 'anonymous'}</span>
        {' · '}company: <span className="font-medium">{currentCompanyId}</span>
      </p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-800">Scaffold primitives check</h2>
        <p className="mt-1 text-sm text-slate-600">
          This page exists solely to confirm the v2 shell boots. Real content lands in Phase 3B.
        </p>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => toast.push({ kind: 'success', title: 'Toast works' })}>
            Fire a toast
          </Button>
          <Button variant="secondary" onClick={() => toast.push({ kind: 'info', title: 'Secondary variant' })}>
            Secondary
          </Button>
        </div>
      </section>
    </main>
  );
};

export default DashboardV2;
