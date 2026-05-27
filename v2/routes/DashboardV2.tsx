// V2 Dashboard — team chat between Felipe and the 6 HERMES agents.
//
// Felipe types into the composer; the message is sent to the XS-agentic
// control-plane which:
//   · stores it
//   · routes to the right agent (@mention or Max by default)
//   · generates a reply (LLM if XS_AGENTIC_ANTHROPIC_KEY set, otherwise
//     a data-grounded stub that reads live state from the action queue)
//
// The previous V1-dashboard surface is preserved at git rev fffbdb4 if
// the old layout is needed back; this file replaces it entirely.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, RefreshCw, Paperclip, X, FileText, Image as ImageIcon, UploadCloud, Trash2, LayoutGrid, Sparkles, ArrowLeft, Clock, Sun, Moon, Activity, Wallet, Ship, FileCheck } from 'lucide-react';
import { Card, CardBody, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import { cn } from '../primitives/utils';
import { useUiStore, type Theme, resolveTheme } from '../state/uiStore';
import { useReceivables } from '../queries/useReceivables';
import { useBookings } from '../queries/useBookings';
import { useSalesOrders } from '../queries/useSalesOrders';

// ─── Config ────────────────────────────────────────────────────────────

import { getEdgeToken } from '@/services/edgeAuth';
import { getSupabaseConfig } from '@/services/supabase';

// Where the dashboard sends its /chat/* calls. Three modes, picked at
// call-time per request:
//
// 1. ESCAPE HATCH — if window.XS_AGENTIC_URL or VITE_AGENTIC_URL is set,
//    use it verbatim. Useful for hitting a local control-plane
//    (http://localhost:7878) during backend dev.
//
// 2. SUPABASE PROXY (production) — route through the `agentic-proxy`
//    Edge Function. Browser only talks to *.supabase.co (which is known
//    to reach every user / network). The function forwards server-side
//    to the Tailscale Funnel. This is the path for any logged-in user
//    in deployed builds.
//
// 3. VITE DEV PROXY — `/xs-agentic` rewritten in vite.config.ts to the
//    funnel. Only works in `npm run dev` since prod has no server-side
//    proxy.
//
// The Supabase proxy ALSO removes the need for the control-plane to do
// CORS or accept the funnel URL on App Engine's CSP — every call is
// same-origin from the page's perspective (the function URL is on
// *.supabase.co which is already in connect-src).
function getAgenticBase(): { base: string; mode: 'escape' | 'supabase' | 'vite' } {
  const escape =
    (typeof window !== 'undefined' && (window as any).XS_AGENTIC_URL) ||
    import.meta.env.VITE_AGENTIC_URL;
  if (escape) return { base: escape, mode: 'escape' };
  // Supabase proxy is the prod path. Falls through to the vite proxy in
  // dev where getSupabaseConfig is fine but we don't have a JWT yet.
  try {
    const token = getEdgeToken();
    if (token) {
      const { url } = getSupabaseConfig();
      return { base: `${url}/functions/v1/agentic-proxy`, mode: 'supabase' };
    }
  } catch { /* fall through to vite dev proxy */ }
  return { base: '/xs-agentic', mode: 'vite' };
}

// Pretty label for the unreachable banner so we always show *which*
// path failed, not a misleading "the funnel".
const CONTROL_PLANE_LABEL = (): string => {
  const { base, mode } = getAgenticBase();
  return mode === 'supabase'
    ? `${base} (proxied via Supabase)`
    : base;
};

// ─── Types ─────────────────────────────────────────────────────────────

interface Attachment {
  name: string;
  type: string;
  size: number;
  data_url: string | null;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'agent' | 'system';
  author: string;
  to_agent: string | null;
  content: string;
  meta: Record<string, any> & { attachments?: Attachment[] };
  created_at: string;
}

interface Persona {
  display: string;
  tag?: string;
  role: string;
  voice: string;
}
type Personas = Record<string, Persona>;

interface OverviewCard {
  id: string;
  agent_id: string;
  capability_id: string;
  payload: Record<string, any>;
  status: string;
  tier_at_propose: string;
  proposed_at: string;
}
interface OverviewAgent {
  counts: Record<string, number>;
  open_cards: OverviewCard[];
}
type Overview = Record<string, OverviewAgent>;

interface Suggestions {
  [agent: string]: {
    activity: string;
    action_count_30d: number;
    prompts: string[];
  };
}

interface Cron {
  id: string;
  agent: string;
  kind: 'interval' | 'daily';
  cadence: string;
  job: string;
}
interface CronsPayload {
  source: string;
  host: string;
  weekdays_only_daily: boolean;
  crons: Cron[];
  counts: { total: number; interval: number; daily: number };
}

type Mode = 'chat' | 'overview' | 'prompts' | 'crons';

// ─── API ───────────────────────────────────────────────────────────────

async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  const { base, mode } = getAgenticBase();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (mode === 'supabase') {
    // Supabase Edge Function: attach JWT + apikey (gateway requires both).
    // Do NOT send x-actor — the proxy hardcodes it server-side and the
    // function's CORS preflight doesn't include x-actor in
    // Access-Control-Allow-Headers, so sending it triggers a CORS block
    // (TypeError: Failed to fetch) before the request leaves the browser.
    const token = getEdgeToken();
    if (token) {
      const { key } = getSupabaseConfig();
      headers.Authorization = `Bearer ${token}`;
      headers.apikey = key;
    }
  } else {
    // Direct paths (vite dev proxy / escape hatch) talk to the control-
    // plane, which expects x-actor and has CORS open for it.
    headers['x-actor'] = 'felipe';
  }
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Bypass intermediary/browser caches — we want fresh state on every
    // poll. Stale cached failures otherwise keep the "unreachable" banner
    // stuck even after the funnel recovers.
    cache: 'no-store',
  });
  const text = await res.text();
  // Strict JSON. Non-OK or non-JSON response => throw, so callers'
  // catch blocks fire (sets connected=false and renders the banner).
  // Without this, prod App Engine's SPA catch-all returns index.html
  // for /xs-agentic/* paths, which would be set as state and crash
  // any downstream .map call.
  if (!res.ok) {
    let msg: string = text;
    try { const j = JSON.parse(text); msg = j?.error ?? text; } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  if (!text) return null as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`non-JSON response from ${path} — control-plane likely unreachable`); }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const AGENT_TONE: Record<string, string> = {
  max:    'text-violet-300',
  lara:   'text-pink-300',
  matt:   'text-emerald-300',
  logan:  'text-sky-300',
  sal:    'text-amber-300',
  beth:   'text-rose-300',
  gem:    'text-indigo-300',
  hermes: 'text-orange-300',
  felipe: 'text-emerald-400',
  system: 'text-slate-400',
};

const AGENT_RING: Record<string, string> = {
  max:    'ring-violet-500/40 bg-violet-500/10',
  lara:   'ring-pink-500/40 bg-pink-500/10',
  matt:   'ring-emerald-500/40 bg-emerald-500/10',
  logan:  'ring-sky-500/40 bg-sky-500/10',
  sal:    'ring-amber-500/40 bg-amber-500/10',
  beth:   'ring-rose-500/40 bg-rose-500/10',
  gem:    'ring-indigo-500/40 bg-indigo-500/10',
  hermes: 'ring-orange-500/40 bg-orange-500/10',
  felipe: 'ring-emerald-500/40 bg-emerald-500/15',
  system: 'ring-slate-500/40 bg-slate-500/10',
};

// Hardcoded fallback labels so the team list always shows a proper
// capitalised name + role tag even if the /chat/personas fetch is slow,
// stale, or briefly fails. The personas API (when it loads) still wins
// — these are only used as the default.
const AGENT_LABELS: Record<string, { display: string; tag: string }> = {
  max:    { display: 'Max',    tag: 'Manager'   },
  lara:   { display: 'Lara',   tag: 'Assistant' },
  matt:   { display: 'Matt',   tag: 'Finance'   },
  logan:  { display: 'Logan',  tag: 'Shipments' },
  sal:    { display: 'Sal',    tag: 'Sales'     },
  beth:   { display: 'Beth',   tag: 'Personal'  },
  gem:    { display: 'Gem',    tag: 'ERP data'  },
  hermes: { display: 'Hermes', tag: 'Mac mini'  },
};

function initials(name: string): string {
  return (name?.[0] || '?').toUpperCase();
}

function fmtTime(s: string | undefined | null): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const ago = (Date.now() - d.getTime()) / 1000;
  if (ago < 60) return `${Math.floor(ago)}s`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m`;
  if (ago < 86400) return `${Math.floor(ago / 3600)}h`;
  return d.toLocaleString();
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function fileToAttachment(file: File): Promise<Attachment> {
  // Refuse files over the cap — UI surfaces the error via toast.
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" is ${fmtBytes(file.size)} — over the 2 MB attachment cap.`);
  }
  return {
    name: file.name || 'file',
    type: file.type || '',
    size: file.size,
    data_url: await readAsDataURL(file),
  };
}

// Markup @mentions in user messages so they stand out.
function renderContent(content: string, role: 'user' | 'agent' | 'system') {
  if (role !== 'user') return content;
  const parts = content.split(/(@(?:max|lara|matt|logan|sal|beth|gem|hermes))\b/i);
  return parts.map((p, i) => {
    if (/^@(max|lara|matt|logan|sal|beth|gem|hermes)$/i.test(p)) {
      const agent = p.slice(1).toLowerCase();
      return <span key={i} className={cn('rounded px-1 font-medium', AGENT_TONE[agent])}>{p}</span>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

// ─── Bento additions ───────────────────────────────────────────────────

interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  subject?: string | null;
  detail: Record<string, any>;
}

// Subscribe to the theme store so the toggle re-renders on change. The
// store itself is non-reactive by default — we wire a useEffect that
// pushes updates into local state.
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setLocal] = useState<Theme>(() => useUiStore.getState().theme);
  useEffect(() => useUiStore.subscribe((s) => setLocal(s.theme)), []);
  return [theme, useUiStore.getState().setTheme];
}

// "in transit" means the container has shipped but not yet been received
// by the customer. V14's booking status enum doesn't track receipt
// explicitly so we treat anything LOADED / DEPARTED / SHIPPED as in
// transit (any of these means cargo is moving / staged but not delivered).
const IN_TRANSIT_STATUSES = new Set(['LOADED', 'DEPARTED', 'SHIPPED']);

// "open" sales orders / RFQs / proformas = anything not in a terminal
// state. INVOICED + CANCELLED are terminal; everything else is open.
const OPEN_SO_STATUSES = new Set(['DRAFT', 'PROFORMA', 'CONFIRMED', 'PARTIALLY_INVOICED']);

// ─── Dashboard ─────────────────────────────────────────────────────────

export default function DashboardV2() {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [personas, setPersonas] = useState<Personas>({});
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [mode, setMode] = useState<Mode>('chat');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [crons, setCrons] = useState<CronsPayload | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [theme, setTheme] = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Supabase-backed KPIs (the bento top row). Reuses V14's existing
  // React Query hooks; they cache + dedupe across the app, so the chat
  // panel pays no extra cost for showing them.
  const receivables = useReceivables();
  const bookings    = useBookings();
  const salesOrders = useSalesOrders({});

  // Always-on overview + audit polling (powers the queue + activity tail
  // even when Felipe is in chat mode). Originally only fetched on the
  // Overview tab; bento surfaces both inline so they need to be live.
  useEffect(() => {
    const fetchAll = () => {
      api<Overview>('GET', '/chat/overview')
        .then(o => setOverview(o && typeof o === 'object' && !Array.isArray(o) ? o : null))
        .catch(() => {/* swallow — connected flag covers the user-facing banner */});
      api<AuditRow[]>('GET', '/audit?limit=20')
        .then(a => setAudit(Array.isArray(a) ? a : []))
        .catch(() => {/* swallow */});
    };
    fetchAll();
    const t = setInterval(fetchAll, 4000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api<ChatMessage[]>('GET', '/chat/messages?limit=300');
      setMessages(Array.isArray(list) ? list : []);
      setConnected(true);
    } catch {
      setMessages([]);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api<Personas>('GET', '/chat/personas')
      .then(p => setPersonas(p && typeof p === 'object' && !Array.isArray(p) ? p : {}))
      .catch(() => setPersonas({}));
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Lazy-load Overview / Suggestions on first switch into those modes,
  // and refresh whenever the user re-enters that mode.
  useEffect(() => {
    if (mode === 'overview') {
      api<Overview>('GET', '/chat/overview')
        .then(o => setOverview(o && typeof o === 'object' && !Array.isArray(o) ? o : null))
        .catch(() => setOverview(null));
    } else if (mode === 'prompts') {
      api<Suggestions>('GET', '/chat/suggestions')
        .then(s => setSuggestions(s && typeof s === 'object' && !Array.isArray(s) ? s : null))
        .catch(() => setSuggestions(null));
    } else if (mode === 'crons') {
      api<CronsPayload>('GET', '/chat/crons')
        .then(c => setCrons(c && typeof c === 'object' && Array.isArray((c as any).crons) ? c : null))
        .catch(() => setCrons(null));
    }
  }, [mode]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // sendText is the single send path; both the composer Send button and
  // the example-prompt cards call into it. Reads its arguments instead
  // of React state so callers don't need to setInput first and wait for
  // the re-render.
  async function sendText(content: string, atts: Attachment[] = []) {
    const trimmed = content.trim();
    if ((!trimmed && atts.length === 0) || sending) return;
    setSending(true);
    setInput('');
    setAttachments([]);
    const optimistic: ChatMessage = {
      id: 'opt-' + Date.now(),
      conversation_id: 'default',
      role: 'user',
      author: 'felipe',
      to_agent: null,
      content: trimmed || `(sent ${atts.length} attachment${atts.length === 1 ? '' : 's'})`,
      meta: atts.length > 0 ? { attachments: atts } : {},
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    setMessages(m => [...m, optimistic]);
    try {
      await api('POST', '/chat/message', {
        conversation_id: 'default',
        content: trimmed,
        attachments: atts,
      });
      await refresh();
    } catch (err: any) {
      toast.push({ kind: 'error', title: err.message ?? 'send failed' });
      setMessages(m => m.filter(x => x.id !== optimistic.id));
      setInput(trimmed);
      setAttachments(atts);
    } finally {
      setSending(false);
    }
  }

  function send() { return sendText(input, attachments); }

  // ── Attachment intake ────────────────────────────────────────────────

  async function addFiles(files: File[] | FileList | null) {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const slots = Math.max(0, 8 - attachments.length);
    const accepted = arr.slice(0, slots);
    if (arr.length > slots) {
      toast.push({ kind: 'warning', title: `Only 8 attachments per message; dropped ${arr.length - slots}.` });
    }
    const next: Attachment[] = [];
    for (const f of accepted) {
      try { next.push(await fileToAttachment(f)); }
      catch (err: any) { toast.push({ kind: 'error', title: err.message ?? 'attach failed' }); }
    }
    if (next.length > 0) setAttachments(prev => [...prev, ...next]);
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // ── Whole-pane drag overlay ──────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth.current += 1;
    setDragActive(true);
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }
  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function mention(agent: string) {
    const at = '@' + agent + ' ';
    setInput(prev => prev.startsWith(at) ? prev : at + prev);
    setTimeout(() => {
      const ta = document.getElementById('chat-composer') as HTMLTextAreaElement | null;
      ta?.focus();
    }, 0);
  }

  // Beth (Ana Paula's personal assistant) is intentionally omitted from
  // the TEAM roster on this Dashboard — she remains @-mentionable but
  // doesn't surface as a business teammate here.
  // Matt and Sal removed — they were ORCHESTRATION.md personas with no
  // real launchd job on HERMES. Beth omitted from this Dashboard
  // (personal scope; she still has a real launchd job).
  const agentOrder = ['max', 'lara', 'matt', 'logan', 'sal', 'gem', 'hermes'];

  // ── KPI derivations ──────────────────────────────────────────────────
  // Each derived from a hooked-up V14 query; loading/empty states render
  // as "—" so the layout doesn't shift after the data lands.
  const kpiAr = useMemo(() => {
    if (!receivables.data) return { total: 0, count: 0, loading: receivables.isLoading };
    const total = receivables.data.reduce((s, r) => s + (r.totalAmount || 0), 0);
    return { total, count: receivables.data.length, loading: false };
  }, [receivables.data, receivables.isLoading]);

  const kpiTransit = useMemo(() => {
    if (!bookings.data) return { count: 0, dischargingThisWeek: 0, loading: bookings.isLoading };
    const inTransit = bookings.data.filter(b => IN_TRANSIT_STATUSES.has((b.status || '').toUpperCase()));
    const now = Date.now();
    const oneWeek = 7 * 24 * 3600 * 1000;
    const dischargingThisWeek = inTransit.filter(b => {
      if (!b.eta) return false;
      const t = new Date(b.eta).getTime();
      return !isNaN(t) && t > now && t < now + oneWeek;
    }).length;
    return { count: inTransit.length, dischargingThisWeek, loading: false };
  }, [bookings.data, bookings.isLoading]);

  const kpiRfqs = useMemo(() => {
    if (!salesOrders.data) return { count: 0, pipeline: 0, loading: salesOrders.isLoading };
    const open = salesOrders.data.filter(s => OPEN_SO_STATUSES.has((s.status || '').toUpperCase()));
    const pipeline = open.reduce((s, r) => s + (r.totalAmount || 0), 0);
    return { count: open.length, pipeline, loading: false };
  }, [salesOrders.data, salesOrders.isLoading]);

  const kpiActions = useMemo(() => {
    if (!overview) return { total: 0, ok: 0, failed: 0, awaiting: 0, loading: true };
    let total = 0, ok = 0, failed = 0, awaiting = 0;
    for (const a of Object.values(overview)) {
      const c = a.counts ?? {};
      total += (c.EXECUTED || 0) + (c.AUTO_APPROVED || 0) + (c.APPROVED || 0) + (c.DENIED || 0) + (c.FAILED || 0) + (c.EXPIRED || 0);
      ok += (c.EXECUTED || 0) + (c.AUTO_APPROVED || 0) + (c.APPROVED || 0);
      failed += (c.FAILED || 0);
      awaiting += (c.AWAITING_APPROVAL || 0);
    }
    return { total, ok, failed, awaiting, loading: false };
  }, [overview]);

  // Decision queue = all open_cards from /chat/overview, sorted newest first.
  const queueItems = useMemo<OverviewCard[]>(() => {
    if (!overview) return [];
    const all: OverviewCard[] = [];
    for (const a of Object.values(overview)) {
      for (const c of a.open_cards ?? []) {
        if (c.status === 'AWAITING_APPROVAL') all.push(c);
      }
    }
    return all.sort((a, b) => (b.proposed_at || '').localeCompare(a.proposed_at || ''));
  }, [overview]);

  const clear = async () => {
    if (!window.confirm('Clear all chat messages in this conversation? Agent actions, audit log, and the action queue are NOT affected.')) return;
    try {
      await api('DELETE', '/chat/messages?conversation=default');
      setMessages([]);
      setInput('');
      setAttachments([]);
      toast.push({ kind: 'success', title: 'Chat cleared' });
    } catch (err: any) {
      toast.push({ kind: 'error', title: err.message ?? 'clear failed' });
    }
  };

  return (
    <div className="bento-scope flex h-full min-h-0 flex-col gap-4 p-4">

      {/* COMPACT HEADER — title + status (left), mode pills + theme toggle (right) */}
      <div className="flex shrink-0 items-center gap-3 flex-wrap">
        <span className="block w-1 h-9 rounded-full mr-0.5" style={{ background: 'var(--b-teal-2)' }} />
        <h1 className="b-display font-semibold leading-none" style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
          Team room
        </h1>
        <div className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>
          {connected === false
            ? <BentoPill tone="rose">control-plane unreachable</BentoPill>
            : connected === null
              ? <span>connecting…</span>
              : <>
                  <BentoPill tone="teal">● polling</BentoPill>
                  <span>· {messages.length} {messages.length === 1 ? 'msg' : 'msgs'}</span>
                </>
          }
        </div>

        <span className="ml-auto" />

        {/* Mode switcher */}
        <div
          className="flex items-center gap-1 rounded-full p-1 border"
          style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
        >
          <BentoModePill icon={<MessageSquare size={13} />} label="Chat"     active={mode === 'chat'}     onClick={() => setMode('chat')} />
          <BentoModePill icon={<LayoutGrid size={13} />}    label="Overview" active={mode === 'overview'} onClick={() => setMode('overview')} />
          <BentoModePill icon={<Sparkles size={13} />}      label="Prompts"  active={mode === 'prompts'}  onClick={() => setMode('prompts')} />
          <BentoModePill icon={<Clock size={13} />}         label="Crons"    active={mode === 'crons'}    onClick={() => setMode('crons')} />
        </div>

        {/* Theme toggle — feeds the global useUiStore so V14's whole shell flips with it */}
        <button
          onClick={() => setTheme(resolveTheme(theme) === 'light' ? 'dark' : 'light')}
          className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors"
          style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)', color: 'var(--b-text-soft)' }}
          title={`Switch to ${resolveTheme(theme) === 'light' ? 'dark' : 'light'} mode`}
        >
          {resolveTheme(theme) === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>

        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-colors"
          style={{ background: 'var(--b-surface)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
        >
          <RefreshCw size={12} /> refresh
        </button>
        {mode === 'chat' && (
          <button
            onClick={clear}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-colors"
            style={{ background: 'var(--b-surface)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
          >
            <Trash2 size={12} /> clear
          </button>
        )}
      </div>

      {/* MODE-SWITCHED BODY */}
      {mode === 'overview' && (
        <OverviewPanel data={overview} personas={personas} onBack={() => setMode('chat')} onSend={(t) => { setMode('chat'); sendText(t); }} />
      )}
      {mode === 'prompts' && (
        <PromptsPanel data={suggestions} personas={personas} onBack={() => setMode('chat')} onSend={(t) => { setMode('chat'); sendText(t); }} />
      )}
      {mode === 'crons' && (
        <CronsPanel data={crons} personas={personas} onBack={() => setMode('chat')} />
      )}

      {mode === 'chat' && (
        <div className="min-h-0 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1">

          {/* ROW 1: KPI cards — 4 across on wide, 2 on medium, 1 on narrow */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 shrink-0">
            <BentoKpiCard
              tint="gold"
              label="AR open · current"
              value={kpiAr.loading ? '—' : `$${(kpiAr.total / 1000).toFixed(1)}k`}
              valueColor="var(--b-gold)"
              hint={kpiAr.loading ? 'loading…' : `${kpiAr.count} invoices`}
              icon={<Wallet size={14} />}
            />
            <BentoKpiCard
              tint="cyan"
              label="Containers in transit"
              value={kpiTransit.loading ? '—' : String(kpiTransit.count)}
              valueColor="var(--b-cyan)"
              hint={kpiTransit.loading ? 'loading…' : `${kpiTransit.dischargingThisWeek} discharging this week`}
              icon={<Ship size={14} />}
            />
            <BentoKpiCard
              tint="sal"
              label="Open sales orders"
              value={kpiRfqs.loading ? '—' : String(kpiRfqs.count)}
              valueColor="var(--b-c-sal)"
              hint={kpiRfqs.loading ? 'loading…' : `$${(kpiRfqs.pipeline / 1000).toFixed(0)}k pipeline`}
              icon={<FileCheck size={14} />}
            />
            <BentoKpiCard
              tint="emerald"
              label="Agent actions · all time"
              value={kpiActions.loading ? '—' : String(kpiActions.total)}
              valueColor="var(--b-emerald)"
              hint={kpiActions.loading ? 'loading…' : `${kpiActions.ok} ok · ${kpiActions.failed} failed · ${kpiActions.awaiting} awaiting`}
              icon={<Activity size={14} />}
            />
          </div>

          {/* ROW 2: chat — full width, the main work surface */}
          <div className="grid grid-cols-1 gap-4">

            {/* CHAT PANEL */}
            <div
              className="relative flex flex-col rounded-[18px] border overflow-hidden"
              style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)', minHeight: '560px' }}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              {/* Drag overlay */}
              {dragActive && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[18px] border-2 border-dashed"
                  style={{ borderColor: 'var(--b-teal)', background: 'var(--b-teal-soft)' }}
                >
                  <div className="flex items-center gap-3" style={{ color: 'var(--b-teal)' }}>
                    <UploadCloud size={28} />
                    <span className="text-sm font-medium">Drop files to attach</span>
                  </div>
                </div>
              )}

              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
                <span className="b-display text-[14px] font-semibold" style={{ color: 'var(--b-text)' }}>Conversation</span>
                <BentoPill tone="teal">● {agentOrder.length} of {agentOrder.length} online</BentoPill>
                <span className="b-mono text-[11.5px] ml-auto" style={{ color: 'var(--b-text-mute)' }}>
                  last {messages.length > 0 ? fmtTime(messages[messages.length - 1].created_at) : '—'} ago
                </span>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                {messages.length === 0 && connected !== false && (
                  <div className="p-4">
                    <EmptyChatHint personas={personas} onSend={sendText} />
                  </div>
                )}
                {connected === false && (
                  <div className="m-4 rounded-xl border p-4" style={{ borderColor: 'rgba(251, 113, 133, 0.3)', background: 'var(--b-rose-soft)' }}>
                    <div className="text-sm font-medium" style={{ color: 'var(--b-rose)' }}>
                      ⚠ Control-plane unreachable at <code className="b-mono text-[12px]">{CONTROL_PLANE_LABEL()}</code>
                    </div>
                    <div className="mt-1 text-[12px]" style={{ color: 'var(--b-text-mute)' }}>
                      Calls go: browser → Supabase Edge Function (<code className="b-mono">agentic-proxy</code>) →
                      Mac mini control-plane. Likely a tailnet hiccup or the launchd job is offline.
                    </div>
                    <button
                      onClick={refresh}
                      className="mt-2 rounded-full px-3 py-1 text-[12px] font-medium"
                      style={{ background: 'var(--b-rose)', color: 'white' }}
                    >Retry</button>
                  </div>
                )}
                {messages.map(m => <BentoMessage key={m.id} m={m} personas={personas} />)}
                {sending && (
                  <div className="flex items-center gap-2 px-5 py-3 text-[12px]" style={{ color: 'var(--b-text-mute)' }}>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    replying…
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="border-t" style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface)' }}>
                <div className="p-3">
                  <div
                    className="rounded-[14px] border transition-colors px-4 py-3 focus-within:border-[color:var(--b-teal-2)]"
                    style={{ background: 'var(--b-page)', borderColor: 'var(--b-line-bold)' }}
                  >
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pb-2 mb-2 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
                        {attachments.map((a, i) => (
                          <AttachmentChip key={i} a={a} onRemove={() => removeAttachment(i)} />
                        ))}
                      </div>
                    )}
                    <textarea
                      id="chat-composer"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      onPaste={onPaste}
                      placeholder="Reply to the team…  @matt anything overdue?  ·  Enter to send"
                      rows={1}
                      className="block w-full resize-none bg-transparent text-[13.5px] leading-tight focus:outline-none py-0"
                      style={{ color: 'var(--b-text)' }}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={e => { addFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    />
                    {/* Single toolbar row — agent quick-pick + attach + send.
                      * Sits just below the textarea with a small breathing
                      * gap (no divider line — the rhythm comes from spacing). */}
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {/* Agent quick-pick chips */}
                      {agentOrder.map(id => {
                        const active = input.trim().toLowerCase().startsWith('@' + id);
                        const color = `var(--b-c-${id}, var(--b-text-soft))`;
                        const p = personas[id];
                        const fallback = AGENT_LABELS[id];
                        const display = p?.display ?? fallback?.display ?? id;
                        return (
                          <button
                            key={id}
                            onClick={() => mention(id)}
                            title={p?.role ?? display}
                            className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-full font-medium transition-colors"
                            style={{
                              background: active ? color : 'var(--b-surface-2)',
                              color: active ? 'white' : color,
                              border: '1px solid ' + (active ? color : 'transparent'),
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? 'white' : 'currentColor' }} />
                            {display.toLowerCase()}
                          </button>
                        );
                      })}
                      {/* Attach button */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-full"
                        style={{ color: 'var(--b-text-mute)' }}
                        title="Attach file · attachments route to @lara"
                      >
                        <Paperclip size={12} /> attach
                      </button>
                      {/* Send — pushed to the right */}
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        <span className="text-[11px] b-mono" style={{ color: 'var(--b-text-mute)' }}>↵</span>
                        <button
                          onClick={send}
                          disabled={sending || (!input.trim() && attachments.length === 0)}
                          className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          style={{ background: 'var(--b-teal-2)', color: resolveTheme(theme) === 'light' ? 'white' : '#052e2b' }}
                        >
                          <Send size={12} /> Send
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ROW 3: queue (1) + agent vitals (1) + activity tail (1) */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* DECISION QUEUE */}
            <div
              className="flex flex-col rounded-[18px] border overflow-hidden"
              style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)', maxHeight: '480px' }}
            >
              <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
                <span className="b-display text-[14px] font-semibold" style={{ color: 'var(--b-text)' }}>Awaiting you</span>
                <BentoPill tone={queueItems.length > 0 ? 'gold' : 'mute'}>{queueItems.length}</BentoPill>
                <span className="b-mono text-[11px] ml-auto" style={{ color: 'var(--b-text-mute)' }}>↺ 3s</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {queueItems.length === 0 ? (
                  <div className="p-6 text-center text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>
                    Nothing in the queue.
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--b-text-faint)' }}>The agents are quiet.</div>
                  </div>
                ) : (
                  queueItems.slice(0, 8).map(c => (
                    <BentoQueueItem
                      key={c.id}
                      card={c}
                      onAsk={() => { setMode('chat'); mention(c.agent_id); }}
                    />
                  ))
                )}
              </div>
              {queueItems.length > 0 && (
                <div className="px-5 py-3 border-t text-[11px]" style={{ borderColor: 'var(--b-line-soft)', color: 'var(--b-text-mute)' }}>
                  {queueItems.length} pending · open Overview tab for full triage
                </div>
              )}
            </div>

            {/* AGENT VITALS */}
            <div
              className="rounded-[18px] border overflow-hidden"
              style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
            >
              <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
                <span className="b-display text-[14px] font-semibold" style={{ color: 'var(--b-text)' }}>Agent vitals</span>
                <span className="b-mono text-[11px] ml-auto" style={{ color: 'var(--b-text-mute)' }}>
                  {agentOrder.length} of {agentOrder.length}
                </span>
              </div>
              <div className="p-3 grid grid-cols-1 gap-2 overflow-y-auto custom-scrollbar" style={{ maxHeight: '420px' }}>
                {agentOrder.map(id => {
                  const p = personas[id];
                  const fallback = AGENT_LABELS[id];
                  const display = p?.display ?? fallback?.display ?? id;
                  const tag = p?.tag ?? fallback?.tag ?? '';
                  const o = overview?.[id];
                  const awaiting = o?.counts?.AWAITING_APPROVAL ?? 0;
                  const executed24h = (o?.counts?.EXECUTED ?? 0) + (o?.counts?.AUTO_APPROVED ?? 0);
                  return (
                    <BentoAgentTile
                      key={id}
                      id={id}
                      display={display}
                      tag={tag}
                      awaiting={awaiting}
                      executed={executed24h}
                      onClick={() => { setMode('chat'); mention(id); }}
                    />
                  );
                })}
              </div>
            </div>

            {/* ACTIVITY TAIL */}
            <div
              className="rounded-[18px] border overflow-hidden flex flex-col"
              style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)', maxHeight: '480px' }}
            >
              <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
                <span className="b-display text-[14px] font-semibold" style={{ color: 'var(--b-text)' }}>Activity tail</span>
                <BentoPill tone="mute">live</BentoPill>
                <span className="b-mono text-[11px] ml-auto" style={{ color: 'var(--b-text-mute)' }}>↺ 4s</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {audit.length === 0 ? (
                  <div className="p-6 text-center text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>
                    No recent events.
                  </div>
                ) : (
                  audit.slice(0, 10).map(r => <BentoAuditRow key={r.id} r={r} personas={personas} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bento sub-components ──────────────────────────────────────────────

function BentoPill({ tone, children }: { tone: 'teal' | 'gold' | 'rose' | 'mute'; children: React.ReactNode }) {
  const bg = tone === 'teal' ? 'var(--b-teal-soft)' : tone === 'gold' ? 'var(--b-gold-soft)' : tone === 'rose' ? 'var(--b-rose-soft)' : 'var(--b-surface-2)';
  const col = tone === 'teal' ? 'var(--b-teal-2)' : tone === 'gold' ? 'var(--b-gold)' : tone === 'rose' ? 'var(--b-rose)' : 'var(--b-text-soft)';
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium" style={{ background: bg, color: col }}>
      {children}
    </span>
  );
}

function BentoModePill({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] transition-colors"
      style={{
        background: active ? 'var(--b-surface-2)' : 'transparent',
        color: active ? 'var(--b-text)' : 'var(--b-text-mute)',
      }}
    >
      {icon} {label}
    </button>
  );
}

function BentoKpiCard({ tint, label, value, valueColor, hint, icon }: {
  tint: 'gold' | 'cyan' | 'sal' | 'emerald';
  label: string;
  value: string;
  valueColor: string;
  hint: string;
  icon: React.ReactNode;
}) {
  const bg = tint === 'gold' ? 'var(--b-tint-gold)' : tint === 'cyan' ? 'var(--b-tint-cyan)' : tint === 'sal' ? 'var(--b-tint-sal)' : 'var(--b-tint-emerald)';
  return (
    <div className="rounded-[14px] border px-4 py-3 flex items-center gap-4" style={{ background: bg, borderColor: 'var(--b-line)' }}>
      {/* Icon + tinted square */}
      <div
        className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center"
        style={{ background: valueColor, color: 'white' }}
      >
        {icon}
      </div>
      {/* Label + hint stack on left */}
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-[0.14em] leading-none mb-1" style={{ color: 'var(--b-text-mute)' }}>
          {label}
        </div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--b-text-mute)' }}>{hint}</div>
      </div>
      {/* Big value on right */}
      <div className="b-display shrink-0 text-right" style={{ color: valueColor, fontVariationSettings: "'opsz' 96, 'wght' 600", letterSpacing: '-0.03em', fontSize: '26px', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function BentoAgentTile({ id, display, tag, awaiting, executed, onClick }: {
  id: string;
  display: string;
  tag: string;
  awaiting: number;
  executed: number;
  onClick: () => void;
}) {
  const color = `var(--b-c-${id}, var(--b-text-soft))`;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border p-3 transition-colors relative overflow-hidden hover:bg-[color:var(--b-surface-2)]"
      style={{ background: 'var(--b-surface-2)', borderColor: 'var(--b-line)' }}
      title={`Mention @${id}`}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: color }} />
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-6 h-6 rounded-lg flex items-center justify-center b-display text-[11px] font-bold text-white"
          style={{ background: color }}
        >
          {initials(display)}
        </span>
        <div className="min-w-0">
          <div className="b-display text-[13px] font-semibold leading-none" style={{ color }}>{display}</div>
          <div className="text-[10.5px] mt-1" style={{ color: 'var(--b-text-mute)' }}>{tag}</div>
        </div>
        {awaiting > 0 && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold b-mono" style={{ background: 'var(--b-gold-soft)', color: 'var(--b-gold)' }}>
            {awaiting}
          </span>
        )}
      </div>
      <div className="text-[11px] b-mono flex items-center gap-2" style={{ color: 'var(--b-text-mute)' }}>
        <span>{executed} executed</span>
        <span>·</span>
        <span>{awaiting} awaiting</span>
      </div>
    </button>
  );
}

function BentoQueueItem({ card, onAsk }: { card: OverviewCard; onAsk: () => void }) {
  const summary = (card.payload?.summary as string) || CAPABILITY_LABEL[card.capability_id] || card.capability_id;
  const color = `var(--b-c-${card.agent_id}, var(--b-text-soft))`;
  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
      <div className="flex items-start gap-3">
        <span
          className="w-6 h-6 shrink-0 rounded-lg flex items-center justify-center b-display text-[11px] font-bold text-white mt-0.5"
          style={{ background: color }}
        >
          {card.agent_id[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-snug" style={{ color: 'var(--b-text)' }}>{summary}</div>
          <div className="text-[10.5px] mt-1 b-mono flex items-center gap-2" style={{ color: 'var(--b-text-mute)' }}>
            <span>{card.capability_id}</span>
            <span>·</span>
            <span>{fmtTime(card.proposed_at)} ago</span>
          </div>
          <button
            onClick={onAsk}
            className="mt-2 text-[11px] font-medium"
            style={{ color: 'var(--b-teal-2)' }}
          >
            Open in chat →
          </button>
        </div>
      </div>
    </div>
  );
}

function BentoAuditRow({ r, personas }: { r: AuditRow; personas: Personas }) {
  void personas;
  const actorColor = `var(--b-c-${r.actor}, var(--b-text-soft))`;
  return (
    <div
      className="grid items-center gap-3 px-4 py-2 border-b text-[12px] hover:bg-[color:var(--b-surface-2)]"
      style={{ gridTemplateColumns: '60px 22px 1fr auto', borderColor: 'var(--b-line-soft)' }}
    >
      <span className="b-mono text-[10.5px]" style={{ color: 'var(--b-text-mute)' }}>{r.ts?.slice(11, 19) ?? ''}</span>
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center b-display text-[9px] font-bold text-white"
        style={{ background: actorColor }}
      >
        {r.actor[0]?.toUpperCase()}
      </span>
      <span className="min-w-0 truncate" style={{ color: 'var(--b-text)' }}>
        <span className="b-display font-semibold" style={{ color: actorColor }}>{r.actor}</span>{' '}
        <code className="b-mono text-[11px]" style={{ color: 'var(--b-teal-2)' }}>{r.action}</code>
        {r.subject ? <span style={{ color: 'var(--b-text-mute)' }}> · {String(r.subject).slice(0, 32)}</span> : null}
      </span>
      <span className="b-mono text-[10px]" style={{ color: 'var(--b-text-faint)' }}>#{r.id}</span>
    </div>
  );
}

function BentoMessage({ m, personas }: { m: ChatMessage; personas: Personas }) {
  const isUser = m.role === 'user';
  const author = isUser ? 'felipe' : m.author;
  const display = isUser ? 'You' : (personas[author]?.display ?? AGENT_LABELS[author]?.display ?? author);
  const color = `var(--b-c-${author}, var(--b-text-soft))`;
  return (
    <div className={cn('flex gap-2 px-4 py-1.5', isUser && 'flex-row-reverse')}>
      <div className="w-5 h-5 mt-1 shrink-0 rounded-md flex items-center justify-center b-display text-[10px] font-bold text-white" style={{ background: color }}>
        {initials(display)}
      </div>
      <div className={cn('min-w-0 flex flex-col', isUser ? 'items-end' : 'items-start')} style={{ maxWidth: '80%' }}>
        <div className="flex items-baseline gap-2 mb-0.5 leading-none">
          <span className="b-display text-[12px] font-semibold" style={{ color }}>{display}</span>
          <span className="b-mono text-[10px]" style={{ color: 'var(--b-text-mute)' }}>{fmtTime(m.created_at)}</span>
        </div>
        <div
          className="rounded-lg border px-2.5 py-1.5 text-[13px] leading-[1.45] whitespace-pre-wrap w-fit"
          style={{
            background: isUser ? 'var(--b-teal-soft)' : 'var(--b-surface-2)',
            borderColor: isUser ? 'var(--b-teal-soft)' : 'var(--b-line)',
            color: 'var(--b-text)',
          }}
        >
          {renderContent(m.content, m.role)}
          {(m.meta?.attachments ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--b-line-soft)' }}>
              {(m.meta!.attachments as Attachment[]).map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] b-mono"
                  style={{ background: 'var(--b-surface-3)', color: 'var(--b-text-soft)' }}
                >
                  {a.type.startsWith('image/') ? <ImageIcon size={11} /> : <FileText size={11} />}
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Overview panel — team-standup view ────────────────────────────────
//
// One card per agent, written as if reporting at a stand-up:
// either "Waiting on you for X" / "Worked through Y" / "Quiet right
// now". The technical chips (status enum, capability_id) are gone;
// what's left is the actual work in plain English from payload.summary,
// with status conveyed only via colored leading icon.

// Friendly fallback name for a capability when payload.summary is absent.
const CAPABILITY_LABEL: Record<string, string> = {
  'ar.send_followup':        'payment follow-up email',
  'ar.send_statement':       'AR statement',
  'shipment.notify_eta_change': 'shipment ETA notice',
  'rfq.draft_proforma':      'proforma draft',
  'rfq.send_proforma':       'proforma to customer',
  'email.send_reply':        'email reply',
  'finance.move_money':      'funds movement',
  'customer.create':         'new customer',
  'customer.update':         'customer update',
  'product.create':          'new product',
  'product.update':          'product update',
  'supplier.create':         'new supplier',
  'supplier.update':         'supplier update',
};

function describeCard(c: OverviewCard): string {
  const s = c.payload?.summary;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return CAPABILITY_LABEL[c.capability_id] ?? c.capability_id;
}

// Decide what the card actually says today.
function agentReport(a: OverviewAgent): {
  headline: string;
  tone: 'amber' | 'emerald' | 'slate';
  cards: OverviewCard[];
  cta?: { label: string; prompt: string };
} {
  const awaiting = a.open_cards.filter(c => c.status === 'AWAITING_APPROVAL');
  const done = a.open_cards
    .filter(c => ['APPROVED','AUTO_APPROVED','EXECUTED'].includes(c.status))
    .slice(0, 3);

  if (awaiting.length > 0) {
    const n = awaiting.length;
    return {
      headline: n === 1 ? 'Waiting on your call for 1 thing.' : `Waiting on your call for ${n} things.`,
      tone: 'amber',
      cards: awaiting.slice(0, 3),
    };
  }
  if (done.length > 0) {
    const n = done.length;
    return {
      headline: n === 1 ? 'Handled 1 thing recently.' : `Handled ${n} things recently.`,
      tone: 'emerald',
      cards: done,
    };
  }
  return {
    headline: 'Quiet right now.',
    tone: 'slate',
    cards: [],
  };
}

function OverviewPanel({
  data, personas, onBack, onSend,
}: {
  data: Overview | null;
  personas: Personas;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const agentOrder = ['max','lara','matt','logan','sal','gem','hermes'];
  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1f1f1f] px-4 py-3">
        <LayoutGrid size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-slate-100">Team overview</h2>
        <span className="text-xs text-slate-500">what each teammate is doing right now</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" />back to chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!data ? (
          <div className="text-sm text-slate-500">loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agentOrder.map(id => {
              const p = personas[id];
              const fallback = AGENT_LABELS[id];
              const display = p?.display ?? fallback?.display ?? id;
              const tag = p?.tag ?? fallback?.tag ?? '';
              const a = data[id];
              if (!a) return null;
              const report = agentReport(a);
              const toneRing =
                report.tone === 'amber'   ? 'border-amber-500/30'   :
                report.tone === 'emerald' ? 'border-emerald-500/20' :
                                            'border-[#1f1f1f]';
              const headlineTone =
                report.tone === 'amber'   ? 'text-amber-300'   :
                report.tone === 'emerald' ? 'text-emerald-300' :
                                            'text-slate-400';
              const bulletDot =
                report.tone === 'amber'   ? 'bg-amber-400'    :
                report.tone === 'emerald' ? 'bg-emerald-400'  :
                                            'bg-slate-500';
              const awaitingN = a.open_cards.filter(c => c.status === 'AWAITING_APPROVAL').length;

              return (
                <div key={id} className={cn(
                  'flex flex-col rounded border bg-[#0f0f0f] p-4 transition-colors',
                  toneRing,
                )}>
                  {/* Identity */}
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1',
                      AGENT_RING[id] ?? AGENT_RING.system,
                      AGENT_TONE[id] ?? AGENT_TONE.system,
                    )}>
                      {initials(display)}
                    </span>
                    <div className="min-w-0">
                      <div className={cn('text-sm font-semibold', AGENT_TONE[id])}>{display}</div>
                      <div className="text-[11px] text-slate-500">{tag}</div>
                    </div>
                  </div>

                  {/* Headline — the team-standup sentence */}
                  <div className={cn('mt-3 text-sm font-medium', headlineTone)}>
                    {report.headline}
                  </div>

                  {/* Bulleted summaries — what they're actually working on */}
                  {report.cards.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {report.cards.map(c => (
                        <li key={c.id} className="flex items-start gap-2 text-sm text-slate-300">
                          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', bulletDot)} />
                          <span className="leading-snug">{describeCard(c)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* CTA when something needs the human */}
                  {awaitingN > 0 && (
                    <div className="mt-auto pt-3">
                      <button
                        onClick={() => onSend(`@${id} walk me through what's waiting for me.`)}
                        className="text-[12px] text-emerald-400 hover:text-emerald-300"
                      >
                        Ask {display} to walk me through →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Prompts panel — suggested prompts per agent ────────────────────────

function PromptsPanel({
  data, personas, onBack, onSend,
}: {
  data: Suggestions | null;
  personas: Personas;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  // Beth is intentionally omitted from Prompts too — same rationale as
  // Overview: her domain isn't business operational.
  const agentOrder = ['max','lara','matt','logan','sal','gem','hermes'];
  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1f1f1f] px-4 py-3">
        <Sparkles size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-slate-100">Prompts</h2>
        <span className="text-xs text-slate-500">grounded in each agent's recent activity · click to send</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" />back to chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!data ? (
          <div className="text-sm text-slate-500">loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {agentOrder.map(id => {
              const p = personas[id];
              const fallback = AGENT_LABELS[id];
              const display = p?.display ?? fallback?.display ?? id;
              const tag = p?.tag ?? fallback?.tag ?? '';
              const s = data[id];
              if (!s) return null;
              return (
                <div key={id} className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ring-1',
                      AGENT_RING[id] ?? AGENT_RING.system,
                      AGENT_TONE[id] ?? AGENT_TONE.system,
                    )}>
                      {initials(display)}
                    </span>
                    <span className={cn('text-sm font-semibold', AGENT_TONE[id])}>{display}</span>
                    <span className="text-xs text-slate-500">{tag}</span>
                  </div>
                  <div className="mb-3 text-[11px] text-slate-500">{s.activity}</div>
                  <div className="space-y-1.5">
                    {s.prompts.map(text => (
                      <button
                        key={text}
                        onClick={() => onSend(text)}
                        className="block w-full rounded border border-[#1f1f1f] bg-[#141414] px-2.5 py-1.5 text-left text-xs text-slate-200 hover:border-[#2a2a2a] hover:text-slate-100"
                      >
                        {text.split(/(@\w+)/).map((part, i) =>
                          /^@\w+$/.test(part)
                            ? <span key={i} className={cn('font-medium', AGENT_TONE[part.slice(1).toLowerCase()])}>{part}</span>
                            : <React.Fragment key={i}>{part}</React.Fragment>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function MessageBubble({ m, personas }: { m: ChatMessage; personas: Personas }) {
  const isUser = m.role === 'user';
  const author = m.author;
  const display = isUser ? 'You' : (personas[author]?.display ?? author);
  const atts = Array.isArray(m.meta?.attachments) ? m.meta.attachments : [];
  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <span className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
        AGENT_RING[author] ?? AGENT_RING.system,
        AGENT_TONE[author] ?? AGENT_TONE.system,
      )}>
        {initials(display)}
      </span>
      <div className={cn('min-w-0 max-w-[80%]', isUser ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div className="mb-0.5 flex items-center gap-2 text-[11px]">
          <span className={cn('font-medium', AGENT_TONE[author] ?? 'text-slate-300')}>{display}</span>
          <span className="text-slate-600">{fmtTime(m.created_at)} ago</span>
          {m.meta?.llm === false && !isUser && (
            <span className="rounded bg-[#141414] px-1.5 text-[10px] text-slate-500">stub</span>
          )}
        </div>
        <div className={cn(
          'whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'border-emerald-500/30 bg-emerald-500/5 text-slate-100'
            : 'border-[#1f1f1f] bg-[#141414] text-slate-200',
        )}>
          {atts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {atts.map((a, i) => <AttachmentDisplay key={i} a={a} />)}
            </div>
          )}
          {renderContent(m.content, m.role)}
        </div>
      </div>
    </div>
  );
}

// ─── Attachment chips (composer + message body) ────────────────────────

// ─── Crons panel — HERMES launchd schedule on the Mac mini ─────────────

function CronsPanel({
  data, personas, onBack,
}: {
  data: CronsPayload | null;
  personas: Personas;
  onBack: () => void;
}) {
  // Filter out Beth's crons — same scope rule as the roster: business
  // ops only on this Dashboard surface.
  const businessCrons = (data?.crons ?? []).filter(c => c.agent !== 'beth');
  const interval = businessCrons.filter(c => c.kind === 'interval');
  const daily    = businessCrons.filter(c => c.kind === 'daily');
  const visibleCount = businessCrons.length;

  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1f1f1f] px-4 py-3">
        <Clock size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-slate-100">HERMES schedules</h2>
        <span className="text-xs text-slate-500">
          {data ? `${visibleCount} active on ${data.host}` : 'launchd, Mac mini'}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" />back to chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-6">
        {!data ? (
          <div className="text-sm text-slate-500">loading…</div>
        ) : (
          <>
            <CronSection title="Real-time loops" subtitle="run continuously" rows={interval} personas={personas} />
            <CronSection title="Daily timeline" subtitle="weekday schedule (Mon–Fri)" rows={daily} personas={personas} />
            <div className="text-[11px] text-slate-600">
              Source: <code>{data.source}</code> · host <code>{data.host}</code>. Live <code>launchctl</code> readout will replace this list when wired.
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function CronSection({
  title, subtitle, rows, personas,
}: {
  title: string;
  subtitle: string;
  rows: Cron[];
  personas: Personas;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        <span className="text-[11px] text-slate-600">{subtitle}</span>
        <span className="ml-auto text-[11px] text-slate-600">{rows.length}</span>
      </div>
      <div className="overflow-hidden rounded border border-[#1f1f1f]">
        {rows.map((c, i) => {
          const p = personas[c.agent];
          const agentLabel = p?.display ?? (c.agent === 'system' ? 'System' : c.agent);
          return (
            <div
              key={c.id}
              className={cn(
                'grid grid-cols-[110px_120px_1fr] items-center gap-3 px-3 py-2 text-sm',
                i !== 0 && 'border-t border-[#1f1f1f]',
              )}
            >
              <span className="font-mono text-xs text-slate-400">{c.cadence}</span>
              <span className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', AGENT_RING[c.agent] ?? AGENT_RING.system)} />
                <span className={cn('text-xs font-medium', AGENT_TONE[c.agent] ?? AGENT_TONE.system)}>
                  {agentLabel}
                </span>
              </span>
              <span className="text-slate-200">{c.job}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const isImg = /^image\//i.test(a.type);
  return (
    <div className="inline-flex items-center gap-2 rounded border border-[#1f1f1f] bg-[#141414] py-1 pl-1 pr-2">
      {isImg && a.data_url
        ? <img src={a.data_url} alt={a.name} className="h-9 w-9 rounded object-cover" />
        : <span className="flex h-9 w-9 items-center justify-center rounded bg-[#0f0f0f] text-slate-400">
            {isImg ? <ImageIcon size={16} /> : <FileText size={16} />}
          </span>}
      <span className="min-w-0">
        <div className="max-w-[160px] truncate text-xs font-medium text-slate-200">{a.name}</div>
        <div className="text-[10px] text-slate-500">{fmtBytes(a.size)}</div>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-0.5 text-slate-500 hover:bg-[#0f0f0f] hover:text-slate-200"
        title="Remove"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function AttachmentDisplay({ a }: { a: Attachment }) {
  const isImg = /^image\//i.test(a.type);
  if (isImg && a.data_url) {
    return (
      <a href={a.data_url} target="_blank" rel="noreferrer" className="block">
        <img
          src={a.data_url}
          alt={a.name}
          className="max-h-48 max-w-[280px] rounded border border-[#1f1f1f] object-contain"
        />
        <div className="mt-0.5 text-[11px] text-slate-500">{a.name} · {fmtBytes(a.size)}</div>
      </a>
    );
  }
  return (
    <a
      href={a.data_url ?? '#'}
      target="_blank"
      rel="noreferrer"
      download={a.name}
      className="inline-flex items-center gap-2 rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2 py-1.5 text-xs text-slate-300 hover:border-[#2a2a2a]"
    >
      <FileText size={14} className="text-slate-500" />
      <span className="max-w-[180px] truncate">{a.name}</span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-500">{fmtBytes(a.size)}</span>
    </a>
  );
}

function EmptyChatHint({ personas, onSend }: { personas: Personas; onSend: (text: string) => void }) {
  void personas; void onSend;
  return (
    <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-6">
      <div className="text-[15px] font-medium text-slate-100">Start a conversation with the team.</div>
      <div className="mt-1 text-sm text-slate-400">
        Seven agents are listening. Mention one with <code>@name</code> or send without and Max routes it. Open the Prompts panel for ideas grounded in recent activity.
      </div>
    </div>
  );
}
