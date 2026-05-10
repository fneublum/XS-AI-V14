// Phase 3A — v2 TopBar. Breadcrumb + search hint + primary action.

import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Sun, Moon, Settings, Plug } from 'lucide-react';
import { Kbd } from '../primitives/Kbd';
import { Button } from '../primitives/Button';
import { useUiStore, resolveTheme } from '../state/uiStore';

export interface BreadcrumbSegment {
  id: string;
  label: string;
  current?: boolean;
}

interface TopBarProps {
  breadcrumbs: BreadcrumbSegment[];
  onSearch?: () => void;
  primaryAction?: { label: string; onClick: () => void };
  /** Quick-access gear that jumps straight to the Settings route. */
  onOpenSettings?: () => void;
  /** Quick-access plug that jumps straight to the Connections route. */
  onOpenConnections?: () => void;
  /** When provided, renders a left-edge toggle that collapses the sidebar. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const ThemeToggle: React.FC = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => useUiStore.subscribe(force), []);
  const { theme, setTheme } = useUiStore.getState();
  const effective = resolveTheme(theme);
  const next = effective === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-[#161616] transition-colors"
    >
      {effective === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
};

export const TopBar: React.FC<TopBarProps> = ({
  breadcrumbs, onSearch, primaryAction, onOpenSettings, onOpenConnections,
  sidebarCollapsed, onToggleSidebar,
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
      <ThemeToggle />
      {onOpenConnections && (
        <button
          type="button"
          onClick={onOpenConnections}
          title="Connections"
          aria-label="Connections"
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-[#161616] transition-colors"
        >
          <Plug size={15} />
        </button>
      )}
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-[#161616] transition-colors"
        >
          <Settings size={15} />
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
