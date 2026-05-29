// Phase 3A — Modal primitive.
// Hand-written because Radix Dialog isn't in package.json yet. Once the
// install lands, this file will be replaced with `shadcn add dialog`.
// Keeps the same API (`open`, `onClose`) so call sites don't change.

import React, { useEffect } from 'react';
import { cn } from './utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, className, labelledBy }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? (title ? 'modal-title' : undefined)}
      // z-[60] so the modal sits ABOVE Drawer (z-50) — modals opened
      // from inside a drawer (proforma viewer in PurchaseOrderDrawer,
      // statement modal in PayablesV2, etc.) were stuck behind the
      // drawer panel and unclickable. Plain z-50 collides with the
      // drawer's Radix portal which renders later in the DOM.
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      <button
        aria-label="Close modal"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/50"
        onClick={onClose}
      />
      <div className={cn(
        'relative z-10 max-h-[90vh] w-[min(92vw,560px)] overflow-auto rounded-lg bg-white p-5 shadow-xl',
        className,
      )}>
        {title && <h2 id="modal-title" className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>}
        {children}
      </div>
    </div>
  );
};
