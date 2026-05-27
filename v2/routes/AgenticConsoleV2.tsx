// Agentic console — V14-native shell over XS-agentic control-plane.
//
// Lives in V14's UI so Felipe operates the agentic platform with the
// same look-and-feel as the rest of the ERP. All data comes from the
// XS-agentic control-plane HTTP API (default http://localhost:7878 in
// dev; routed through the agentic-proxy Edge Function in production).
//
// This file is just the dispatcher — it renders one of the four sub-
// views as a tabbed surface. Each view (Stream / Autonomy /
// Capabilities / Audit) lives in its own file under ./agents/, along
// with shared types + the API client in ./agents/_shared.tsx.

import React, { useState } from 'react';
import { Activity, Sliders, Wrench, ScrollText } from 'lucide-react';
import StreamView from './agents/StreamView';
import AutonomyView from './agents/AutonomyView';
import CapabilitiesView from './agents/CapabilitiesView';
import AuditView from './agents/AuditView';
import { CONTROL_PLANE_URL } from './agents/_shared';

export type AgenticView = 'stream' | 'autonomy' | 'capabilities' | 'audit';

const VIEW_META: Record<AgenticView, {
  title: string;
  tab: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  component: React.FC;
}> = {
  stream:       { title: 'Agent stream',        tab: 'Stream',       icon: Activity,   component: StreamView },
  autonomy:     { title: 'Autonomy',             tab: 'Autonomy',     icon: Sliders,    component: AutonomyView },
  capabilities: { title: 'Capability registry', tab: 'Capabilities', icon: Wrench,     component: CapabilitiesView },
  audit:        { title: 'Audit timeline',      tab: 'Audit',        icon: ScrollText, component: AuditView },
};

const ORDER: AgenticView[] = ['stream', 'autonomy', 'capabilities', 'audit'];

// Single entry point for the AGENTS sidebar. Renders one of four sub-views
// (Stream / Autonomy / Capabilities / Audit) selected via internal tabs.
// `view` prop is kept as the *initial* tab so deep links / stored session
// state still land on the user's last view (AppV2 remaps the old per-view
// ids onto this single route).
export default function AgenticConsoleV2({ view = 'stream' }: { view?: AgenticView }) {
  const [active, setActive] = useState<AgenticView>(view);
  const meta = VIEW_META[active] ?? VIEW_META.stream;
  const Icon = meta.icon;
  const View = meta.component;
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Icon size={20} className="text-emerald-400" />
        <h1 className="text-lg font-semibold text-slate-100">{meta.title}</h1>
        <span className="text-xs text-slate-500">via XS-agentic · {CONTROL_PLANE_URL}</span>
      </div>
      <div className="flex items-center gap-1 border-b border-[#1f1f1f]">
        {ORDER.map(id => {
          const m = VIEW_META[id];
          const TIcon = m.icon;
          const on = active === id;
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ' +
                (on
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200')
              }
            >
              <TIcon size={14} />
              {m.tab}
            </button>
          );
        })}
      </div>
      <View />
    </div>
  );
}
