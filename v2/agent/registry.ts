// Agent v2 — tool registry.
//
// Tools register themselves at module load. The runtime pulls the full
// set at start-of-run and serializes them into Claude's `tools[]`.

import type { ToolDef, ToolInputSchema, ToolMode, ToolExecutor } from './types';

const REGISTRY = new Map<string, ToolDef>();

export function registerTool(def: ToolDef): void {
  if (REGISTRY.has(def.name)) {
    console.warn(`[agent] tool "${def.name}" already registered — overwriting`);
  }
  REGISTRY.set(def.name, def);
}

export function defineTool(args: {
  name: string;
  description: string;
  mode: ToolMode;
  inputSchema: ToolInputSchema;
  execute: ToolExecutor;
}): void {
  registerTool(args);
}

export function getTool(name: string): ToolDef | null {
  return REGISTRY.get(name) ?? null;
}

export function listTools(): ToolDef[] {
  return [...REGISTRY.values()];
}

/** Convert the current registry to Claude's tools[] declaration shape. */
export function toolsForClaude(): Array<{
  name: string;
  description: string;
  input_schema: unknown;
}> {
  return listTools().map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
