// Phase 2A — Retry with exponential backoff + full jitter.
// Honors retry-after semantics when the provider surfaces them.

import { orchestratorConfig } from './config';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onAttempt?: (attempt: number, err: unknown) => void;
}

const defaultIsRetryable = (err: unknown): boolean => {
  const anyErr = err as { status?: number; code?: string; message?: string };
  if (!anyErr) return false;
  // Transient HTTP statuses.
  if (anyErr.status && [408, 429, 500, 502, 503, 504].includes(anyErr.status)) return true;
  // Network-level error codes.
  if (anyErr.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(anyErr.code)) {
    return true;
  }
  // Fallback: string-match common transient messages.
  if (anyErr.message && /timeout|network|fetch failed|overloaded|rate limit/i.test(anyErr.message)) {
    return true;
  }
  return false;
};

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? orchestratorConfig.retry.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? orchestratorConfig.retry.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? orchestratorConfig.retry.maxDelayMs;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      if (attempt === maxAttempts || !isRetryable(err)) throw err;
      // Full jitter: random in [0, min(max, base * 2^(attempt-1))]
      const cap = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const delay = Math.floor(Math.random() * cap);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
