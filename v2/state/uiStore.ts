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

export interface UiState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  setSidebarCollapsed: (v: boolean) => void;
  setTheme: (t: UiState['theme']) => void;
}

export const useUiStore = create<UiState>({
  sidebarCollapsed: false,
  theme: 'light',
  setSidebarCollapsed(v) { (useUiStore as any).setState({ sidebarCollapsed: v }); },
  setTheme(t) { (useUiStore as any).setState({ theme: t }); },
});
