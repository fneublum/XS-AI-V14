// Top-of-app banner that surfaces an expired edge-token to the user.
//
// `services/edgeAuth.invokeEdgeFunction` dispatches `xs-session-expired`
// when any Edge Function call 401s. Before this banner, the failure
// was console-only — background scans (inbox triage, booking monitor,
// reply drafter) would silently spin every 30 min producing nothing
// while the user assumed everything was working.
//
// Behavior:
//   - Listens for `xs-session-expired` on the window.
//   - Renders a fixed banner above the app shell with a "Sign back in"
//     button that mirrors SettingsV2.signOut (clear session keys + redirect).
//   - Auto-dismisses if a fresh edge token shows up (e.g. user signed in
//     from another tab) — we poll getEdgeToken every few seconds while
//     visible.
//   - Listenable: a single visible state, debounced by 1s so a burst of
//     failing background calls doesn't re-render constantly.

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { getEdgeToken } from '../../services/edgeAuth';

const HIDE_KEY = 'xs_session_banner_dismissed_at';
const DISMISS_TTL_MS = 5 * 60 * 1000; // 5 min — if user closes, re-show on next 401.

export const SessionExpiredBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);

  // Show on event, with a debounced re-show so multiple 401s in a row
  // don't flicker the banner.
  useEffect(() => {
    let lastShown = 0;
    const onExpire = () => {
      const now = Date.now();
      if (now - lastShown < 1000) return;
      lastShown = now;
      // Respect a recent manual dismiss.
      try {
        const dismissedAt = Number(sessionStorage.getItem(HIDE_KEY) || '0');
        if (dismissedAt && now - dismissedAt < DISMISS_TTL_MS) return;
      } catch { /* sessionStorage blocked — show anyway */ }
      setVisible(true);
    };
    window.addEventListener('xs-session-expired', onExpire);
    return () => window.removeEventListener('xs-session-expired', onExpire);
  }, []);

  // Poll for a fresh token while visible; hide as soon as one appears.
  // Covers the case where the user signs in via another tab — we
  // share sessionStorage cross-tab via the storage event, but polling
  // is simpler than wiring that up and the cost is trivial at 2s.
  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => {
      if (getEdgeToken()) setVisible(false);
    }, 2000);
    return () => window.clearInterval(t);
  }, [visible]);

  const signBackIn = useCallback(() => {
    try {
      sessionStorage.removeItem('xs_current_user');
      sessionStorage.removeItem('xs_edge_auth_token');
      sessionStorage.removeItem('xs_edge_auth_exp');
      sessionStorage.removeItem(HIDE_KEY);
    } catch { /* noop */ }
    // Same redirect SettingsV2.signOut uses — drops the user back at
    // the login screen with a clean session.
    window.location.href = '/?v2=1';
  }, []);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(HIDE_KEY, String(Date.now())); } catch { /* noop */ }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[100] bg-amber-500/15 backdrop-blur border-b border-amber-500/40 text-amber-100"
    >
      <div className="max-w-[1400px] mx-auto px-4 py-2 flex items-center gap-3 text-[12.5px]">
        <AlertTriangle size={14} className="text-amber-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-medium">Session expired</span>
          <span className="text-amber-200/80 ml-2">
            Background OCR + email scans have stopped working until you sign back in.
          </span>
        </div>
        <button
          type="button"
          onClick={signBackIn}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-amber-500/25 border border-amber-400/40 text-amber-50 hover:bg-amber-500/35 hover:border-amber-400/60 transition-colors"
        >
          <RefreshCw size={11} /> Sign back in
        </button>
        <button
          type="button"
          onClick={dismiss}
          title="Dismiss for 5 minutes"
          className="p-1 rounded text-amber-200/70 hover:text-amber-100 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
