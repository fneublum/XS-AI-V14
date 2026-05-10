// Phase 3B — Feature flag store.
//
// Tiny localStorage-backed key/value store for user-level opt-ins. The
// flag `v2-default` controls whether a plain `/` URL mounts v2 (true)
// or v1 (false). Precedence, highest-wins:
//   1. URL param `?v2=1` — always wins (full opt-in)
//   2. URL param `?v2=0` — always wins (force back to v1)
//   3. localStorage `v2-default=true`
//   4. Default: v1
//
// No runtime deps — the rollout stays simple: per-user toggle, no
// GrowthBook or LaunchDarkly-style service.

const STORAGE_KEY = 'xs_feature_flags';

export interface FeatureFlags {
  'v2-default': boolean;
  /** Mounts the Agent v2 chat panel. Off by default — opt-in until
   *  allowlist / audit flow is battle-tested. Enable via
   *  `?agent=1` URL param or from the UI (coming soon). */
  'agent-v2': boolean;
}

const DEFAULTS: FeatureFlags = {
  'v2-default': true,
  'agent-v2': false,
};

function readAll(): FeatureFlags {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeAll(next: FeatureFlags): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return readAll()[key];
}

export function setFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  writeAll({ ...readAll(), [key]: value });
}

/**
 * Decide whether to mount v2 on this page load.
 * Must be safe to call before React mounts.
 */
export function shouldMountV2(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const v2Param = params.get('v2');
  if (v2Param === '1') return true;
  if (v2Param === '0') return false;
  return getFlag('v2-default');
}

/**
 * Whether to mount the Agent v2 chat panel. URL `?agent=1`/`?agent=0`
 * overrides the stored flag. Check happens on every render — no
 * reload needed to flip it at runtime.
 */
export function shouldMountAgentV2(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const p = params.get('agent');
  if (p === '1') return true;
  if (p === '0') return false;
  return getFlag('agent-v2');
}
