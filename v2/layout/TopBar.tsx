// Phase 3A — v2 TopBar. Breadcrumb + search hint + primary action.

import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Kbd } from '../primitives/Kbd';
import { Button } from '../primitives/Button';

export interface BreadcrumbSegment {
  id: string;
  label: string;
  current?: boolean;
}

interface TopBarProps {
  breadcrumbs: BreadcrumbSegment[];
  onSearch?: () => void;
  primaryAction?: { label: string; onClick: () => void };
  /** When provided, renders a left-edge toggle that collapses the sidebar. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  breadcrumbs, onSearch, primaryAction, sidebarCollapsed, onToggleSidebar,
}) => (
  <header className="h-14 flex items-center px-4 gap-3 border-b border-[#1f1f1f] bg-[#0a0a0a]">
    {onToggleSidebar && (
      <button
        type="button"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-[#161616] transition-colors"
      >
        {sidebarCollapsed
          ? <PanelLeftOpen size={15} />
          : <PanelLeftClose size={15} />}
      </button>
    )}

    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] min-w-0">
      {breadcrumbs.map((crumb, i) => (
        <React.Fragment key={crumb.id}>
          {i > 0 && <span className="text-slate-600" aria-hidden>/</span>}
          <span
            className={crumb.current ? 'text-slate-100 truncate' : 'text-slate-400 truncate'}
            aria-current={crumb.current ? 'page' : undefined}
          >
            {crumb.label}
          </span>
        </React.Fragment>
      ))}
    </nav>

    <div className="ml-auto flex items-center gap-3">
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2 px-2.5 py-1 bg-[#111111] border border-[#1f1f1f] rounded-md text-[12px] text-slate-500 hover:text-slate-300 hover:border-[#2a2a2a] transition-colors"
        >
          <span>Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      )}
      {primaryAction && (
        <Button
          size="sm"
          onClick={primaryAction.onClick}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
        >
          {primaryAction.label}
        </Button>
      )}
    </div>
  </header>
);
