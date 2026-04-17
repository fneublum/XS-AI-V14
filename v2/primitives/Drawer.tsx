// Phase 3B — Right-side Drawer built on Radix Dialog.
// Used for inline editors that don't warrant a full-page route (a single
// sales order, a customer detail, etc.).

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from './utils';

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  open, onOpenChange, title, description, footer, children, widthClass,
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
      <Dialog.Content
        className={cn(
          'fixed right-0 top-0 z-50 h-screen bg-[#0a0a0a] border-l border-[#1f1f1f]',
          'shadow-[-8px_0_32px_rgba(0,0,0,0.5)]',
          'flex flex-col',
          widthClass ?? 'w-[min(92vw,560px)]',
        )}
      >
        <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Dialog.Title className="text-[14px] font-semibold text-slate-100 truncate">
              {title}
            </Dialog.Title>
            {description && (
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5 truncate">
                {description}
              </Dialog.Description>
            )}
          </div>
          <Dialog.Close
            aria-label="Close drawer"
            className="text-slate-500 hover:text-slate-100 transition-colors text-[14px] leading-none p-1 -m-1"
          >
            ✕
          </Dialog.Close>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-2 bg-[#0a0a0a]">
            {footer}
          </div>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
