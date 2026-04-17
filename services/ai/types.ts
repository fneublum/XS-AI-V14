// Phase 2A — AI Orchestrator shared types.
// Status: scaffold. No runtime callers yet. Gated off by default
// via `orchestratorConfig.enabled = false` in `./config.ts`.

export type AiProvider = 'anthropic' | 'gemini';

export type TaskType =
  | 'parseIntent'        // structured intent extraction from a free-form user msg
  | 'extractFromEmail'   // entity extraction from email body
  | 'extractFromPdf'     // entity extraction from PDF text (OCR'd)
  | 'reasonEmailReply'   // generate an email reply draft
  | 'classifyDocument'   // tag a document as PO / BOL / Invoice / etc.
  | 'summarize'          // short summary of a long text
  | 'generateInsight'    // dashboard insight generation
  | 'agentStep';         // autonomous-agent single step (Phase 2B+)

export interface AiRequest {
  taskType: TaskType;
  prompt: string;
  systemPrompt?: string;
  responseSchema?: unknown;      // JSON-Schema-like shape for structured output
  tools?: AiTool[];              // tool-use definitions (Anthropic + Gemini compatible)
  cacheKey?: string;             // explicit cache key; otherwise computed from prompt hash
  metadata?: Record<string, unknown>;
  providerHint?: AiProvider;     // override default routing
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AiTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface AiResponse {
  provider: AiProvider;
  model: string;
  text: string;
  parsed?: unknown;              // when responseSchema is provided
  toolCalls?: AiToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cost?: number;               // USD estimate, optional
  };
  latencyMs: number;
  cache: 'hit' | 'miss' | 'bypass';
  requestId: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AiTelemetryEvent {
  requestId: string;
  taskType: TaskType;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd?: number;
  cache: 'hit' | 'miss' | 'bypass';
  error?: string;
  timestamp: string;
}
