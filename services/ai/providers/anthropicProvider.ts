// Phase 2A — Anthropic provider adapter.
// Routes through a future Supabase Edge Function `anthropic-proxy` (mirrors
// the Phase 1c `gemini-proxy` pattern). The proxy holds the API key; the
// browser never sees it.
//
// The proxy is NOT deployed yet — this adapter throws a clear error when
// invoked so it surfaces the missing piece rather than failing silently.

import type { AiRequest, AiResponse } from '../types';
import { orchestratorConfig } from '../config';
import { invokeEdgeFunction } from '../../edgeAuth';

export async function callAnthropic(req: AiRequest, requestId: string): Promise<AiResponse> {
  const model = orchestratorConfig.models.anthropic;
  const started = Date.now();

  const body = {
    model,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.2,
    system: req.systemPrompt,
    messages: [{ role: 'user', content: req.prompt }],
    tools: req.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    })),
    metadata: { requestId, taskType: req.taskType },
  };

  const raw = await invokeEdgeFunction('anthropic-proxy', {
    method: 'POST',
    body,
  }) as {
    content?: Array<{ type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    model?: string;
  };

  const text = (raw.content ?? [])
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('');

  const toolCalls = (raw.content ?? [])
    .filter(c => c.type === 'tool_use')
    .map(c => ({ id: c.id ?? '', name: c.name ?? '', input: c.input ?? {} }));

  return {
    provider: 'anthropic',
    model: raw.model ?? model,
    text,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: {
      inputTokens: raw.usage?.input_tokens ?? 0,
      outputTokens: raw.usage?.output_tokens ?? 0,
      cachedInputTokens: raw.usage?.cache_read_input_tokens,
    },
    latencyMs: Date.now() - started,
    cache: 'miss',
    requestId,
  };
}
