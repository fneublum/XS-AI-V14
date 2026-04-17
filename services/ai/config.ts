// Phase 2A — AI Orchestrator configuration.
// Gated OFF by default. Flip `enabled` to true after Phase 2A verification.

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

export const orchestratorConfig: OrchestratorConfig = {
  enabled: false,
  defaultProvider: 'anthropic',
  routing: {
    // Reasoning / planning → Claude Opus 4.7.
    parseIntent: 'anthropic',
    reasonEmailReply: 'anthropic',
    agentStep: 'anthropic',
    generateInsight: 'anthropic',
    // Extraction / classification → Gemini (cheaper, fast multimodal).
    extractFromEmail: 'gemini',
    extractFromPdf: 'gemini',
    classifyDocument: 'gemini',
    summarize: 'gemini',
  },
  models: {
    anthropic: 'claude-opus-4-7',
    gemini: 'gemini-3-pro-preview',
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
