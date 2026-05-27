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
//
// Visual chrome (header + tabs) uses the Bento design tokens defined
// in styles/globals.css under `.bento-scope` so this surface matches
// the Dashboard team chat (same font family, same theme swap). The
// inner views still use V14 primitives, which already theme via the
// global CSS variable remap, so they respond to light/dark in lockstep.

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
  blurb: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  component: React.FC;
}> = {
  stream:       { title: 'Agent stream',        tab: 'Stream',       blurb: 'pending decisions + recent activity',     icon: Activity,   component: StreamView },
  autonomy:     { title: 'Autonomy',             tab: 'Autonomy',     blurb: 'per-(agent, capability) trust tiers',     icon: Sliders,    component: AutonomyView },
  capabilities: { title: 'Capability registry', tab: 'Capabilities', blurb: 'what agents are allowed to propose',      icon: Wrench,     component: CapabilitiesView },
  audit:        { title: 'Audit timeline',      tab: 'Audit',        blurb: 'filterable log of every action',          icon: ScrollText, component: AuditView },
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
    <div className="bento-scope flex h-full min-h-0 flex-col gap-4 p-4">

      {/* HEADER — title, blurb, control-plane URL pill */}
      <div className="flex shrink-0 items-center gap-3 flex-wrap">
        <Icon size={18} style={{ color: 'var(--b-teal)' }} />
        <h1 className="b-display text-[22px] font-semibold leading-none" style={{ color: 'var(--b-text)' }}>
          {meta.title}
        </h1>
        <span className="text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>{meta.blurb}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium b-mono"
              style={{ background: 'var(--b-surface)', color: 'var(--b-text-mute)', border: '1px solid var(--b-line)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--b-emerald)' }} />
          <span className="text-[10.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--b-text-mute)' }}>via</span>
          xs-agentic
        </span>
      </div>

      {/* TAB BAR — pill switcher matching the Dashboard mode pills */}
      <div className="flex items-center gap-1 p-1 rounded-full w-fit shrink-0"
           style={{ background: 'var(--b-surface)', border: '1px solid var(--b-line)' }}>
        {ORDER.map(id => {
          const m = VIEW_META[id];
          const TIcon = m.icon;
          const on = active === id;
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors"
              style={{
                background: on ? 'var(--b-surface-2)' : 'transparent',
                color: on ? 'var(--b-text)' : 'var(--b-text-mute)',
              }}
            >
              <TIcon size={13} />
              {m.tab}
            </button>
          );
        })}
      </div>

      {/* INNER VIEW — rendered inside a bento card surface so spacing +
        * border colour match the Dashboard panels. The view itself still
        * uses V14 primitives which theme via globals.css. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar rounded-[18px] border p-5"
        style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
      >
        <View />
      </div>

      {/* FOOTER — CONTROL_PLANE_URL surfaced quietly for ops debugging */}
      <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: 'var(--b-text-faint)' }}>
        <span className="b-mono">{CONTROL_PLANE_URL}</span>
      </div>
    </div>
  );
}
