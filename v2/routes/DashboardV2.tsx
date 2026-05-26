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
import { MessageSquare, Send, RefreshCw, Paperclip, X, FileText, Image as ImageIcon, UploadCloud, Trash2, LayoutGrid, Sparkles, ArrowLeft, Clock } from 'lucide-react';
import { Card, CardBody, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import { cn } from '../primitives/utils';

// ─── Config ────────────────────────────────────────────────────────────

const CONTROL_PLANE_URL =
  (typeof window !== 'undefined' && (window as any).XS_AGENTIC_URL) ||
  import.meta.env.VITE_AGENTIC_URL ||
  '/xs-agentic';

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
  const res = await fetch(CONTROL_PLANE_URL + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-actor': 'felipe' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(data?.error ?? text ?? `${res.status} ${res.statusText}`);
  return data as T;
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
  felipe: 'ring-emerald-500/40 bg-emerald-500/15',
  system: 'ring-slate-500/40 bg-slate-500/10',
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
  const parts = content.split(/(@(?:max|lara|matt|logan|sal|beth|gem))\b/i);
  return parts.map((p, i) => {
    if (/^@(max|lara|matt|logan|sal|beth|gem)$/i.test(p)) {
      const agent = p.slice(1).toLowerCase();
      return <span key={i} className={cn('rounded px-1 font-medium', AGENT_TONE[agent])}>{p}</span>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const list = await api<ChatMessage[]>('GET', '/chat/messages?limit=300');
      setMessages(list);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api<Personas>('GET', '/chat/personas').then(setPersonas).catch(() => {});
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Lazy-load Overview / Suggestions on first switch into those modes,
  // and refresh whenever the user re-enters that mode.
  useEffect(() => {
    if (mode === 'overview') {
      api<Overview>('GET', '/chat/overview').then(setOverview).catch(() => setOverview(null));
    } else if (mode === 'prompts') {
      api<Suggestions>('GET', '/chat/suggestions').then(setSuggestions).catch(() => setSuggestions(null));
    } else if (mode === 'crons') {
      api<CronsPayload>('GET', '/chat/crons').then(setCrons).catch(() => setCrons(null));
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
  const agentOrder = ['max', 'lara', 'matt', 'logan', 'sal', 'gem'];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Greeting header */}
      <div className="flex shrink-0 items-center gap-3">
        <MessageSquare size={20} className="text-emerald-400" />
        <h1 className="text-[20px] font-semibold tracking-tight text-slate-100">Team chat</h1>
        <span className="text-slate-700">·</span>
        <span className="text-[13px] text-slate-500">
          {connected === false
            ? <span className="text-red-400">control-plane unreachable</span>
            : connected === null
              ? 'connecting…'
              : <>polling · {messages.length} {messages.length === 1 ? 'message' : 'messages'}</>
          }
        </span>
        <span className="ml-auto" />
        <Button variant="ghost" onClick={refresh}><RefreshCw size={14} className="mr-1" />refresh</Button>
        <Button
          variant="ghost"
          onClick={async () => {
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
          }}
        >
          <Trash2 size={14} className="mr-1" />clear
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[154px_1fr] gap-3">
        {/* Left column: mode buttons + roster */}
        <Card className="flex flex-col">
          <CardBody className="space-y-1">
            {/* Mode buttons sit above the TEAM roster. */}
            <button
              onClick={() => setMode(mode === 'overview' ? 'chat' : 'overview')}
              className={cn(
                'flex w-full items-center gap-2 rounded border p-2 text-left transition-colors',
                mode === 'overview'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[#1f1f1f] bg-[#0f0f0f] text-slate-300 hover:border-[#2a2a2a]',
              )}
            >
              <LayoutGrid size={14} />
              <span className="text-sm font-medium">Overview</span>
            </button>
            <button
              onClick={() => setMode(mode === 'prompts' ? 'chat' : 'prompts')}
              className={cn(
                'flex w-full items-center gap-2 rounded border p-2 text-left transition-colors',
                mode === 'prompts'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[#1f1f1f] bg-[#0f0f0f] text-slate-300 hover:border-[#2a2a2a]',
              )}
            >
              <Sparkles size={14} />
              <span className="text-sm font-medium">Prompts</span>
            </button>
            <button
              onClick={() => setMode(mode === 'crons' ? 'chat' : 'crons')}
              className={cn(
                'flex w-full items-center gap-2 rounded border p-2 text-left transition-colors',
                mode === 'crons'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[#1f1f1f] bg-[#0f0f0f] text-slate-300 hover:border-[#2a2a2a]',
              )}
            >
              <Clock size={14} />
              <span className="text-sm font-medium">Crons</span>
            </button>

            <div className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Team</div>
            {agentOrder.map(id => {
              const p = personas[id];
              return (
                <button
                  key={id}
                  onClick={() => { setMode('chat'); mention(id); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded p-2 text-left transition-colors',
                    'border border-transparent hover:border-[#2a2a2a] hover:bg-[#141414]',
                  )}
                  title={p?.role ?? id}
                >
                  <span className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
                    AGENT_RING[id], AGENT_TONE[id],
                  )}>
                    {initials(p?.display ?? id)}
                  </span>
                  <span className="min-w-0">
                    <div className={cn('text-sm font-medium', AGENT_TONE[id])}>{p?.display ?? id}</div>
                    <div className="truncate text-[11px] text-slate-500">{p?.tag ?? ''}</div>
                  </span>
                </button>
              );
            })}
            <div className="pt-3 text-[10px] text-slate-600">
              Click a teammate to @-mention them in the composer.
            </div>
          </CardBody>
        </Card>

        {/* Right column — chat OR overview OR prompts */}
        {mode === 'overview' && (
          <OverviewPanel
            data={overview}
            personas={personas}
            onBack={() => setMode('chat')}
            onSend={(t) => { setMode('chat'); sendText(t); }}
          />
        )}
        {mode === 'prompts' && (
          <PromptsPanel
            data={suggestions}
            personas={personas}
            onBack={() => setMode('chat')}
            onSend={(t) => { setMode('chat'); sendText(t); }}
          />
        )}
        {mode === 'crons' && (
          <CronsPanel
            data={crons}
            personas={personas}
            onBack={() => setMode('chat')}
          />
        )}
        {mode === 'chat' && (
        <Card
          className="relative flex min-h-0 flex-col"
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Drag overlay */}
          {dragActive && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-emerald-300">
                <UploadCloud size={28} />
                <span className="text-sm font-medium">Drop files to attach to your next message</span>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && connected !== false && (
              <EmptyChatHint personas={personas} onSend={sendText} />
            )}
            {connected === false && (
              <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
                Control-plane unreachable at <code>{CONTROL_PLANE_URL}</code>. Start it:
                <code className="ml-1">cd ~/Desktop/XS-agentic/services/control-plane && PORT=7878 npm start</code>
              </div>
            )}
            {messages.map(m => <MessageBubble key={m.id} m={m} personas={personas} />)}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                replying…
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-[#1f1f1f] p-3">
            <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] focus-within:border-[#2a2a2a]">
              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 border-b border-[#1f1f1f] p-2">
                  {attachments.map((a, i) => (
                    <AttachmentChip
                      key={i}
                      a={a}
                      onRemove={() => removeAttachment(i)}
                    />
                  ))}
                </div>
              )}
              <textarea
                id="chat-composer"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={"Message the team… '@matt anything overdue?'  ·  Paste, drop, or attach files  ·  Enter to send"}
                rows={2}
                className="w-full resize-none bg-transparent p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={e => { addFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              />
              <div className="flex items-center justify-between gap-2 border-t border-[#1f1f1f] px-3 py-2 text-[11px] text-slate-500">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-400 hover:bg-[#141414] hover:text-slate-200"
                  title="Attach file"
                >
                  <Paperclip size={14} />
                  attach
                </button>
                <span className="min-w-0 flex-1 truncate">
                  Drop, paste, or attach files (up to 2 MB each, 8 per message). Files routed to{' '}
                  <button onClick={() => mention('lara')} className={cn('rounded bg-[#141414] px-1.5 py-0.5 font-medium', AGENT_TONE.lara)}>@lara</button>
                  {' '}by default for OCR + ERP ingestion.
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={send}
                  disabled={sending || (!input.trim() && attachments.length === 0)}
                >
                  <Send size={14} className="mr-1" /> Send
                </Button>
              </div>
            </div>
          </div>
        </Card>
        )}
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
  const agentOrder = ['max','lara','matt','logan','sal','gem'];
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
                      {initials(p?.display ?? id)}
                    </span>
                    <div className="min-w-0">
                      <div className={cn('text-sm font-semibold', AGENT_TONE[id])}>{p?.display ?? id}</div>
                      <div className="text-[11px] text-slate-500">{p?.tag ?? ''}</div>
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
                        Ask {p?.display ?? id} to walk me through →
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
  const agentOrder = ['max','lara','matt','logan','sal','gem'];
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
                      {initials(p?.display ?? id)}
                    </span>
                    <span className={cn('text-sm font-semibold', AGENT_TONE[id])}>{p?.display ?? id}</span>
                    <span className="text-xs text-slate-500">{p?.tag ?? ''}</span>
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
