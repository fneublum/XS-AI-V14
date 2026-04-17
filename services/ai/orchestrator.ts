// Phase 2A — Single entry point for all AI calls.
//
// Status: scaffold. `orchestratorConfig.enabled = false` by default, and
// existing AI call sites (services/geminiService.ts, emailAgentService.ts,
// etc.) are NOT yet migrated to route through here. Migration is tracked
// in docs/phase2/ — agent-produced inventory lists the 37 existing call
// sites that will move over during Phase 2B.
//
// What this does:
//   1. Builds a cache key from the request shape.
//   2. Serves cached responses instantly when hit.
//   3. Routes to Anthropic or Gemini based on task type + config.
//   4. Wraps the call in retry + circuit breaker.
//   5. Emits telemetry.
//
// What this intentionally does NOT do yet:
//   - Persist cache to Supabase (Phase 2B).
//   - Stream responses (Phase 2B).
//   - Chain tool-use loops (Phase 2C — autonomous agents).

import type { AiRequest, AiResponse } from './types';
import { orchestratorConfig } from './config';
import { buildCacheKey, getCached, setCached } from './cache';
import { retry } from './retry';
import {
  assertAvailable,
  recordFailure,
  recordSuccess,
  CircuitOpenError,
} from './circuitBreaker';
import { emit } from './telemetry';
import { callAnthropic } from './providers/anthropicProvider';
import { callGemini } from './providers/geminiProvider';

export class OrchestratorDisabledError extends Error {
  constructor() {
    super('AI orchestrator is disabled — flip orchestratorConfig.enabled to true.');
    this.name = 'OrchestratorDisabledError';
  }
}

function newRequestId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAi(req: AiRequest): Promise<AiResponse> {
  if (!orchestratorConfig.enabled) throw new OrchestratorDisabledError();

  const provider =
    req.providerHint ??
    orchestratorConfig.routing[req.taskType] ??
    orchestratorConfig.defaultProvider;
  const model = orchestratorConfig.models[provider];
  const requestId = newRequestId();

  // Cache lookup (skip when schema changes over time — caller may set cacheKey: undefined).
  if (orchestratorConfig.cache.enabled) {
    const key = await buildCacheKey(req, model);
    const hit = getCached(key);
    if (hit) {
      emit({
        requestId: hit.requestId,
        taskType: req.taskType,
        provider: hit.provider,
        model: hit.model,
        latencyMs: 0,
        inputTokens: hit.usage.inputTokens,
        outputTokens: hit.usage.outputTokens,
        cachedInputTokens: hit.usage.cachedInputTokens,
        cache: 'hit',
        timestamp: new Date().toISOString(),
      });
      return hit;
    }
  }

  assertAvailable(provider);

  let response: AiResponse;
  try {
    response = await retry(
      () => (provider === 'anthropic' ? callAnthropic(req, requestId) : callGemini(req, requestId)),
      { onAttempt: () => { /* hook for future per-attempt telemetry */ } }
    );
    recordSuccess(provider);
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) recordFailure(provider);
    emit({
      requestId,
      taskType: req.taskType,
      provider,
      model,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cache: 'bypass',
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
    throw err;
  }

  if (orchestratorConfig.cache.enabled) {
    const key = await buildCacheKey(req, model);
    setCached(key, req.taskType, response);
  }

  emit({
    requestId: response.requestId,
    taskType: req.taskType,
    provider: response.provider,
    model: response.model,
    latencyMs: response.latencyMs,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cachedInputTokens: response.usage.cachedInputTokens,
    cache: 'miss',
    timestamp: new Date().toISOString(),
  });

  return response;
}
