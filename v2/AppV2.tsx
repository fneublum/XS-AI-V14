// Phase 3A — v2 application shell.
//
// Mounts when index.tsx detects `?v2=1`. Stays tiny (~70 LOC) — all the
// UI weight lives in v2/layout and v2/routes. Only real responsibility:
// compose providers and hand a nav model + current route to AppShell.

import React, { Suspense, lazy, useMemo, useState } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { CompanyProvider } from './providers/CompanyProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider, useToast } from './primitives/Toast';
import { AppShell } from './layout/AppShell';

const DashboardV2 = lazy(() => import('./routes/DashboardV2'));

const sections = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'dashboard',        label: 'Dashboard',       hint: 'D' },
      { id: 'customers',        label: 'Customers',       count: 128, disabled: true },
      { id: 'suppliers',        label: 'Suppliers',       count: 42,  disabled: true },
      { id: 'sales-orders',     label: 'Sales Orders',    count: 7,   disabled: true },
      { id: 'purchase-orders',  label: 'Purchase Orders',             disabled: true },
      { id: 'logistics',        label: 'Logistics',                   disabled: true },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { id: 'receivables', label: 'Receivables', disabled: true },
      { id: 'payables',    label: 'Payables',    disabled: true },
      { id: 'commissions', label: 'Commissions', disabled: true },
    ],
  },
];

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
};

const Fallback: React.FC = () => (
  <div className="flex items-center justify-center h-[40vh] text-slate-500">
    <span aria-live="polite">Loading…</span>
  </div>
);

const AppV2Inner: React.FC = () => {
  const [activeId, setActiveId] = useState('dashboard');
  const toast = useToast();

  const breadcrumbs = useMemo(
    () => [
      { id: 'ws', label: 'ACME' },
      { id: activeId, label: routeTitles[activeId] ?? activeId, current: true },
    ],
    [activeId],
  );

  return (
    <AppShell
      sections={sections}
      activeId={activeId}
      onNavigate={id => {
        // Only dashboard is live in the pilot — disabled items are non-clickable.
        setActiveId(id);
      }}
      workspace={{ name: 'XS-ERP', subtitle: 'v12' }}
      user={{ name: 'Felipe N.', role: 'Admin' }}
      breadcrumbs={breadcrumbs}
      onSearch={() => toast.push({
        kind: 'info',
        title: 'Command palette',
        description: 'Coming in Phase 3B — this is a scaffold.',
      })}
      primaryAction={{
        label: '+ New order',
        onClick: () => toast.push({
          kind: 'success',
          title: 'New order',
          description: 'Wiring lands with the Sales Orders port.',
        }),
      }}
    >
      <Suspense fallback={<Fallback />}>
        {activeId === 'dashboard' && <DashboardV2 />}
      </Suspense>
    </AppShell>
  );
};

const AppV2: React.FC = () => (
  <QueryProvider>
    <AuthProvider>
      <CompanyProvider>
        <ToastProvider>
          <AppV2Inner />
        </ToastProvider>
      </CompanyProvider>
    </AuthProvider>
  </QueryProvider>
);

export default AppV2;
