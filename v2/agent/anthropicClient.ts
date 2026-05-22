// Agent v2 — Claude Messages API wrapper, with a Gemini fallback.
//
// Primary path is `anthropic-proxy` (full Messages API: system, messages,
// tool_use / tool_result content blocks). When Anthropic is rate-limited,
// overloaded, or otherwise rejects the call with a recoverable error we
// transparently fall back to `gemini-proxy` and return a Claude-shaped
// response with text-only content. Tool calling is NOT supported on the
// fallback path — the agent loop sees no tool_use blocks and concludes
// after one turn, which is exactly what we want for "chat keeps working
// while Claude is unavailable".

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
  /** Diagnostic — set when the Gemini fallback served this response so
   *  the UI / runtime can let the user know they're in degraded mode. */
  fallbackProvider?: 'gemini';
}

/** Default model for the agent loop. Overridable per-request. */
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-6';

/** Gemini model used by the fallback. Fast and capable; switch to
 *  `gemini-2.5-pro` if you want higher quality at the cost of latency. */
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

/** Pattern-match the error coming back from the anthropic-proxy /
 *  Anthropic upstream to decide whether to attempt the fallback.
 *  Anthropic surfaces rate limits as 429 + `rate_limit_error`, and
 *  capacity issues as 529 / 503 + `overloaded_error`. The proxy also
 *  emits a 502 "Upstream unreachable" on network failure. */
function shouldFallback(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // The error from invokeEdgeFunction looks like:
  //   "anthropic-proxy failed (429)"  — when upstream returned 429
  //   "[object Object]"               — when data.error was an object
  //   "Upstream unreachable"          — proxy couldn't reach Anthropic
  return /\(429\)|\(503\)|\(529\)|\(502\)|\(500\)/.test(msg)
    || /rate[_\s-]?limit/i.test(msg)
    || /overload/i.test(msg)
    || /quota/i.test(msg)
    || /upstream unreachable/i.test(msg)
    // Object-stringified Anthropic errors: the proxy passes through the
    // upstream JSON `{ error: { type, message } }` body when 4xx/5xx, and
    // invokeEdgeFunction throws `new Error(data.error)` — which becomes
    // "[object Object]" once that's an object. Treat as recoverable since
    // genuine 4xx model errors (bad request, etc.) are rarer than quota
    // hits and Gemini would catch the bad-request case anyway.
    || msg === '[object Object]';
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

/** Flatten a Claude `content` (string or block array) to plain text.
 *  Tool_use / tool_result / image blocks are dropped on the fallback
 *  path — Gemini fallback is text-only. */
function flattenClaudeContent(content: string | ClaudeContentBlock[]): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const b of content) {
    if (b.type === 'text') out.push(b.text);
    else if (b.type === 'tool_result') {
      // Surface tool results to the model as plain text so the assistant
      // can still reason about prior tool calls. Mark them visibly.
      out.push(`[tool_result${b.is_error ? ' (error)' : ''}]\n${b.content}`);
    } else if (b.type === 'tool_use') {
      // Past assistant tool calls — keep them visible so the model
      // doesn't repeat itself, but the next turn won't carry them
      // (fallback doesn't run tools).
      out.push(`[tool_use: ${b.name}(${JSON.stringify(b.input)})]`);
    }
    // image: skipped — Gemini fallback for the agent loop is text-only.
  }
  return out.join('\n\n');
}

function toGeminiContents(messages: ClaudeMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    const text = flattenClaudeContent(m.content);
    if (!text) continue;
    out.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }
  return out;
}

interface GeminiProxyResponse {
  text?: string;
  candidates?: any[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: string;
}

/** Translate a Claude request to a Gemini one and shape the response
 *  back into the Claude wire format so callers (runAgent) don't need
 *  to branch on provider. Text-only — tools are intentionally dropped. */
async function callGeminiAsClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const geminiBody: Record<string, unknown> = {
    model: GEMINI_FALLBACK_MODEL,
    contents: toGeminiContents(req.messages),
    config: {
      temperature: req.temperature ?? 0.4,
      maxOutputTokens: req.max_tokens,
    },
  };
  if (req.system) {
    (geminiBody as any).systemInstruction = {
      role: 'user',
      parts: [{ text: req.system }],
    };
  }

  const resp = await invokeEdgeFunction('gemini-proxy', {
    method: 'POST',
    body: geminiBody,
  }) as GeminiProxyResponse;

  if (resp.error) {
    throw new Error(`Gemini fallback failed: ${resp.error}`);
  }
  const text = resp.text ?? '';
  if (!text) {
    throw new Error('Gemini fallback returned no text');
  }

  return {
    id: 'gemini-fallback',
    model: GEMINI_FALLBACK_MODEL,
    role: 'assistant',
    // Mimic end_turn so runAgent treats this as the end of the loop —
    // we can't continue tool-calling on the fallback anyway.
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: resp.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
    },
    fallbackProvider: 'gemini',
  };
}

/** Call Claude via the anthropic-proxy edge function, falling back to
 *  Gemini on rate-limit / overload / unreachable errors. The fallback
 *  is logged so it's visible in the browser console and (via the
 *  `fallbackProvider` flag on the response) to the agent runtime. */
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  try {
    const raw = await invokeEdgeFunction('anthropic-proxy', {
      method: 'POST',
      body: req,
    }) as ClaudeResponse & { error?: string; type?: string };

    if (raw.error || raw.type === 'error') {
      throw new Error(typeof raw.error === 'string' ? raw.error : 'Claude call failed');
    }
    if (!Array.isArray(raw.content)) {
      throw new Error('Claude returned malformed response (no content[])');
    }
    return raw;
  } catch (err) {
    if (!shouldFallback(err)) throw err;
    console.warn('[callClaude] primary failed, falling back to Gemini:', err);
    try {
      return await callGeminiAsClaude(req);
    } catch (fallbackErr) {
      console.error('[callClaude] Gemini fallback also failed:', fallbackErr);
      // Re-throw the original Claude error — that's the more actionable
      // one for the user (e.g., quota exceeded / token expired).
      throw err;
    }
  }
}
