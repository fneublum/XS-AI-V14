// Agent v2 — core types shared across runtime, registry, tools, UI.
//
// The agent is a Claude-backed tool-calling loop. On each turn it gets a
// batch of tool_use blocks from Claude, executes them (or waits for
// human confirmation on writes), feeds back tool_result blocks, and
// loops until Claude emits only text (the final answer).

/**
 * Tool safety mode.
 *  - read:        auto-execute, no confirmation (SELECTs, list ops).
 *  - write:       auto-execute on low-risk fields, confirmation required
 *                 otherwise (INSERT / UPDATE / benign action).
 *  - destructive: confirmation ALWAYS required (DELETE, cancel, send
 *                 email, anything irreversible from the user's POV).
 */
export type ToolMode = 'read' | 'write' | 'destructive';

/** JSON-Schema-ish parameter shape, exactly what Anthropic's Messages
 *  API takes in `tools[].input_schema`. Kept as a plain object (not zod)
 *  so it ships verbatim to the API. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolContext {
  /** Current Supabase user id. */
  userId: string;
  /** Active company scope ('ALL' for system / multi-company). */
  companyId: string;
  /** Thread id for audit trail + rollback. */
  threadId: string;
  /** Channel the user is on (affects how results render). */
  channel: 'in_app' | 'whatsapp';
  /** Whether the runtime has human approval for the current invocation.
   *  Tools in write/destructive mode should check this and return a
   *  needs_confirmation result if false. */
  approved: boolean;
  /** Short human-readable summary of what this invocation will do,
   *  filled in by the tool at preview-time and shown in the confirm UI. */
  previewLabel?: string;
}

export type ToolResultKind =
  | 'ok'
  | 'error'
  | 'needs_confirmation';

export interface ToolResult {
  kind: ToolResultKind;
  /** Short description shown inline in the chat thread. */
  summary: string;
  /** Full structured result returned to the model. */
  data?: unknown;
  /** For needs_confirmation: what the user will see in the confirm card. */
  preview?: {
    action: string;
    details: Record<string, unknown>;
  };
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface ToolDef {
  name: string;
  description: string;
  mode: ToolMode;
  inputSchema: ToolInputSchema;
  execute: ToolExecutor;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentMessageContent {
  role: 'user' | 'assistant';
  /** Plain text visible in chat UI. */
  text?: string;
  /** Tool calls emitted by the assistant on this turn. */
  toolCalls?: AgentToolCall[];
  /** Tool results from a prior turn (role=user, programmatic). */
  toolResults?: Array<{ toolUseId: string; result: ToolResult }>;
  /** Optional attachment reference (Supabase storage path, or Meta media id). */
  mediaRef?: string;
}

export interface RunAgentInput {
  threadId: string;
  userId: string;
  companyId: string;
  channel: 'in_app' | 'whatsapp';
  /** Prior messages in this thread, oldest first. */
  history: AgentMessageContent[];
  /** The new user turn (already inserted into `history` or not — runtime
   *  treats `history` as the complete context). */
  userTurn: AgentMessageContent;
  /** Optional id of a pending tool_use the user just approved/rejected —
   *  routed from the confirmation UI so the runtime can resume the loop. */
  pendingApproval?: {
    toolUseId: string;
    approved: boolean;
  };
  /** Max agent iterations per run. Guardrail. */
  maxSteps?: number;
  /** Optional override model. Defaults to Sonnet 4.6. */
  model?: string;
}

export interface RunAgentOutput {
  /** Final assistant turn(s) to append to history. Always at least one. */
  newTurns: AgentMessageContent[];
  /** If non-null, the runtime paused waiting for human confirmation. */
  awaitingApproval?: {
    toolUseId: string;
    preview: NonNullable<ToolResult['preview']>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    steps: number;
  };
}
