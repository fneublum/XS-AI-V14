// Agent v2 — main loop.
//
// One `runAgent()` call drives a Claude tool-calling conversation to
// completion (or until it has to pause for human approval). Callers
// pass in the full prior history; the runtime serializes it into
// Messages-API shape, iterates with Claude until `stop_reason=end_turn`
// or a write tool returns `needs_confirmation`, and returns the new
// turns plus any pending-approval handle.
//
// Resumption: when the user approves/rejects via the UI, the caller
// re-invokes `runAgent()` with `pendingApproval={ toolUseId, approved }`.
// The loop replays history, re-executes the paused tool with
// `ctx.approved=true` (or returns a synthetic "rejected" tool_result),
// then continues the conversation from there.

import './tools/entities'; // side-effect: registers the 7 CRUD tools
import { callClaude, DEFAULT_AGENT_MODEL, type ClaudeContentBlock, type ClaudeMessage } from './anthropicClient';
import { getTool, toolsForClaude } from './registry';
import { buildSystemPrompt } from './systemPrompt';
import type {
  AgentMessageContent,
  AgentToolCall,
  RunAgentInput,
  RunAgentOutput,
  ToolContext,
  ToolResult,
} from './types';

const DEFAULT_MAX_STEPS = 8;

/**
 * Convert our flat AgentMessageContent history into the Messages-API
 * `messages[]` shape. Assistant turns with tool_calls become
 * content-block arrays; user turns carrying tool_results become
 * content-block arrays with tool_result blocks. Plain text turns
 * collapse to a string so the wire payload stays small.
 */
function toClaudeMessages(history: AgentMessageContent[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  for (const turn of history) {
    if (turn.role === 'assistant') {
      const blocks: ClaudeContentBlock[] = [];
      if (turn.text) blocks.push({ type: 'text', text: turn.text });
      if (turn.toolCalls?.length) {
        for (const tc of turn.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
      }
      if (blocks.length === 0) continue;
      out.push({ role: 'assistant', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks });
    } else {
      // user role — may carry either free text, tool_results, or both.
      if (turn.toolResults?.length) {
        const blocks: ClaudeContentBlock[] = turn.toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.toolUseId,
          content: serializeToolResult(tr.result),
          is_error: tr.result.kind === 'error',
        }));
        if (turn.text) blocks.unshift({ type: 'text', text: turn.text });
        out.push({ role: 'user', content: blocks });
      } else if (turn.text) {
        out.push({ role: 'user', content: turn.text });
      }
    }
  }
  return out;
}

/** Tool results go back to Claude as stringified JSON — it handles that
 *  fine and preserves the structure for reasoning. Keep summaries even
 *  on the error path so the model knows what happened. */
function serializeToolResult(r: ToolResult): string {
  if (r.kind === 'error') return JSON.stringify({ error: r.summary });
  if (r.kind === 'needs_confirmation') {
    return JSON.stringify({
      status: 'awaiting_human_approval',
      summary: r.summary,
      preview: r.preview,
    });
  }
  return JSON.stringify({ ok: true, summary: r.summary, data: r.data ?? null });
}

/** Extract assistant text + tool_use calls from a Claude response. */
function parseAssistantTurn(blocks: ClaudeContentBlock[]): {
  text: string;
  toolCalls: AgentToolCall[];
} {
  let text = '';
  const toolCalls: AgentToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'text') text += (text ? '\n' : '') + b.text;
    else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id, name: b.name, input: b.input ?? {} });
    }
  }
  return { text, toolCalls };
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const model = input.model ?? DEFAULT_AGENT_MODEL;

  // Build the running history we'll both send to Claude AND append to
  // on each iteration. Starts with the caller's history + the new user
  // turn (if not already in there).
  const history: AgentMessageContent[] = [...input.history];
  const lastIsUserTurn = history.length > 0
    && history[history.length - 1].role === 'user'
    && history[history.length - 1].text === input.userTurn.text
    && !input.userTurn.toolResults;
  if (!lastIsUserTurn) history.push(input.userTurn);

  const systemPrompt = buildSystemPrompt({
    channel: input.channel,
    companyId: input.companyId,
  });

  const newTurns: AgentMessageContent[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const resp = await callClaude({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: toClaudeMessages(history),
      tools: toolsForClaude(),
      metadata: { requestId: input.threadId, taskType: 'agent_loop' },
    });

    totalInputTokens += resp.usage?.input_tokens ?? 0;
    totalOutputTokens += resp.usage?.output_tokens ?? 0;

    const { text, toolCalls } = parseAssistantTurn(resp.content);
    const assistantTurn: AgentMessageContent = {
      role: 'assistant',
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    history.push(assistantTurn);
    newTurns.push(assistantTurn);

    // No tool calls + end_turn → conversation complete.
    if (toolCalls.length === 0) break;

    // Execute each tool call. Respect the pendingApproval payload on
    // THIS turn only — it resolves whichever tool_use the user just
    // approved/rejected. Any other tool_use on the same batch runs
    // without approval (→ needs_confirmation) as usual.
    const resultsForBatch: Array<{ toolUseId: string; result: ToolResult }> = [];
    let pausedForApproval: { toolUseId: string; preview: NonNullable<ToolResult['preview']> } | null = null;

    for (const call of toolCalls) {
      const tool = getTool(call.name);
      if (!tool) {
        resultsForBatch.push({
          toolUseId: call.id,
          result: { kind: 'error', summary: `Unknown tool: ${call.name}` },
        });
        continue;
      }

      const isApprovedForThisCall = !!input.pendingApproval
        && input.pendingApproval.toolUseId === call.id
        && input.pendingApproval.approved;
      const isRejectedForThisCall = !!input.pendingApproval
        && input.pendingApproval.toolUseId === call.id
        && !input.pendingApproval.approved;

      if (isRejectedForThisCall) {
        resultsForBatch.push({
          toolUseId: call.id,
          result: { kind: 'error', summary: 'User rejected this action. Do not retry; ask the user what they want instead.' },
        });
        continue;
      }

      const ctx: ToolContext = {
        userId: input.userId,
        companyId: input.companyId,
        threadId: input.threadId,
        channel: input.channel,
        approved: tool.mode === 'read' ? true : isApprovedForThisCall,
      };

      let result: ToolResult;
      try {
        result = await tool.execute(call.input, ctx);
      } catch (err) {
        result = {
          kind: 'error',
          summary: `Tool ${call.name} threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      resultsForBatch.push({ toolUseId: call.id, result });

      if (result.kind === 'needs_confirmation' && result.preview) {
        pausedForApproval = { toolUseId: call.id, preview: result.preview };
        // Don't run remaining tool calls in this batch — we need the
        // user to approve the pending one first. (Future: we could
        // parallelize independent reads, but easier reasoning if we
        // serialize around a pause.)
        break;
      }
    }

    const resultsTurn: AgentMessageContent = {
      role: 'user',
      toolResults: resultsForBatch,
    };
    history.push(resultsTurn);
    newTurns.push(resultsTurn);

    if (pausedForApproval) {
      return {
        newTurns,
        awaitingApproval: pausedForApproval,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, steps: steps + 1 },
      };
    }

    // pendingApproval only applies to one turn — clear it for subsequent
    // iterations so re-entry doesn't silently approve later tool_uses.
    input.pendingApproval = undefined;

    if (resp.stop_reason === 'end_turn') break;
  }

  return {
    newTurns,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, steps },
  };
}
