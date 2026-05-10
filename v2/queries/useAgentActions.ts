// Agent v2 — pending-action audit log + resolution flow.
//
// Every time a write tool returns needs_confirmation, the runtime
// records a row here. The UI renders pending rows as confirm cards;
// the user's approve/reject flips status and re-triggers the agent.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import type { ToolResult } from '../agent/types';

export interface AgentActionRow {
  id: string;
  threadId: string;
  toolUseId: string;
  toolName: string;
  mode: 'read' | 'write' | 'destructive';
  input: Record<string, unknown>;
  preview: ToolResult['preview'] | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed' | 'expired';
  resultSummary: string | null;
  userId: string;
  companyId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const COLS = 'id, "threadId", "toolUseId", "toolName", mode, input, preview, status, "resultSummary", "userId", "companyId", "createdAt", "resolvedAt"';

function makeId(): string {
  return `AGA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function usePendingAgentActions(threadId: string | null) {
  return useQuery<AgentActionRow[], Error>({
    queryKey: ['agent', 'actions', 'pending', threadId ?? 'none'],
    enabled: !!threadId,
    queryFn: async () => {
      if (!threadId) return [];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('agent_actions').select(COLS)
        .eq('threadId', threadId)
        .eq('status', 'pending')
        .order('createdAt', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as unknown as AgentActionRow[]) ?? [];
    },
    refetchInterval: 2000,
  });
}

export function useResolveAgentAction() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; approved: boolean }>({
    mutationFn: async ({ id, approved }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('agent_actions').update({
        status: approved ? 'approved' : 'rejected',
        resolvedAt: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent', 'actions'] });
    },
  });
}

// ── Service functions (runtime uses these, not React) ─────────────────

export async function recordPendingAction(args: {
  threadId: string;
  toolUseId: string;
  toolName: string;
  mode: 'read' | 'write' | 'destructive';
  input: Record<string, unknown>;
  preview: NonNullable<ToolResult['preview']>;
  userId: string;
  companyId: string | null;
}): Promise<AgentActionRow> {
  const supabase = getSupabaseClient();
  const row = {
    id: makeId(),
    threadId: args.threadId,
    toolUseId: args.toolUseId,
    toolName: args.toolName,
    mode: args.mode,
    input: args.input,
    preview: args.preview,
    status: 'pending' as const,
    userId: args.userId,
    companyId: args.companyId,
  };
  const { data, error } = await supabase.from('agent_actions').insert(row).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as unknown as AgentActionRow;
}

export async function markActionCompleted(
  toolUseId: string,
  summary: string,
  failed = false,
): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.from('agent_actions').update({
    status: failed ? 'failed' : 'completed',
    resultSummary: summary,
    resolvedAt: new Date().toISOString(),
  }).eq('toolUseId', toolUseId);
}
