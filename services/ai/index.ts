// Phase 2A — Public entry point for the AI orchestrator layer.
// Import from here, not from individual files.

export { runAi, OrchestratorDisabledError } from './orchestrator';
export { orchestratorConfig } from './config';
export type {
  AiRequest,
  AiResponse,
  AiProvider,
  TaskType,
  AiTool,
  AiToolCall,
  AiTelemetryEvent,
} from './types';
