// v2 Connections — 3-tab page replacing the v1 ConnectionsHub embed.
//
//   Email    → <AiInboxV2 />           (native, autonomous processor)
//   WhatsApp → v1 WhatsAppPanel        (extracted + exported from ConnectionsHub.tsx,
//                                       mounted under `v2-dark-scope` so its light
//                                       Tailwind classes play well in v2 dark mode)
//   Briefing → v1 EmailBriefing        (lazy-loaded)
//
// Tab state is owned here and persisted to sessionStorage so the same
// sub-tab is restored when the user returns from another route.

import React, { Suspense, useEffect, useState } from 'react';
import { Mail, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '../primitives/utils';
import AiInboxV2 from './AiInboxV2';
import { useCompany } from '../providers/CompanyProvider';
import { useAuth } from '../providers/AuthProvider';

// v1 bridges — lazy-loaded so Email is the only tab that shows
// immediately (saves the initial paint). The dark-scope wrapper
// re-maps v1 light classes into the v2 palette; a light-mode user
// gets v1's native light styling automatically.
const EmailBriefing = React.lazy(() => import('../../pages/EmailBriefing'));
const WhatsAppPanelLazy = React.lazy(async () => {
  const mod = await import('../../pages/ConnectionsHub');
  return { default: (mod as any).WhatsAppPanel };
});

type TabId = 'email' | 'whatsapp' | 'briefing';
const STORAGE_KEY = 'xs_v2_connections_tab';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType; color: string }> = [
  { id: 'email',    label: 'Email',    icon: Mail,          color: 'text-indigo-300' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'text-emerald-300' },
  { id: 'briefing', label: 'Briefing', icon: Sparkles,      color: 'text-violet-300' },
];

const readStoredTab = (): TabId => {
  if (typeof window === 'undefined') return 'email';
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'email' || v === 'whatsapp' || v === 'briefing') return v;
  } catch { /* noop */ }
  return 'email';
};

const Fallback: React.FC = () => (
  <div className="h-full flex items-center justify-center text-[13px] text-slate-500">
    Loading…
  </div>
);

const ConnectionsTabsV2: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>(readStoredTab);
  const { currentCompanyId } = useCompany();
  const { user } = useAuth();

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
                  ? `border-indigo-500 text-slate-100`
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
        {activeTab === 'whatsapp' && (
          // `v2-dark-scope` re-styles v1's light-mode classes under
          // the v2 dark palette; inert in light mode.
          <div className="v2-dark-scope h-full -m-0">
            <Suspense fallback={<Fallback />}>
              <WhatsAppPanelLazy
                currentUser={user ?? undefined}
                currentCompanyId={currentCompanyId === 'ALL' ? undefined : currentCompanyId}
              />
            </Suspense>
          </div>
        )}
        {activeTab === 'briefing' && (
          <div className="v2-dark-scope h-full -m-0 overflow-y-auto">
            <Suspense fallback={<Fallback />}>
              <EmailBriefing />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionsTabsV2;
