// Phase 2A — Per-provider circuit breaker.
// States: closed (normal) → open (fail-fast for cooldownMs) → half-open (one
// probe request); a successful probe closes the circuit, a failed probe
// re-opens it.

import { orchestratorConfig } from './config';
import type { AiProvider } from './types';

type BreakerState = 'closed' | 'open' | 'half-open';

interface Breaker {
  state: BreakerState;
  failures: number;
  openedAt: number;
}

const breakers = new Map<AiProvider, Breaker>();

function get(provider: AiProvider): Breaker {
  let b = breakers.get(provider);
  if (!b) {
    b = { state: 'closed', failures: 0, openedAt: 0 };
    breakers.set(provider, b);
  }
  return b;
}

export class CircuitOpenError extends Error {
  constructor(public readonly provider: AiProvider) {
    super(`AI circuit for ${provider} is open — skipping call to avoid thundering herd.`);
    this.name = 'CircuitOpenError';
  }
}

export function assertAvailable(provider: AiProvider): void {
  const b = get(provider);
  if (b.state === 'open') {
    const elapsed = Date.now() - b.openedAt;
    if (elapsed >= orchestratorConfig.circuitBreaker.cooldownMs) {
      b.state = 'half-open';
      return; // allow one probe
    }
    throw new CircuitOpenError(provider);
  }
}

export function recordSuccess(provider: AiProvider): void {
  const b = get(provider);
  b.failures = 0;
  b.state = 'closed';
  b.openedAt = 0;
}

export function recordFailure(provider: AiProvider): void {
  const b = get(provider);
  b.failures += 1;
  if (b.state === 'half-open' || b.failures >= orchestratorConfig.circuitBreaker.failureThreshold) {
    b.state = 'open';
    b.openedAt = Date.now();
  }
}

export function inspectBreaker(provider: AiProvider): BreakerState {
  return get(provider).state;
}

export function resetBreaker(provider: AiProvider): void {
  breakers.delete(provider);
}
