// Phase 3A — v2 AppShell. Sidebar + TopBar + main content layout.
//
// Owns the sidebar-collapsed state and persists it across reloads.
// Collapse shrinks the sidebar to a 48px icon strip, giving the data
// view an extra ~160px of horizontal room — useful when editing wide
// tables like invoices or POs with many columns.

import React, { useState, useCallback } from 'react';
import { Sidebar, SidebarSection } from './Sidebar';
import { TopBar, BreadcrumbSegment } from './TopBar';
import { shouldMountAgentV2 } from '../services/featureFlags';
import { AgentPanel } from '../components/AgentPanel';

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
  /** Quick-access gear shown in the TopBar — jumps to Settings. */
  onOpenSettings?: () => void;
  /** Quick-access plug shown in the TopBar — jumps to Connections. */
  onOpenConnections?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  sections, activeId, onNavigate, workspace, user, sidebarFooter,
  breadcrumbs, onSearch, primaryAction, onOpenSettings, onOpenConnections,
  children,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [agentOpen, setAgentOpen] = useState(false);
  const agentEnabled = shouldMountAgentV2();

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="h-screen bg-[#0a0a0a] text-slate-200 flex font-sans antialiased [color-scheme:dark]">
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
          onOpenSettings={onOpenSettings}
          onOpenConnections={onOpenConnections}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggle}
        />
        {/* pb-6 reserves a slim gutter for the ultra-compact Dock
         *  pinned to the viewport bottom (h-5 cells ≈ 20px + border),
         *  so table rows and chat inputs don't slide under it. */}
        <main className="flex-1 overflow-auto p-6 pb-6">
          {children}
        </main>
      </div>
      {agentEnabled && (
        <>
          <button
            onClick={() => setAgentOpen(v => !v)}
            className="fixed bottom-4 right-4 z-30 h-11 w-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_4px_12px_rgba(79,70,229,0.4)] flex items-center justify-center text-lg font-semibold"
            title="Open XS Agent"
            aria-label="Open XS Agent"
          >✦</button>
          <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
        </>
      )}
    </div>
  );
};
