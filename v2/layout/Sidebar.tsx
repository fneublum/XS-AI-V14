// Phase 3A — v2 Sidebar. Linear/Vercel vibe.
//
// Dense, sharp, monochrome. Items grouped by section. Supports a
// collapsed mode that hides labels + section headers, leaving a
// narrow icon-strip so the main data area has more room. The mode
// is driven by the parent — localStorage persistence lives in
// AppShell so the top-bar toggle and the sidebar stay in sync.

import React from 'react';
import { cn } from '../primitives/utils';
import { Kbd } from '../primitives/Kbd';

export interface SidebarItem {
  id: string;
  label: string;
  hint?: string;
  count?: number;
  disabled?: boolean;
}

export interface SidebarSection {
  id: string;
  label?: string;
  items: SidebarItem[];
}

interface SidebarProps {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  workspace?: { name: string; subtitle?: string };
  user?: { name: string; role?: string };
  footer?: React.ReactNode;
  collapsed?: boolean;
}

// Single letter glyph used in collapsed mode — first alpha char of
// the label, so "Sales Orders" → "S", "P&L" → "P".
const glyph = (label: string): string => {
  const ch = label.match(/[A-Za-z]/);
  return ch ? ch[0].toUpperCase() : label.slice(0, 1).toUpperCase();
};

export const Sidebar: React.FC<SidebarProps> = ({
  sections, activeId, onSelect, workspace, user, footer, collapsed,
}) => (
  <aside
    className={cn(
      'shrink-0 border-r border-[#1f1f1f] bg-[#0a0a0a] flex flex-col transition-[width] duration-150',
      collapsed ? 'w-12' : 'w-56',
    )}
  >
    {workspace && (
      <div className={cn(
        'h-14 flex items-center gap-2 border-b border-[#1f1f1f]',
        collapsed ? 'justify-center px-0' : 'px-4',
      )}>
        <div
          className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-500"
          aria-hidden
        />
        {!collapsed && (
          <>
            <span className="text-[13px] font-semibold tracking-tight text-slate-100">
              {workspace.name}
            </span>
            {workspace.subtitle && (
              <span className="ml-auto text-[10px] text-slate-600 font-mono tabular-nums">
                {workspace.subtitle}
              </span>
            )}
          </>
        )}
      </div>
    )}

    <nav className={cn(
      'flex-1 overflow-y-auto',
      collapsed ? 'px-1 py-2' : 'px-2 py-3',
    )}>
      {sections.map((section, i) => (
        <div key={section.id} className={cn(i > 0 && (collapsed ? 'mt-2 pt-2 border-t border-[#1f1f1f]' : 'mt-4'))}>
          {section.label && !collapsed && (
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
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'w-full text-left transition-colors rounded-md',
                      collapsed
                        ? 'flex items-center justify-center h-8 text-[11px]'
                        : 'flex items-center justify-between gap-2 px-2 py-1.5 text-[13px]',
                      active
                        ? 'bg-[#161616] text-slate-100'
                        : 'text-slate-400 hover:bg-[#141414] hover:text-slate-100',
                      item.disabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    {collapsed ? (
                      <span className={cn(
                        'font-semibold text-[11px] tracking-wider',
                        active ? 'text-indigo-300' : 'text-slate-500',
                      )}>
                        {glyph(item.label)}
                      </span>
                    ) : (
                      <>
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
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>

    {!collapsed && (footer
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
      ))}
  </aside>
);
