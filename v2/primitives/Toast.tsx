// Phase 3A — Toast primitive + context.
// Uses a Zustand-less local context to avoid coupling state layer choice to
// a single primitive. Replace with Sonner/shadcn toast later without churning
// call sites — the `useToast()` API stays.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { cn } from './utils';

type ToastKind = 'info' | 'success' | 'warning' | 'error';
interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider />');
  return api;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `t-${++idRef.current}`;
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 5000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-md border bg-white px-3 py-2 shadow-lg',
              t.kind === 'success' && 'border-emerald-200 bg-emerald-50',
              t.kind === 'warning' && 'border-amber-200 bg-amber-50',
              t.kind === 'error'   && 'border-red-200 bg-red-50',
            )}
          >
            <div className="text-sm font-medium text-slate-900">{t.title}</div>
            {t.description && <div className="mt-0.5 text-xs text-slate-600">{t.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
