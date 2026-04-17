// Phase 3B — Confirmation dialog. Radix AlertDialog-like shape built on
// the existing Dialog we use for the palette. Two button footer: Cancel
// + a danger-toned primary action.

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  tone?: 'danger' | 'neutral';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, onOpenChange, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  loading, onConfirm, tone = 'danger',
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]" />
      <Dialog.Content
        className="fixed left-1/2 top-[30%] z-[70] w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
      >
        <Dialog.Title className="text-[14px] font-semibold text-slate-100">
          {title}
        </Dialog.Title>
        {description && (
          <Dialog.Description className="text-[12.5px] text-slate-400 mt-1.5 leading-relaxed">
            {description}
          </Dialog.Description>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            loading={loading}
            className={
              tone === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/40'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40'
            }
          >
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
