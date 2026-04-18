// Phase 3A — v2 AppShell. Sidebar + TopBar + main content layout.
//
// Owns the sidebar-collapsed state and persists it across reloads.
// Collapse shrinks the sidebar to a 48px icon strip, giving the data
// view an extra ~160px of horizontal room — useful when editing wide
// tables like invoices or POs with many columns.

import React, { useState, useCallback } from 'react';
import { Sidebar, SidebarSection } from './Sidebar';
import { TopBar, BreadcrumbSegment } from './TopBar';

const STORAGE_KEY = 'xs_v2_sidebar_collapsed';

const readCollapsed = (): boolean => {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
};

const writeCollapsed = (v: boolean) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); }
  catch { /* noop */ }
};

interface AppShellProps {
  sections: SidebarSection[];
  activeId: string;
  onNavigate: (id: string) => void;
  workspace?: { name: string; subtitle?: string };
  user?: { name: string; role?: string };
  sidebarFooter?: React.ReactNode;
  breadcrumbs: BreadcrumbSegment[];
  onSearch?: () => void;
  primaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  sections, activeId, onNavigate, workspace, user, sidebarFooter,
  breadcrumbs, onSearch, primaryAction, children,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200 flex font-sans antialiased [color-scheme:dark]">
      <Sidebar
        sections={sections}
        activeId={activeId}
        onSelect={onNavigate}
        workspace={workspace}
        user={user}
        footer={sidebarFooter}
        collapsed={collapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          breadcrumbs={breadcrumbs}
          onSearch={onSearch}
          primaryAction={primaryAction}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggle}
        />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
};
