// Phase 3A — v2 Sidebar. Linear/Vercel vibe.
//
// Dense, sharp, monochrome. Items grouped by section. Supports a
// collapsed mode that hides labels + section headers, leaving a
// narrow icon-strip so the main data area has more room. The mode
// is driven by the parent — localStorage persistence lives in
// AppShell so the top-bar toggle and the sidebar stay in sync.

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../primitives/utils';
import { Kbd } from '../primitives/Kbd';
import { useSystemLogo } from '../queries/useSystemLogo';

// Per-section collapsed state — persisted in localStorage so the user's
// pinned/hidden groups survive a refresh. Keyed by section.id (not
// label) since labels can be re-translated without invalidating the
// remembered state.
const SECTION_COLLAPSE_KEY = 'xs_sidebar_collapsed_sections';
function loadCollapsedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter(s => typeof s === 'string')) : new Set();
  } catch { return new Set(); }
}
function saveCollapsedSet(s: Set<string>): void {
  try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(Array.from(s))); }
  catch { /* quota / disabled — non-fatal */ }
}

export interface SidebarItem {
  id: string;
  label: string;
  hint?: string;
  count?: number;
  disabled?: boolean;
  /** Lucide icon component shown to the left of the label (and in
   *  collapsed mode in place of the single-letter glyph). */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  /** Override the default `onSelect(id)` — use for items that open a
   *  modal or jump to an external surface instead of routing. */
  onClick?: () => void;
}

export interface SidebarSection {
  id: string;
  label?: string;
  /** Optional accent color for this section's icons / active dot. */
  accent?: 'indigo' | 'emerald' | 'amber' | 'sky' | 'rose' | 'violet' | 'slate';
  /** Lucide icon shown next to the section label. */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  items: SidebarItem[];
}

const accentText: Record<NonNullable<SidebarSection['accent']>, string> = {
  indigo:  'text-indigo-300',
  emerald: 'text-emerald-300',
  amber:   'text-amber-300',
  sky:     'text-sky-300',
  rose:    'text-rose-300',
  violet:  'text-violet-300',
  slate:   'text-slate-300',
};
const accentDot: Record<NonNullable<SidebarSection['accent']>, string> = {
  indigo:  'bg-indigo-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  sky:     'bg-sky-400',
  rose:    'bg-rose-400',
  violet:  'bg-violet-400',
  slate:   'bg-slate-400',
};

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
}) => {
  const logoQuery = useSystemLogo();
  const logoSrc = logoQuery.data;
  // Per-section collapsed state. Separate from the sidebar's own
  // icon-strip `collapsed` prop — that one hides labels entirely.
  // This one just folds each group's items behind a chevron.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => loadCollapsedSet());
  useEffect(() => { saveCollapsedSet(collapsedSections); }, [collapsedSections]);
  const toggleSection = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  };

  return (
  <aside
    className={cn(
      'shrink-0 border-r border-[#1f1f1f] bg-[#0a0a0a] flex flex-col transition-[width] duration-150',
      collapsed ? 'w-12' : 'w-56',
    )}
  >
    {workspace && (
      <div className={cn(
        'h-14 flex items-center gap-2 border-b border-[#1f1f1f]',
        collapsed ? 'justify-center px-0' : 'px-3',
      )}>
        {logoSrc
          ? (
            <img
              src={logoSrc}
              alt={workspace.name}
              className={cn(
                'object-contain',
                collapsed ? 'max-h-7 max-w-[32px]' : 'max-h-9 max-w-[140px]',
              )}
            />
          )
          : (
            <div
              className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-500 shrink-0"
              aria-hidden
            />
          )
        }
        {!collapsed && workspace.subtitle && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono tabular-nums">
            {workspace.subtitle}
          </span>
        )}
      </div>
    )}

    {/* Comfortable density — items breathe without introducing a
     *  scroll on a typical viewport. Spacer between sections uses
     *  `flex-1`-free flow plus a balanced `mt-3.5` so gaps read as
     *  intentional rather than empty canvas. */}
    <nav className={cn(
      'flex-1 min-h-0 overflow-y-auto custom-scrollbar',
      collapsed ? 'px-1 py-2' : 'px-2 py-3',
    )}>
      {sections.map((section, i) => {
        const accent = section.accent ?? 'slate';
        const SectionIcon = section.icon;
        const isCollapsed = collapsedSections.has(section.id);
        return (
        <div key={section.id} className={cn(i > 0 && (collapsed ? 'mt-2 pt-2 border-t border-[#1f1f1f]' : 'mt-4'))}>
          {section.label && !collapsed && (
            // Whole header is clickable — chevron + label + icon all
            // toggle the section. Hover state on the row makes the
            // affordance obvious without needing a separate hit target.
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
              className="w-full px-2 mb-1.5 flex items-center gap-1.5 group hover:bg-[#141414] rounded-sm transition-colors py-0.5"
            >
              {SectionIcon && (
                <SectionIcon size={11} className={cn(accentText[accent], 'opacity-80 shrink-0')} />
              )}
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold group-hover:text-slate-300">
                {section.label}
              </span>
              {/* Chevron sits on the far right and rotates 90° when the
                  group is folded. `ml-auto` pushes it past the label. */}
              <span className="ml-auto text-slate-600 group-hover:text-slate-300">
                {isCollapsed
                  ? <ChevronRight size={11} />
                  : <ChevronDown size={11} />}
              </span>
            </button>
          )}
          {/* Items list — hidden when the section is collapsed (and
              the sidebar isn't in icon-strip mode, since the icon
              strip ignores the per-section state). */}
          <ul className={cn(
            'space-y-0.5',
            isCollapsed && !collapsed && 'hidden',
          )}>
            {section.items.map(item => {
              const active = item.id === activeId;
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.disabled) return;
                      if (item.onClick) item.onClick();
                      else onSelect(item.id);
                    }}
                    disabled={item.disabled}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'w-full text-left transition-colors rounded-md group',
                      collapsed
                        ? 'flex items-center justify-center h-8'
                        : 'flex items-center justify-between gap-2 px-2 py-1.5 text-[13px]',
                      active
                        ? 'bg-[#161616] text-slate-100'
                        : 'text-slate-400 hover:bg-[#141414] hover:text-slate-100',
                      item.disabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    {collapsed ? (
                      Icon ? (
                        <Icon size={15} className={cn(active ? accentText[accent] : 'text-slate-500 group-hover:text-slate-200')} />
                      ) : (
                        <span className={cn(
                          'font-semibold text-[11px] tracking-wider',
                          active ? accentText[accent] : 'text-slate-500',
                        )}>
                          {glyph(item.label)}
                        </span>
                      )
                    ) : (
                      <>
                        <span className="flex items-center gap-2 truncate">
                          {Icon ? (
                            <Icon
                              size={14}
                              className={cn(
                                'shrink-0 transition-colors',
                                active ? accentText[accent] : 'text-slate-500 group-hover:text-slate-200',
                              )}
                            />
                          ) : (
                            <span
                              className={cn(
                                'w-1 h-1 rounded-full transition-colors',
                                active ? accentDot[accent] : 'bg-slate-600',
                              )}
                              aria-hidden
                            />
                          )}
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
        );
      })}
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
};
