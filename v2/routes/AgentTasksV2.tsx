// Agent Tasks tab — unified feed of every record HERMES agents touched
// across the ERP. Rendered as the second tab of the Agent Queue.
//
// Data: useAgentTasks (joins bookings + invoices + packing_lists +
// bill_landings + bl_audits, sorted by recency).
//
// Click a row to open the underlying record in its native editor/drawer
// when one exists. Otherwise the title is informational only.

import React, { useMemo, useState } from 'react';
import {
  Sparkles, Package, FileText, FileStack, Anchor, Wrench, Send, AlertCircle,
} from 'lucide-react';
import { useAgentTasks, type AgentTaskKind } from '../queries/useAgentTasks';
import { cn } from '../primitives/utils';
import { useEditor } from '../providers/EditorProvider';

// ─── Kind → icon + label mapping ─────────────────────────────────────────────

const KIND_META: Record<AgentTaskKind, { label: string; icon: React.ElementType; tone: string }> = {
  booking_ingested:      { label: 'Booking saved',       icon: Package,    tone: 'text-indigo-300 bg-indigo-500/10  border-indigo-500/30' },
  invoice_ingested:      { label: 'Invoice saved',       icon: FileText,   tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  packing_list_ingested: { label: 'Packing list saved',  icon: FileStack,  tone: 'text-violet-300 bg-violet-500/10  border-violet-500/30' },
  bl_ingested:           { label: 'BL saved',            icon: Anchor,     tone: 'text-sky-300 bg-sky-500/10        border-sky-500/30' },
  bl_audited:            { label: 'BL audited',          icon: AlertCircle,tone: 'text-amber-300 bg-amber-500/10    border-amber-500/30' },
  correction_applied:    { label: 'Correction applied',  icon: Wrench,     tone: 'text-rose-300 bg-rose-500/10      border-rose-500/30' },
  correction_emailed:    { label: 'Correction emailed',  icon: Send,       tone: 'text-orange-300 bg-orange-500/10  border-orange-500/30' },
};

const ALL_FILTERS: Array<{ id: 'all' | AgentTaskKind; label: string }> = [
  { id: 'all',                   label: 'All' },
  { id: 'booking_ingested',      label: 'Bookings' },
  { id: 'invoice_ingested',      label: 'Invoices' },
  { id: 'packing_list_ingested', label: 'Packing lists' },
  { id: 'bl_ingested',           label: 'BLs' },
  { id: 'bl_audited',            label: 'Audits' },
  { id: 'correction_applied',    label: 'Corrections' },
];

// ─── Relative-time helper ────────────────────────────────────────────────────
function relative(ts: string): string {
  const t = new Date(ts).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString();
}

// ─── Component ───────────────────────────────────────────────────────────────

const AgentTasksV2: React.FC = () => {
  const { data: tasks, isLoading, error, refetch } = useAgentTasks(80);
  const editor = useEditor();
  const [activeFilter, setActiveFilter] = useState<'all' | AgentTaskKind>('all');

  const filtered = useMemo(
    () => (tasks ?? []).filter(t => activeFilter === 'all' || t.kind === activeFilter),
    [tasks, activeFilter],
  );

  // Counters for filter chips
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks ?? []) c[t.kind] = (c[t.kind] ?? 0) + 1;
    c.all = (tasks ?? []).length;
    return c;
  }, [tasks]);

  const handleOpen = (taskId: string, table: string, entityId: string) => {
    // Best-effort — only Invoice has a global drawer wired today.
    if (table === 'invoices' && editor?.openInvoice) {
      editor.openInvoice(entityId);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Filter chips */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-3 overflow-x-auto custom-scrollbar">
        <Sparkles size={14} className="text-indigo-300 shrink-0" />
        <span className="text-[12px] uppercase tracking-widest text-slate-500 mr-2 shrink-0">Agent activity</span>
        {ALL_FILTERS.map(f => {
          const n = counts[f.id] ?? 0;
          const active = activeFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-full text-[12px] border transition-colors',
                active
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-slate-100'
                  : 'border-[#1f1f1f] text-slate-400 hover:text-slate-200 hover:border-[#2a2a2a]',
              )}
            >
              {f.label}
              {n > 0 && <span className="ml-1.5 text-slate-500">{n}</span>}
            </button>
          );
        })}
        <button
          onClick={() => refetch()}
          className="ml-auto shrink-0 px-2 py-1 text-[11.5px] text-slate-500 hover:text-slate-300"
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      {/* Compact feed — 1 row per record */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
        {isLoading && (
          <div className="p-6 text-center text-[13px] text-slate-500">Loading agent activity…</div>
        )}
        {error && (
          <div className="p-6 text-center text-[13px] text-rose-400">
            Could not load activity: {String(error.message ?? error)}
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="p-6 text-center text-[13px] text-slate-500">
            No agent activity yet for this filter.
          </div>
        )}

        <ul className="divide-y divide-[#1a1a1a]">
          {filtered.map(t => {
            const meta = KIND_META[t.kind];
            const Icon = meta.icon;
            const clickable = t.entityTable === 'invoices';
            return (
              <li
                key={t.id}
                onClick={clickable ? () => handleOpen(t.id, t.entityTable, t.entityId) : undefined}
                className={cn(
                  'px-3 py-1.5 flex items-center gap-2.5 text-[12.5px] transition-colors',
                  clickable && 'hover:bg-[#161616] cursor-pointer',
                )}
              >
                {/* Kind icon */}
                <span className={cn('w-5 h-5 rounded border flex items-center justify-center shrink-0', meta.tone)}>
                  <Icon size={11} />
                </span>

                {/* Time */}
                <span className="text-[11.5px] text-slate-500 w-[60px] shrink-0 tabular-nums">
                  {relative(t.timestamp)}
                </span>

                {/* Agent */}
                <span className="text-[11.5px] text-slate-300 w-[58px] shrink-0">
                  🤖 {t.agent}
                </span>

                {/* Action */}
                <span className="text-[11.5px] text-slate-500 w-[110px] shrink-0">
                  {meta.label}
                </span>

                {/* Entity title */}
                <span className="text-slate-100 font-medium shrink-0 max-w-[160px] truncate">
                  {t.title}
                </span>

                {/* Subtitle (fills remaining) */}
                {t.subtitle && (
                  <span className="text-slate-400 truncate min-w-0 flex-1">· {t.subtitle}</span>
                )}

                {/* Status badge */}
                {t.status && (
                  <span className="text-[10.5px] uppercase tracking-wider text-slate-500 px-1.5 py-0.5 rounded border border-[#2a2a2a] bg-[#0a0a0a] shrink-0">
                    {t.status}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default AgentTasksV2;
