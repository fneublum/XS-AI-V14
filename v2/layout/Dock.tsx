// v2 Dock — modern reinterpretation of v1's [components/Dock.tsx](../../components/Dock.tsx).
//
// Bottom-center floating glass pill with:
//   • Drag-to-reorder
//   • + button opens a searchable grid picker
//   • × on hover-remove
//   • Active-route pip + subtle scale on hover
//   • Spacers for visual grouping
//   • Per-user localStorage persistence
//
// Routes through the global `xs-v2-navigate` CustomEvent bus so the
// dock stays decoupled from AppV2's navigate callback.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Plug, Sparkles, ShoppingCart, ClipboardList, FileStack,
  Receipt, TrendingUp, DollarSign, Award, UserCog, Ship, CalendarCheck,
  FileText, Users, Factory, Package, Warehouse, Target, Truck, Box,
  FileSearch, CreditCard, Wallet, PieChart, BarChart3, Calculator,
  CircuitBoard, Upload, Mail, Plane, Bot, Settings, Building2, User,
  Plus, X, Search, Minus, Inbox, Building,
} from 'lucide-react';
import { cn } from '../primitives/utils';

// ─── Catalog ──────────────────────────────────────────────────────

export interface DockEntry {
  id: string;                  // v2 route id OR 'SPACER_*'
  label: string;
  icon: React.ElementType;
  color?: 'indigo' | 'rose' | 'emerald' | 'amber' | 'sky' | 'violet';
  isSpacer?: boolean;
}

const CATALOG: DockEntry[] = [
  { id: 'dashboard',        label: 'Dashboard',         icon: LayoutDashboard, color: 'indigo' },
  { id: 'connections-hub',  label: 'Connections',       icon: Plug,            color: 'rose' },
  { id: 'ai-sales',         label: 'AI Sales Agent',    icon: Sparkles,        color: 'violet' },
  { id: 'ai-dashboard',     label: 'AI Dashboard',      icon: CircuitBoard,    color: 'sky' },
  { id: 'ai-upload',        label: 'AI Upload',         icon: Upload,          color: 'indigo' },
  { id: 'ai-email',         label: 'AI Email',          icon: Mail },
  { id: 'ai-logistics',     label: 'AI Logistics',      icon: Plane,           color: 'sky' },
  { id: 'email-agent',      label: 'Email Agent',       icon: Bot },

  // Trading
  { id: 'purchase-orders',  label: 'Purchase & Cost',   icon: ShoppingCart },
  { id: 'sales-orders',     label: 'Sales Orders',      icon: ClipboardList,   color: 'indigo' },
  { id: 'pl-invoice',       label: 'PL & Invoice',      icon: FileStack,       color: 'emerald' },
  { id: 'invoices',         label: 'Invoices',          icon: Receipt,         color: 'emerald' },
  { id: 'trading-followup', label: 'Trading Follow Up', icon: TrendingUp,      color: 'amber' },

  // Agent Sales
  { id: 'sopici',           label: 'Agent Sales',       icon: DollarSign,      color: 'amber' },
  { id: 'agent-followup',   label: 'Agent Follow Up',   icon: UserCog,         color: 'amber' },

  // Logistics
  { id: 'freight-quotes',   label: 'Freight Quotes',    icon: Ship,            color: 'sky' },
  { id: 'bookings',         label: 'Bookings',          icon: CalendarCheck,   color: 'sky' },
  { id: 'bol',              label: 'Bill of Ladings',   icon: FileText },
  { id: 'shipments',        label: 'Shipments',         icon: Truck,           color: 'sky' },
  { id: 'packing-lists',    label: 'Packing Lists',     icon: Box },
  { id: 'logistics-docs',   label: 'Logistics Docs',    icon: FileSearch },

  // Finance
  { id: 'payables',         label: 'Payables',          icon: Receipt },
  { id: 'receivables',      label: 'Receivables',       icon: Wallet,          color: 'emerald' },
  { id: 'customer-balances',label: 'Customer Balances', icon: PieChart },
  { id: 'pl',               label: 'P&L',               icon: BarChart3,       color: 'emerald' },
  { id: 'cost-profit',      label: 'Cost / Profit',     icon: Calculator },

  // Data
  { id: 'customers',        label: 'Customers',         icon: Users },
  { id: 'suppliers',        label: 'Suppliers',         icon: Factory },
  { id: 'products',         label: 'Products',          icon: Package },
  { id: 'inventory',        label: 'Inventory',         icon: Warehouse },
  { id: 'opportunities',    label: 'Opportunities',     icon: Target,          color: 'rose' },
  { id: 'payment-terms',    label: 'Payment Terms',     icon: CreditCard },

  // Admin
  { id: 'users',            label: 'Users',             icon: User },
  { id: 'companies',        label: 'Companies',         icon: Building2 },
  { id: 'connections',      label: 'Integrations',      icon: Inbox },
  { id: 'settings',         label: 'Settings',          icon: Settings },
];

const SPACER: DockEntry = { id: 'SPACER', label: 'Spacer', icon: Minus, isSpacer: true };

const DEFAULT_IDS = ['dashboard', 'SPACER', 'sales-orders', 'bookings', 'invoices', 'SPACER', 'connections-hub'];

// ─── Color tokens ─────────────────────────────────────────────────
//
// Monochrome: every entry renders with the same neutral slate/white
// palette regardless of the per-entry `color` tag. The tag is still
// respected elsewhere (e.g. the Add-to-dock menu sorting) but does not
// drive the Dock chrome itself — the bar stays visually quiet.

// `text-white/80` idle + pure `text-white` active gives every icon a
// uniform white tone with a faint dim on unselected entries so the
// active one still reads as "current". No tinted colors (indigo,
// emerald, etc.) anywhere in the dock chrome.
const MONO_PALETTE = { idle: 'text-white/80', active: 'text-white bg-[#1f1f1f]' };
const COLOR: Record<NonNullable<DockEntry['color']>, { idle: string; active: string }> = {
  indigo:  MONO_PALETTE,
  rose:    MONO_PALETTE,
  emerald: MONO_PALETTE,
  amber:   MONO_PALETTE,
  sky:     MONO_PALETTE,
  violet:  MONO_PALETTE,
};
const COLOR_NEUTRAL = MONO_PALETTE;

// ─── Storage ──────────────────────────────────────────────────────

const storageKey = (userId?: string) => `xs_v2_dock_${userId ?? 'guest'}`;

function loadIds(userId?: string): string[] {
  if (typeof window === 'undefined') return DEFAULT_IDS;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_IDS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* noop */ }
  return DEFAULT_IDS;
}

function saveIds(userId: string | undefined, ids: string[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(ids)); } catch { /* noop */ }
}

// ─── Resolve ids → entries ────────────────────────────────────────

function resolve(ids: string[]): DockEntry[] {
  return ids
    .map((id, i) => {
      if (id === 'SPACER' || id.startsWith('SPACER_')) {
        return { ...SPACER, id: `SPACER_${i}` };
      }
      return CATALOG.find(c => c.id === id);
    })
    .filter(Boolean) as DockEntry[];
}

// ─── Component ────────────────────────────────────────────────────

interface DockProps {
  activeId: string;
  userId?: string;
}

export const Dock: React.FC<DockProps> = ({ activeId, userId }) => {
  const [ids, setIds] = useState<string[]>(() => loadIds(userId));
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setIds(loadIds(userId)); }, [userId]);

  const entries = useMemo(() => resolve(ids), [ids]);

  const go = (id: string) => {
    if (!id || id.startsWith('SPACER')) return;
    window.dispatchEvent(new CustomEvent('xs-v2-navigate', { detail: { id } }));
  };

  const persist = (next: string[]) => {
    setIds(next);
    saveIds(userId, next);
  };

  const addEntry = (id: string) => {
    if (id === 'SPACER') return persist([...ids, 'SPACER']);
    if (ids.includes(id)) return;
    persist([...ids, id]);
    setMenuOpen(false);
    setSearch('');
  };

  const removeAt = (idx: number) => {
    persist(ids.filter((_, i) => i !== idx));
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedId == null) return;
    const fromIdx = entries.findIndex(x => x.id === draggedId);
    if (fromIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(dropIdx, 0, moved);
    persist(next);
    setDraggedId(null);
  };

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    const used = new Set(ids.filter(x => x !== 'SPACER' && !x.startsWith('SPACER_')));
    return CATALOG.filter(c => !used.has(c.id) && (q === '' || c.label.toLowerCase().includes(q)));
  }, [ids, search]);

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (menuBtnRef.current?.contains(e.target)) return;
      // Popover sits above the button — leave alone if clicking inside it.
      const popover = document.getElementById('xs-v2-dock-menu');
      if (popover?.contains(e.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    // Pinned to the very bottom of the viewport — no gap. Ultra-compact
    // bar (cells ~50% of the prior h-9 footprint) so it stays
    // unobtrusive; rounded only at the top so it reads as a bottom bar.
    <div className="fixed left-1/2 -translate-x-1/2 bottom-0 z-40 pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-0.5 px-1.5 py-0 rounded-t-lg',
          'bg-[#0f0f0f]/90 backdrop-blur-xl border border-b-0 border-[#1f1f1f] shadow-2xl',
        )}
      >
        {entries.map((e, i) => {
          const isActive = e.id === activeId || e.id.split('_')[0] === activeId;
          const palette = e.color ? COLOR[e.color] : COLOR_NEUTRAL;

          if (e.isSpacer) {
            return (
              <div
                key={e.id}
                draggable
                onDragStart={ev => onDragStart(ev, e.id)}
                onDragOver={onDragOver}
                onDrop={ev => onDrop(ev, i)}
                className="relative group w-2.5 h-4 flex items-center justify-center cursor-move"
                title="Spacer (drag to reorder · click × to remove)"
              >
                <span className="w-1 h-1 rounded-full bg-white opacity-40 group-hover:opacity-100" />
                <button
                  onClick={() => removeAt(i)}
                  className="absolute -top-1 -right-0.5 p-0.5 rounded-full bg-[#1a1a1a] text-white/60 opacity-0 group-hover:opacity-100 hover:text-white transition"
                  title="Remove spacer"
                >
                  <X size={8} />
                </button>
              </div>
            );
          }

          const Icon = e.icon;
          return (
            <div
              key={e.id}
              draggable
              onDragStart={ev => onDragStart(ev, e.id)}
              onDragOver={onDragOver}
              onDrop={ev => onDrop(ev, i)}
              className={cn(
                'relative group transition-transform',
                draggedId === e.id ? 'opacity-30' : 'opacity-100',
              )}
            >
              <button
                onClick={() => go(e.id)}
                className={cn(
                  'flex items-center justify-center w-5 h-5 rounded-md transition-all',
                  isActive
                    ? `${palette.active} shadow-sm scale-105`
                    : `${palette.idle} hover:bg-[#1a1a1a] hover:scale-110`,
                )}
                title={e.label}
              >
                <Icon size={12} strokeWidth={1.8} />
              </button>
              {isActive && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current opacity-70" aria-hidden />
              )}
              <button
                onClick={() => removeAt(i)}
                className="absolute -top-1 -right-1 p-0.5 rounded-full bg-[#1a1a1a] text-white/60 opacity-0 group-hover:opacity-100 hover:text-white transition"
                title={`Remove ${e.label} from dock`}
              >
                <X size={9} />
              </button>
            </div>
          );
        })}

        {/* Separator */}
        <div className="w-px h-3 bg-white/20 mx-0.5" aria-hidden />

        {/* + add */}
        <div className="relative">
          <button
            ref={menuBtnRef}
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center justify-center w-5 h-5 rounded-md text-white/80 hover:text-white hover:bg-[#1a1a1a] transition-all hover:scale-110"
            title="Add app to dock"
          >
            <Plus size={12} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div
              id="xs-v2-dock-menu"
              className={cn(
                'absolute bottom-full right-0 mb-3 w-[320px] rounded-xl',
                'bg-[#0f0f0f]/95 backdrop-blur-xl border border-[#1f1f1f] shadow-2xl p-3',
              )}
            >
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2.5 top-2 text-slate-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                  placeholder="Search apps…"
                  className="w-full h-7 pl-7 pr-2 text-[12px] rounded-md bg-[#111111] border border-[#1f1f1f] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 outline-none"
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-0.5">
                <button
                  onClick={() => addEntry('SPACER')}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg border border-dashed border-[#2a2a2a] text-slate-500 hover:text-slate-200 hover:bg-[#141414]"
                  title="Add spacer"
                >
                  <Minus size={14} />
                  <span className="text-[9.5px] leading-tight">Spacer</span>
                </button>
                {available.map(c => {
                  const CI = c.icon;
                  const palette = c.color ? COLOR[c.color] : COLOR_NEUTRAL;
                  return (
                    <button
                      key={c.id}
                      onClick={() => addEntry(c.id)}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg border border-transparent hover:border-[#2a2a2a] hover:bg-[#141414] text-slate-300"
                      title={c.label}
                    >
                      <div className={cn('p-1 rounded-md', palette.idle)}>
                        <CI size={14} />
                      </div>
                      <span className="text-[9.5px] leading-tight text-white line-clamp-2 text-center">
                        {c.label}
                      </span>
                    </button>
                  );
                })}
                {available.length === 0 && search && (
                  <div className="col-span-4 text-center py-3 text-[11px] text-slate-600">No matches.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
