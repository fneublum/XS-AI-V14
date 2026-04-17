// Phase 2A — Gemini provider adapter.
// Delegates to the existing Phase 1c `gemini-proxy` via the drop-in
// `services/geminiClient.ts` surface, so we reuse the signed bridge and
// server-side API key.

import type { AiRequest, AiResponse } from '../types';
import { orchestratorConfig } from '../config';

export async function callGemini(req: AiRequest, requestId: string): Promise<AiResponse> {
  const model = orchestratorConfig.models.gemini;
  const started = Date.now();

  // Lazy import so Phase 2A compiles without the shim being fully wired.
  const { GoogleGenAI } = await import('../../geminiClient');
  const ai = new GoogleGenAI({ apiKey: 'proxy' });

  const config: Record<string, unknown> = {};
  if (req.systemPrompt) config.systemInstruction = req.systemPrompt;
  if (req.responseSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = req.responseSchema;
  }
  if (req.temperature !== undefined) config.temperature = req.temperature;
  if (req.maxTokens !== undefined) config.maxOutputTokens = req.maxTokens;
  if (req.tools && req.tools.length > 0) {
    config.tools = [{
      functionDeclarations: req.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    }];
  }

  const result = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    config,
  }) as {
    text?: string;
    functionCalls?: Array<{ name: string; args: unknown }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  return {
    provider: 'gemini',
    model,
    text: result.text ?? '',
    toolCalls: (result.functionCalls ?? []).map((c, i) => ({
      id: `${requestId}-tool-${i}`,
      name: c.name,
      input: c.args,
    })),
    usage: {
      inputTokens: result.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
    latencyMs: Date.now() - started,
    cache: 'miss',
    requestId,
  };
}
