// v2 Agent Queue — 2-tab page.
//
//   Review        → AiInboxV2       (corrections, drafts, OCR-saved, ...)
//   Agent Tasks   → AgentTasksV2    (unified feed of HERMES activity)
//
// WhatsApp + Briefing tabs were dropped in v14.17 — HERMES owns those.
// Tab state is persisted to sessionStorage.

import React, { useEffect, useState } from 'react';
import { Inbox, Sparkles } from 'lucide-react';
import { cn } from '../primitives/utils';
import AiInboxV2 from './AiInboxV2';
import AgentTasksV2 from './AgentTasksV2';

type TabId = 'email' | 'tasks';
const STORAGE_KEY = 'xs_v2_connections_tab';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType; color: string }> = [
  { id: 'email', label: 'Email',       icon: Inbox,    color: 'text-indigo-300' },
  { id: 'tasks', label: 'Agent Tasks', icon: Sparkles, color: 'text-emerald-300' },
];

const readStoredTab = (): TabId => {
  if (typeof window === 'undefined') return 'email';
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'email' || v === 'tasks') return v;
    // Legacy values from earlier versions
    if (v === 'review') return 'email';
  } catch { /* noop */ }
  return 'email';
};

const ConnectionsTabsV2: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>(readStoredTab);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, activeTab); } catch { /* noop */ }
  }, [activeTab]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-0 border-b border-[#1f1f1f] mb-3">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-[13px] font-medium border-b-2 transition-all',
                active
                  ? 'border-indigo-500 text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-200 hover:border-[#2a2a2a]',
              )}
            >
              <Icon size={14} className={active ? t.color : ''} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div className="flex-1 min-h-0">
        {activeTab === 'email' && <AiInboxV2 />}
        {activeTab === 'tasks' && <AgentTasksV2 />}
      </div>
    </div>
  );
};

export default ConnectionsTabsV2;
