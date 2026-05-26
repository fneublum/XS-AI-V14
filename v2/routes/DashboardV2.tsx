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
import { MessageSquare, Send, RefreshCw } from 'lucide-react';
import { Card, CardBody, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import { cn } from '../primitives/utils';

// ─── Config ────────────────────────────────────────────────────────────

const CONTROL_PLANE_URL =
  (typeof window !== 'undefined' && (window as any).XS_AGENTIC_URL) ||
  import.meta.env.VITE_AGENTIC_URL ||
  '/xs-agentic';

// ─── Types ─────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'agent' | 'system';
  author: string;
  to_agent: string | null;
  content: string;
  meta: Record<string, any>;
  created_at: string;
}

interface Persona {
  display: string;
  role: string;
  voice: string;
}
type Personas = Record<string, Persona>;

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

// Markup @mentions in user messages so they stand out.
function renderContent(content: string, role: 'user' | 'agent' | 'system') {
  if (role !== 'user') return content;
  const parts = content.split(/(@(?:max|lara|matt|logan|sal|beth))\b/i);
  return parts.map((p, i) => {
    if (/^@(max|lara|matt|logan|sal|beth)$/i.test(p)) {
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
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setInput('');
    // Optimistically append the user message so it shows up immediately.
    const optimistic: ChatMessage = {
      id: 'opt-' + Date.now(),
      conversation_id: 'default',
      role: 'user',
      author: 'felipe',
      to_agent: null,
      content,
      meta: {},
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    setMessages(m => [...m, optimistic]);
    try {
      await api('POST', '/chat/message', { conversation_id: 'default', content });
      await refresh();
    } catch (err: any) {
      toast.push({ kind: 'error', title: err.message ?? 'send failed' });
      // Roll back the optimistic message; refresh will re-pull truth.
      setMessages(m => m.filter(x => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function mention(agent: string) {
    const at = '@' + agent + ' ';
    setInput(prev => prev.startsWith(at) ? prev : at + prev);
    // Focus the textarea after the click.
    setTimeout(() => {
      const ta = document.getElementById('chat-composer') as HTMLTextAreaElement | null;
      ta?.focus();
    }, 0);
  }

  const agentOrder = ['max', 'lara', 'matt', 'logan', 'sal', 'beth'];

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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr] gap-3">
        {/* Roster */}
        <Card className="flex flex-col">
          <CardBody className="space-y-1">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Team</div>
            {agentOrder.map(id => {
              const p = personas[id];
              return (
                <button
                  key={id}
                  onClick={() => mention(id)}
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
                    <div className="truncate text-[11px] text-slate-500">{p?.role ?? ''}</div>
                  </span>
                </button>
              );
            })}
            <div className="pt-3 text-[10px] text-slate-600">
              Click a teammate to @-mention them in the composer.
            </div>
          </CardBody>
        </Card>

        {/* Chat column */}
        <Card className="flex min-h-0 flex-col">
          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && connected !== false && (
              <EmptyChatHint personas={personas} onMention={mention} />
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
              <textarea
                id="chat-composer"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={"Message the team… '@matt anything overdue?'  ·  Enter to send, Shift+Enter for new line"}
                rows={2}
                className="w-full resize-none bg-transparent p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
              />
              <div className="flex items-center justify-between border-t border-[#1f1f1f] px-3 py-2 text-[11px] text-slate-500">
                <span>
                  Tip: prefix with{' '}
                  {agentOrder.slice(0, 3).map(id => (
                    <button
                      key={id}
                      onClick={() => mention(id)}
                      className={cn('mx-0.5 rounded bg-[#141414] px-1.5 py-0.5 font-medium', AGENT_TONE[id])}
                    >@{id}</button>
                  ))}
                  to route to a teammate, or send without and Max takes it.
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={send}
                  disabled={sending || !input.trim()}
                >
                  <Send size={14} className="mr-1" /> Send
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function MessageBubble({ m, personas }: { m: ChatMessage; personas: Personas }) {
  const isUser = m.role === 'user';
  const author = m.author;
  const display = isUser ? 'You' : (personas[author]?.display ?? author);
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
          {renderContent(m.content, m.role)}
        </div>
      </div>
    </div>
  );
}

function EmptyChatHint({ personas, onMention }: { personas: Personas; onMention: (id: string) => void }) {
  const examples = [
    { agent: 'max', text: 'what is the status across the team?' },
    { agent: 'matt', text: 'anything overdue in AR right now?' },
    { agent: 'logan', text: 'any shipments at risk this week?' },
    { agent: 'sal', text: 'is the FIBERTEX proforma ready to send?' },
  ];
  return (
    <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-6">
      <div className="text-[15px] font-medium text-slate-100">Start a conversation with the team.</div>
      <div className="mt-1 text-sm text-slate-400">
        Six agents are listening. Mention one with <code>@name</code> or send without and Max routes it.
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {examples.map(e => (
          <button
            key={e.text}
            onClick={() => {
              onMention(e.agent);
              const ta = document.getElementById('chat-composer') as HTMLTextAreaElement | null;
              if (ta) { ta.value = `@${e.agent} ${e.text}`; ta.dispatchEvent(new Event('input', { bubbles: true })); }
            }}
            className="rounded border border-[#1f1f1f] bg-[#141414] px-3 py-2 text-left text-sm text-slate-300 hover:border-[#2a2a2a] hover:text-slate-100"
          >
            <span className={cn('mr-1.5 font-medium', AGENT_TONE[e.agent])}>@{e.agent}</span>
            {e.text}
          </button>
        ))}
      </div>
    </div>
  );
}
