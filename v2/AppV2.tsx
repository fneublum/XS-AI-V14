// Phase 3A — v2 application shell.
//
// Mounts only when index.tsx detects `?v2=1` in the URL. Contains:
//   - AuthProvider (reads v1 session store, for now)
//   - CompanyProvider (single company, switcher lands in 3B)
//   - QueryProvider (stub until TanStack Query is installed)
//   - ToastProvider
//   - A single placeholder route (/dashboard) until Phase 3B ports pages.
//
// Kept intentionally tiny (≈ 80 LOC) to illustrate the target shape of
// the App shell once all logic is extracted into providers/hooks.

import React, { Suspense, lazy } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { CompanyProvider } from './providers/CompanyProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider } from './primitives/Toast';

const DashboardV2 = lazy(() => import('./routes/DashboardV2'));

const Fallback: React.FC = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-slate-500">
    <span aria-live="polite">Loading…</span>
  </div>
);

const AppV2: React.FC = () => (
  <QueryProvider>
    <AuthProvider>
      <CompanyProvider>
        <ToastProvider>
          <Suspense fallback={<Fallback />}>
            <DashboardV2 />
          </Suspense>
        </ToastProvider>
      </CompanyProvider>
    </AuthProvider>
  </QueryProvider>
);

export default AppV2;
