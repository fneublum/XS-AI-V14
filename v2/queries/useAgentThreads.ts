// Agent v2 — thread + message persistence (TanStack Query).
//
// Reads are cached by thread id; every mutation invalidates the
// matching thread so the chat UI picks up new turns after the runtime
// appends them. Writes hit Supabase directly — runtime functions also
// persist via the service helpers below (not through React).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import type { AgentMessageContent } from '../agent/types';

export interface AgentThreadRow {
  id: string;
  userId: string;
  companyId: string | null;
  channel: 'in_app' | 'whatsapp';
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRow {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: AgentMessageContent;
  createdAt: string;
}

const THREAD_COLS = 'id, "userId", "companyId", channel, title, "createdAt", "updatedAt"';
const MESSAGE_COLS = 'id, "threadId", role, content, "createdAt"';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ── Hooks ──────────────────────────────────────────────────────────────

export function useAgentThreads(userId: string | null, companyId: string | null) {
  return useQuery<AgentThreadRow[], Error>({
    queryKey: ['agent', 'threads', userId ?? 'none', companyId ?? 'ALL'],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('agent_threads').select(THREAD_COLS)
        .order('updatedAt', { ascending: false })
        .limit(50);
      if (userId) q = q.eq('userId', userId);
      if (companyId && companyId !== 'ALL') q = q.eq('companyId', companyId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as unknown as AgentThreadRow[]) ?? [];
    },
  });
}

export function useAgentMessages(threadId: string | null) {
  return useQuery<AgentMessageRow[], Error>({
    queryKey: ['agent', 'messages', threadId ?? 'none'],
    enabled: !!threadId,
    queryFn: async () => {
      if (!threadId) return [];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('agent_messages').select(MESSAGE_COLS)
        .eq('threadId', threadId)
        .order('createdAt', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as unknown as AgentMessageRow[]) ?? [];
    },
  });
}

export function useCreateAgentThread() {
  const qc = useQueryClient();
  return useMutation<AgentThreadRow, Error, { userId: string; companyId: string | null; channel: 'in_app' | 'whatsapp'; title?: string }>({
    mutationFn: async (args) => {
      const supabase = getSupabaseClient();
      const row = {
        id: makeId('THR'),
        userId: args.userId,
        companyId: args.companyId,
        channel: args.channel,
        title: args.title ?? null,
      };
      const { data, error } = await supabase.from('agent_threads').insert(row).select(THREAD_COLS).single();
      if (error) throw new Error(error.message);
      return data as unknown as AgentThreadRow;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent', 'threads'] });
    },
  });
}

// ── Service functions (used by runtime + webhook, not by React) ────────

export async function insertAgentMessage(
  threadId: string,
  msg: AgentMessageContent,
): Promise<AgentMessageRow> {
  const supabase = getSupabaseClient();
  const row = {
    id: makeId('MSG'),
    threadId,
    role: msg.role,
    content: msg,
  };
  const { data, error } = await supabase.from('agent_messages').insert(row).select(MESSAGE_COLS).single();
  if (error) throw new Error(error.message);
  await touchThread(threadId);
  return data as unknown as AgentMessageRow;
}

export async function loadAgentHistory(threadId: string): Promise<AgentMessageContent[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('agent_messages').select('content, "createdAt"')
    .eq('threadId', threadId)
    .order('createdAt', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as Array<{ content: AgentMessageContent }> | null) ?? []).map(r => r.content);
}

export async function getOrCreateThreadForWhatsApp(
  phone: string,
  userId: string,
  companyId: string | null,
): Promise<AgentThreadRow> {
  const supabase = getSupabaseClient();
  const id = `THR-WA-${phone.replace(/\D/g, '')}`;
  const { data: existing } = await supabase.from('agent_threads').select(THREAD_COLS).eq('id', id).maybeSingle();
  if (existing) return existing as unknown as AgentThreadRow;
  const row = {
    id,
    userId,
    companyId,
    channel: 'whatsapp' as const,
    title: `WhatsApp ${phone}`,
  };
  const { data, error } = await supabase.from('agent_threads').insert(row).select(THREAD_COLS).single();
  if (error) throw new Error(error.message);
  return data as unknown as AgentThreadRow;
}

async function touchThread(threadId: string): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.from('agent_threads').update({ updatedAt: new Date().toISOString() }).eq('id', threadId);
}
