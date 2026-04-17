// Phase 3A — v2 Sidebar. Linear/Vercel vibe.
//
// Dense, sharp, monochrome. Items grouped by section (Workspace / Finance /
// Admin). Active item gets a subtle filled row, hover gets a slightly
// lighter panel. Trailing slot for keyboard hints or counts.

import React from 'react';
import { cn } from '../primitives/utils';
import { Kbd } from '../primitives/Kbd';

export interface SidebarItem {
  id: string;
  label: string;
  hint?: string;      // e.g. keyboard shortcut "D"
  count?: number;     // e.g. 7 active orders
  disabled?: boolean;
}

export interface SidebarSection {
  id: string;
  label?: string;     // uppercase section header; omit for ungrouped items
  items: SidebarItem[];
}

interface SidebarProps {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  workspace?: { name: string; subtitle?: string };
  user?: { name: string; role?: string };
  /** Custom footer — overrides the built-in user tile when provided. */
  footer?: React.ReactNode;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections, activeId, onSelect, workspace, user, footer,
}) => (
  <aside className="w-56 shrink-0 border-r border-[#1f1f1f] bg-[#0a0a0a] flex flex-col">
    {workspace && (
      <div className="h-14 px-4 flex items-center gap-2 border-b border-[#1f1f1f]">
        <div
          className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-500"
          aria-hidden
        />
        <span className="text-[13px] font-semibold tracking-tight text-slate-100">
          {workspace.name}
        </span>
        {workspace.subtitle && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono tabular-nums">
            {workspace.subtitle}
          </span>
        )}
      </div>
    )}

    <nav className="flex-1 px-2 py-3 overflow-y-auto">
      {sections.map((section, i) => (
        <div key={section.id} className={cn(i > 0 && 'mt-4')}>
          {section.label && (
            <div className="px-2 text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-1.5">
              {section.label}
            </div>
          )}
          <ul className="space-y-px">
            {section.items.map(item => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => !item.disabled && onSelect(item.id)}
                    disabled={item.disabled}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors',
                      active
                        ? 'bg-[#161616] text-slate-100'
                        : 'text-slate-400 hover:bg-[#141414] hover:text-slate-100',
                      item.disabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className={cn(
                          'w-1 h-1 rounded-full transition-colors',
                          active ? 'bg-indigo-400' : 'bg-slate-600',
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.hint && <Kbd>{item.hint}</Kbd>}
                    {item.count !== undefined && (
                      <span className="font-mono tabular-nums text-[10px] text-slate-600">
                        {item.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>

    {footer
      ? <div className="border-t border-[#1f1f1f] p-2">{footer}</div>
      : user && (
        <div className="border-t border-[#1f1f1f] p-3 flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500"
            aria-hidden
          />
          <div className="text-[12px] leading-tight min-w-0">
            <div className="text-slate-100 truncate">{user.name}</div>
            {user.role && <div className="text-[10px] text-slate-500 truncate">{user.role}</div>}
          </div>
        </div>
      )}
  </aside>
);
