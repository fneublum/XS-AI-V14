// Phase 3A — v2 AppShell. Sidebar + TopBar + main content layout.
//
// Owns the v2 dark theme as its root. All v2 routes render inside this
// shell; v1's App.tsx is not involved when ?v2=1 is set.

import React from 'react';
import { Sidebar, SidebarSection } from './Sidebar';
import { TopBar, BreadcrumbSegment } from './TopBar';

interface AppShellProps {
  sections: SidebarSection[];
  activeId: string;
  onNavigate: (id: string) => void;
  workspace?: { name: string; subtitle?: string };
  user?: { name: string; role?: string };
  breadcrumbs: BreadcrumbSegment[];
  onSearch?: () => void;
  primaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  sections, activeId, onNavigate, workspace, user,
  breadcrumbs, onSearch, primaryAction, children,
}) => (
  <div className="min-h-screen bg-[#0a0a0a] text-slate-200 flex font-sans antialiased [color-scheme:dark]">
    <Sidebar
      sections={sections}
      activeId={activeId}
      onSelect={onNavigate}
      workspace={workspace}
      user={user}
    />
    <div className="flex-1 flex flex-col min-w-0">
      <TopBar
        breadcrumbs={breadcrumbs}
        onSearch={onSearch}
        primaryAction={primaryAction}
      />
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  </div>
);
