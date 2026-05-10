// Agent v2 — Claude Messages API wrapper.
//
// Thin adapter around `invokeEdgeFunction('anthropic-proxy', ...)` that
// speaks the full Messages API shape (system, messages[], tools[],
// tool_use / tool_result content blocks) — not the simplified
// AiRequest/AiResponse shape in services/ai/providers/anthropicProvider.
// The agent loop needs structured tool_use + tool_result round-trips,
// so we keep this separate.

import { invokeEdgeFunction } from '../../services/edgeAuth';

/** Content blocks in the order Anthropic expects them. */
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface ClaudeToolDecl {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
  tools?: ClaudeToolDecl[];
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface ClaudeResponse {
  id: string;
  model: string;
  role: 'assistant';
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
  content: ClaudeContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

/** Default model for the agent loop. Overridable per-request. */
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-6';

/** Call Claude via the anthropic-proxy edge function. */
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const raw = await invokeEdgeFunction('anthropic-proxy', {
    method: 'POST',
    body: req,
  }) as ClaudeResponse & { error?: string; type?: string };

  if (raw.error || raw.type === 'error') {
    throw new Error(raw.error || 'Claude call failed');
  }
  if (!Array.isArray(raw.content)) {
    throw new Error('Claude returned malformed response (no content[])');
  }
  return raw;
}
