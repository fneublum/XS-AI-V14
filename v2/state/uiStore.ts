// Phase 3A — Zustand-compatible UI state store.
//
// Zustand isn't in package.json yet, so this file implements a minimal
// store with the same `useStore((s) => s.x)` shape. Swap the import in
// Phase 3B when the dep lands: `import { create } from 'zustand'`.

type Listener<T> = (state: T, prev: T) => void;

export interface StoreApi<T> {
  getState: () => T;
  setState: (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (listener: Listener<T>) => () => void;
}

function create<T extends object>(initial: T | (() => T)): StoreApi<T> & (() => T) {
  let state: T = typeof initial === 'function' ? (initial as () => T)() : initial;
  const listeners = new Set<Listener<T>>();

  const getState = () => state;
  const setState: StoreApi<T>['setState'] = (partial) => {
    const nextPartial = typeof partial === 'function' ? (partial as (s: T) => Partial<T>)(state) : partial;
    const prev = state;
    state = { ...state, ...nextPartial };
    listeners.forEach(l => l(state, prev));
  };
  const subscribe: StoreApi<T>['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  const hook = () => getState();
  (hook as any).getState = getState;
  (hook as any).setState = setState;
  (hook as any).subscribe = subscribe;
  return hook as StoreApi<T> & (() => T);
}

export type Theme = 'light' | 'dark' | 'system';

export interface UiState {
  sidebarCollapsed: boolean;
  theme: Theme;
  setSidebarCollapsed: (v: boolean) => void;
  setTheme: (t: Theme) => void;
}

const THEME_KEY = 'xs_v2_theme';

const readStoredTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* noop */ }
  return 'dark';
};

const writeStoredTheme = (t: Theme) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* noop */ }
};

/** Returns the effective theme (`light` | `dark`), resolving `system`. */
export const resolveTheme = (t: Theme): 'light' | 'dark' => {
  if (t !== 'system') return t;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

/** Toggle the `light`/`dark` class on <html>. No-op on SSR. */
export const applyThemeClass = (t: Theme) => {
  if (typeof document === 'undefined') return;
  const effective = resolveTheme(t);
  const root = document.documentElement;
  root.classList.toggle('light', effective === 'light');
  root.classList.toggle('dark', effective === 'dark');
};

export const useUiStore = create<UiState>({
  sidebarCollapsed: false,
  theme: readStoredTheme(),
  setSidebarCollapsed(v) { (useUiStore as any).setState({ sidebarCollapsed: v }); },
  setTheme(t) {
    writeStoredTheme(t);
    applyThemeClass(t);
    (useUiStore as any).setState({ theme: t });
  },
});

// Apply the persisted theme to <html> as soon as this module loads so
// the first paint matches — avoids a dark→light flash on refresh.
if (typeof document !== 'undefined') {
  applyThemeClass((useUiStore as any).getState().theme);
}
