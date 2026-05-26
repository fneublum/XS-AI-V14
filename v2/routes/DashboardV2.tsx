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
import { MessageSquare, Send, RefreshCw, Paperclip, X, FileText, Image as ImageIcon, UploadCloud } from 'lucide-react';
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dragActive, setDragActive] = useState(false);
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

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const content = input.trim();
    if ((!content && attachments.length === 0) || sending) return;
    setSending(true);
    const sentContent = content;
    const sentAttachments = attachments;
    setInput('');
    setAttachments([]);
    // Optimistically append the user message so it shows up immediately.
    const optimistic: ChatMessage = {
      id: 'opt-' + Date.now(),
      conversation_id: 'default',
      role: 'user',
      author: 'felipe',
      to_agent: null,
      content: sentContent || `(sent ${sentAttachments.length} attachment${sentAttachments.length === 1 ? '' : 's'})`,
      meta: sentAttachments.length > 0 ? { attachments: sentAttachments } : {},
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    setMessages(m => [...m, optimistic]);
    try {
      await api('POST', '/chat/message', {
        conversation_id: 'default',
        content: sentContent,
        attachments: sentAttachments,
      });
      await refresh();
    } catch (err: any) {
      toast.push({ kind: 'error', title: err.message ?? 'send failed' });
      // Roll back the optimistic message; refresh will re-pull truth.
      setMessages(m => m.filter(x => x.id !== optimistic.id));
      // Restore the composer so the user doesn't lose work.
      setInput(sentContent);
      setAttachments(sentAttachments);
    } finally {
      setSending(false);
    }
  }

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

        {/* Chat column */}
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
      </div>
    </div>
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
