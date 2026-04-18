// Phase 2A — AI Orchestrator configuration.
//
// Enabled as of Phase 2A activation. Defaults route every task to
// Gemini because `gemini-proxy` is already deployed (Phase 1c) —
// Anthropic routing switches on once `anthropic-proxy` is deployed
// + ANTHROPIC_API_KEY is set in Supabase Edge Function secrets.
// See supabase/functions/anthropic-proxy/index.ts for the deploy.

import type { AiProvider, TaskType } from './types';

export interface OrchestratorConfig {
  enabled: boolean;
  defaultProvider: AiProvider;
  routing: Partial<Record<TaskType, AiProvider>>;
  models: Record<AiProvider, string>;
  cache: {
    enabled: boolean;
    ttlByTask: Partial<Record<TaskType, number>>;  // seconds
    ttlDefault: number;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  circuitBreaker: {
    failureThreshold: number;     // consecutive failures before tripping
    cooldownMs: number;           // how long to stay open
  };
  telemetry: {
    enabled: boolean;
    table: string;                // Supabase table for telemetry writes
  };
}

// Routing intent — once anthropic-proxy is live, flip ANTHROPIC_READY
// to true and the reasoning / planning tasks will prefer Claude. Until
// then everything stays on Gemini so no call silently fails.
const ANTHROPIC_READY = false;

export const orchestratorConfig: OrchestratorConfig = {
  enabled: true,
  defaultProvider: 'gemini',
  routing: {
    // Reasoning / planning → Claude Opus 4.7 when deployed, else fall
    // back to Gemini so nothing 500s during the rollout.
    parseIntent:      ANTHROPIC_READY ? 'anthropic' : 'gemini',
    reasonEmailReply: ANTHROPIC_READY ? 'anthropic' : 'gemini',
    agentStep:        ANTHROPIC_READY ? 'anthropic' : 'gemini',
    generateInsight:  ANTHROPIC_READY ? 'anthropic' : 'gemini',
    // Extraction / classification → Gemini (cheaper, fast multimodal).
    extractFromEmail: 'gemini',
    extractFromPdf:   'gemini',
    classifyDocument: 'gemini',
    summarize:        'gemini',
  },
  models: {
    anthropic: 'claude-opus-4-7',
    gemini: 'gemini-2.0-flash',
  },
  cache: {
    enabled: true,
    ttlDefault: 60 * 60,          // 1 hour
    ttlByTask: {
      classifyDocument: 7 * 24 * 60 * 60,   // 7 days (classification is stable)
      summarize: 24 * 60 * 60,              // 1 day
      extractFromPdf: 7 * 24 * 60 * 60,     // 7 days
      // parseIntent / agentStep NOT cached — too user-specific.
    },
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 30_000,
  },
  telemetry: {
    enabled: true,
    table: 'ai_telemetry',
  },
};
