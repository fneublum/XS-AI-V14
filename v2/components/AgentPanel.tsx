// Agent v2 — in-app chat panel.
//
// Side-drawer UI that carries a conversation with the XS Agent. Loads
// an existing thread (or creates a fresh one), streams turns from
// agent_messages via TanStack Query, shows pending confirmations as
// approve/reject cards, and posts new user text through the runtime.
//
// Kept separate from the legacy AiCopilotSidebar / WhatsAppChatWidget.
// Mount behind the `agentV2` feature flag.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import {
  useAgentMessages,
  useAgentThreads,
  useCreateAgentThread,
} from '../queries/useAgentThreads';
import {
  usePendingAgentActions,
  useResolveAgentAction,
  type AgentActionRow,
} from '../queries/useAgentActions';
import { invokeAgent } from '../agent/runtime';
import { composeUserTurnText } from '../agent/multimodal';
import type { AgentMessageContent } from '../agent/types';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const AgentPanel: React.FC<Props> = ({ open, onClose }) => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();
  const qc = useQueryClient();

  const threadsQ = useAgentThreads(user?.id ?? null, currentCompanyId);
  const createThread = useCreateAgentThread();
  const [threadId, setThreadId] = useState<string | null>(null);

  // Auto-select the most recent thread once the list loads.
  useEffect(() => {
    if (!threadId && threadsQ.data && threadsQ.data.length > 0) {
      setThreadId(threadsQ.data[0].id);
    }
  }, [threadId, threadsQ.data]);

  const messagesQ = useAgentMessages(threadId);
  const pendingQ = usePendingAgentActions(threadId);
  const resolve = useResolveAgentAction();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = messagesQ.data ?? [];
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, pendingQ.data?.length]);

  const ensureThread = async (): Promise<string> => {
    if (threadId) return threadId;
    const t = await createThread.mutateAsync({
      userId: user!.id,
      companyId: currentCompanyId === 'ALL' ? null : currentCompanyId,
      channel: 'in_app',
    });
    setThreadId(t.id);
    return t.id;
  };

  const invalidate = (tid: string) => {
    void qc.invalidateQueries({ queryKey: ['agent', 'messages', tid] });
    void qc.invalidateQueries({ queryKey: ['agent', 'actions', 'pending', tid] });
    void qc.invalidateQueries({ queryKey: ['agent', 'threads'] });
  };

  const send = async (extra?: { audio?: Blob; file?: Blob }) => {
    if (!user || busy) return;
    const hasText = !!input.trim();
    if (!hasText && !extra?.audio && !extra?.file && !attachedFile) return;

    const text = input.trim();
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const composed = await composeUserTurnText({
        text,
        audio: extra?.audio,
        file: extra?.file ?? attachedFile ?? undefined,
      });
      setAttachedFile(null);
      const tid = await ensureThread();
      await invokeAgent({
        threadId: tid,
        userId: user.id,
        companyId: currentCompanyId,
        channel: 'in_app',
        userText: composed,
      });
      invalidate(tid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Agent request failed');
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (recording || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) audioChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mime });
        audioChunksRef.current = [];
        void send({ audio: blob });
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (!recording || !recorderRef.current) return;
    setRecording(false);
    recorderRef.current.stop();
    recorderRef.current = null;
  };

  const handleResolve = async (action: AgentActionRow, approved: boolean) => {
    if (!user || !threadId) return;
    setBusy(true);
    setError(null);
    try {
      await resolve.mutateAsync({ id: action.id, approved });
      await invokeAgent({
        threadId,
        userId: user.id,
        companyId: currentCompanyId,
        channel: 'in_app',
        userText: '',
        pendingApproval: { toolUseId: action.toolUseId, approved },
      });
      invalidate(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed');
    } finally {
      setBusy(false);
    }
  };

  const startNewThread = async () => {
    if (!user) return;
    const t = await createThread.mutateAsync({
      userId: user.id,
      companyId: currentCompanyId === 'ALL' ? null : currentCompanyId,
      channel: 'in_app',
    });
    setThreadId(t.id);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[420px] bg-[#0a0a0a] border-l border-[#1f1f1f] flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
      <header className="flex items-center justify-between px-3 h-11 border-b border-[#1f1f1f]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <h3 className="text-[13px] font-semibold text-slate-200">XS Agent</h3>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">beta</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewThread}
            className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-[#1f1f1f]"
            title="New conversation"
          >New</button>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-[#1f1f1f] text-sm"
            aria-label="Close"
          >×</button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && !pendingQ.data?.length && (
          <div className="text-center text-slate-500 text-[12px] py-8">
            <p className="mb-2">Ask the agent anything about your ERP.</p>
            <p className="text-[10px] text-slate-600">Try: "list 5 customers" or "find invoice INV-123".</p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg.content} />
        ))}

        {pendingQ.data?.map(action => (
          <ConfirmCard
            key={action.id}
            action={action}
            busy={busy}
            onApprove={() => handleResolve(action, true)}
            onReject={() => handleResolve(action, false)}
          />
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-slate-500 text-[11px] px-2">
            <span className="inline-block h-1.5 w-1.5 bg-slate-500 rounded-full animate-pulse" />
            <span>Thinking…</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-900 bg-rose-950/40 text-rose-300 text-[11px] px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <footer className="border-t border-[#1f1f1f] p-2 space-y-1.5">
        {attachedFile && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 px-1">
            <span className="truncate">📎 {attachedFile.name}</span>
            <button
              onClick={() => setAttachedFile(null)}
              className="text-slate-500 hover:text-slate-300"
            >×</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) setAttachedFile(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Attach file"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-[#1f1f1f] bg-[#111111] text-slate-400 hover:text-slate-200 hover:border-[#2a2a2a] disabled:opacity-50"
          >📎</button>
          <button
            onMouseDown={() => void startRecording()}
            onMouseUp={stopRecording}
            onMouseLeave={() => { if (recording) stopRecording(); }}
            onTouchStart={() => void startRecording()}
            onTouchEnd={stopRecording}
            disabled={busy}
            title={recording ? 'Recording… release to send' : 'Hold to record voice'}
            className={`h-8 w-8 flex items-center justify-center rounded-md border ${recording ? 'border-rose-700 bg-rose-900/40 text-rose-300 animate-pulse' : 'border-[#1f1f1f] bg-[#111111] text-slate-400 hover:text-slate-200 hover:border-[#2a2a2a]'} disabled:opacity-50`}
          >🎤</button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message the agent…"
            rows={2}
            disabled={busy}
            className="flex-1 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12px] text-slate-200 resize-none placeholder:text-slate-600 focus:outline-none focus:border-indigo-700"
          />
          <button
            onClick={() => void send()}
            disabled={busy || (!input.trim() && !attachedFile)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 h-8 px-3 text-[12px] font-medium rounded-md"
          >Send</button>
        </div>
      </footer>
    </div>
  );
};

const MessageBubble: React.FC<{ msg: AgentMessageContent }> = ({ msg }) => {
  if (msg.role === 'user') {
    if (!msg.text && !msg.toolResults?.length) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md bg-indigo-900/40 border border-indigo-800 px-2.5 py-1.5 text-[12px] text-slate-100 whitespace-pre-wrap">
          {msg.text || <span className="text-slate-400 italic">[tool results]</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {msg.text && (
        <div className="max-w-[85%] rounded-md bg-[#151515] border border-[#1f1f1f] px-2.5 py-1.5 text-[12px] text-slate-200 whitespace-pre-wrap">
          {msg.text}
        </div>
      )}
      {msg.toolCalls?.map(tc => (
        <div key={tc.id} className="max-w-[85%] text-[10px] text-slate-500 px-2 font-mono">
          → {tc.name}({Object.keys(tc.input).slice(0, 3).join(', ')})
        </div>
      ))}
    </div>
  );
};

const ConfirmCard: React.FC<{
  action: AgentActionRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}> = ({ action, busy, onApprove, onReject }) => {
  const preview = action.preview;
  const isDestructive = action.mode === 'destructive';
  const borderClass = isDestructive ? 'border-rose-900' : 'border-amber-900';
  const bgClass = isDestructive ? 'bg-rose-950/20' : 'bg-amber-950/20';
  const details = useMemo(() => {
    if (!preview?.details) return [];
    return Object.entries(preview.details).slice(0, 8);
  }, [preview]);

  return (
    <div className={`rounded-md border ${borderClass} ${bgClass} px-3 py-2 text-[12px] text-slate-200`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDestructive ? 'text-rose-400' : 'text-amber-400'}`}>
          {isDestructive ? 'Destructive action' : 'Confirm write'}
        </span>
      </div>
      <div className="font-medium mb-1">{preview?.action ?? action.toolName}</div>
      {details.length > 0 && (
        <ul className="text-[11px] text-slate-400 space-y-0.5 mb-2 font-mono">
          {details.map(([k, v]) => (
            <li key={k}>
              <span className="text-slate-500">{k}:</span>{' '}
              <span className="text-slate-300">{String(v).slice(0, 80)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 text-white h-6 px-2.5 text-[11px] font-medium rounded"
        >Approve</button>
        <button
          onClick={onReject}
          disabled={busy}
          className="bg-[#1f1f1f] hover:bg-[#2a2a2a] disabled:opacity-50 text-slate-200 h-6 px-2.5 text-[11px] font-medium rounded border border-[#2a2a2a]"
        >Reject</button>
      </div>
    </div>
  );
};
