// Agent v2 — runtime bridge.
//
// Wraps `runAgent()` with persistence: load thread history, call the
// loop, persist each new turn, record any needs_confirmation as an
// `agent_actions` row. The React UI (AgentPanel) calls this, and the
// WhatsApp webhook edge function uses the same shape server-side.

import { runAgent } from './runAgent';
import { insertAgentMessage, loadAgentHistory } from '../queries/useAgentThreads';
import { markActionCompleted, recordPendingAction } from '../queries/useAgentActions';
import { getTool } from './registry';
import type {
  AgentMessageContent,
  RunAgentInput,
  RunAgentOutput,
} from './types';

export interface RuntimeInvokeArgs {
  threadId: string;
  userId: string;
  companyId: string;
  channel: 'in_app' | 'whatsapp';
  userText: string;
  /** Attachment reference (Supabase storage path) — stored on the turn. */
  mediaRef?: string;
  /** If the user just resolved a pending action, feed that in. */
  pendingApproval?: { toolUseId: string; approved: boolean };
}

export interface RuntimeInvokeResult extends RunAgentOutput {}

/**
 * Full round-trip: load history, run agent, persist new turns, flag
 * any pending action for confirmation. Idempotent at the message level
 * in the sense that re-calling with the same pendingApproval will
 * simply replay and insert more rows — callers should gate on the
 * approval-UI side.
 */
export async function invokeAgent(args: RuntimeInvokeArgs): Promise<RuntimeInvokeResult> {
  const history = await loadAgentHistory(args.threadId);

  let userTurn: AgentMessageContent;
  if (args.pendingApproval) {
    // Approval resume: there's no new user text — we just unpause the
    // conversation. The loop replays via pendingApproval.
    userTurn = {
      role: 'user',
      text: args.pendingApproval.approved ? '(approved)' : '(rejected)',
    };
  } else {
    userTurn = {
      role: 'user',
      text: args.userText,
      mediaRef: args.mediaRef,
    };
    await insertAgentMessage(args.threadId, userTurn);
  }

  const input: RunAgentInput = {
    threadId: args.threadId,
    userId: args.userId,
    companyId: args.companyId,
    channel: args.channel,
    history,
    userTurn,
    pendingApproval: args.pendingApproval,
  };

  const output = await runAgent(input);

  // Persist every new turn the loop produced. Skip re-persisting the
  // user turn we already inserted above.
  const turnsToPersist = args.pendingApproval ? output.newTurns : output.newTurns.filter(t => t !== userTurn);
  for (const turn of turnsToPersist) {
    await insertAgentMessage(args.threadId, turn);
  }

  // If the loop paused on a needs_confirmation, persist the action row
  // so the UI can render the confirm card. The toolUseId already lives
  // inside the last assistant turn's toolCalls.
  if (output.awaitingApproval) {
    const last = [...output.newTurns].reverse().find(t => t.role === 'assistant' && t.toolCalls?.length);
    const pending = last?.toolCalls?.find(tc => tc.id === output.awaitingApproval!.toolUseId);
    if (pending) {
      const def = getTool(pending.name);
      await recordPendingAction({
        threadId: args.threadId,
        toolUseId: pending.id,
        toolName: pending.name,
        mode: def?.mode ?? 'write',
        input: pending.input,
        preview: output.awaitingApproval.preview,
        userId: args.userId,
        companyId: args.companyId === 'ALL' ? null : args.companyId,
      });
    }
  }

  // If an approval WAS resolved this turn, mark the corresponding
  // action row as completed (best-effort — approve-path failure just
  // leaves the row in 'approved' state, which is still informative).
  if (args.pendingApproval) {
    const lastToolResults = [...output.newTurns].reverse().find(t => t.toolResults?.length);
    const match = lastToolResults?.toolResults?.find(tr => tr.toolUseId === args.pendingApproval!.toolUseId);
    if (match) {
      await markActionCompleted(args.pendingApproval.toolUseId, match.result.summary, match.result.kind === 'error');
    }
  }

  return output;
}
