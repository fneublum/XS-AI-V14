// Phase 2A — AI telemetry pipeline.
// Fire-and-forget emit; never block the calling path on telemetry.

import { orchestratorConfig } from './config';
import type { AiTelemetryEvent } from './types';

const pending: AiTelemetryEvent[] = [];
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flush();
  }, 2000);
}

async function flush() {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  if (!orchestratorConfig.telemetry.enabled) return;
  try {
    // Lazy import so telemetry emit has zero cost when orchestrator is off.
    const { supabase } = await import('../supabase');
    await supabase.from(orchestratorConfig.telemetry.table).insert(batch);
  } catch {
    // Telemetry is best-effort; drop on failure.
  }
}

export function emit(event: AiTelemetryEvent): void {
  pending.push(event);
  scheduleFlush();
}
