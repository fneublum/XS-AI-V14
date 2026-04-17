// Phase 2A — AI response cache.
// Two-tier: in-memory LRU (per-tab, instant) + Supabase persistent (shared).
// Cache key = SHA-256 over { taskType, model, prompt, systemPrompt, responseSchema }.

import type { AiRequest, AiResponse, TaskType } from './types';
import { orchestratorConfig } from './config';

const MAX_IN_MEMORY_ENTRIES = 200;

interface CacheEntry {
  response: AiResponse;
  expiresAt: number;
}

const memCache = new Map<string, CacheEntry>();

async function sha256(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildCacheKey(req: AiRequest, model: string): Promise<string> {
  if (req.cacheKey) return `explicit:${req.cacheKey}`;
  const payload = JSON.stringify({
    taskType: req.taskType,
    model,
    prompt: req.prompt,
    systemPrompt: req.systemPrompt ?? '',
    responseSchema: req.responseSchema ?? null,
  });
  return sha256(payload);
}

function ttlFor(taskType: TaskType): number {
  return (
    orchestratorConfig.cache.ttlByTask[taskType] ??
    orchestratorConfig.cache.ttlDefault
  );
}

export function getCached(key: string): AiResponse | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  // Touch LRU ordering.
  memCache.delete(key);
  memCache.set(key, entry);
  return { ...entry.response, cache: 'hit' };
}

export function setCached(key: string, taskType: TaskType, response: AiResponse): void {
  const expiresAt = Date.now() + ttlFor(taskType) * 1000;
  memCache.set(key, { response, expiresAt });
  if (memCache.size > MAX_IN_MEMORY_ENTRIES) {
    // Evict oldest (Map iteration order = insertion order).
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
}

export function clearCache(): void {
  memCache.clear();
}

// Supabase-backed persistence is intentionally stubbed here — Phase 2A only
// ships the in-memory layer so a misbehaving cache can't corrupt the DB. The
// persistent layer lands with the `ai_response_cache` migration in Phase 2B.
