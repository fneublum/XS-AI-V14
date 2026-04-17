// Phase 3B — Keyboard shortcuts cheat sheet modal.
//
// Opens when the user presses `?` outside of any text input. Lists every
// discoverable hotkey grouped by section. Single source of truth — the
// same array here drives what AppV2 registers.

import React, { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Kbd } from '../primitives/Kbd';

export interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ShortcutGroup[];
}

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ open, onOpenChange, groups }) => {
  // Global `?` to open / close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.key === '?') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[15%] z-50 w-[min(92vw,520px)] -translate-x-1/2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        >
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-center justify-between">
            <div>
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                Keyboard shortcuts
              </Dialog.Title>
              <Dialog.Description className="text-[11px] text-slate-500 mt-0.5">
                Press <Kbd>?</Kbd> anywhere to reopen this.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close shortcuts"
              className="text-slate-500 hover:text-slate-100 transition-colors text-[14px] leading-none p-1 -m-1"
            >
              ✕
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
            {groups.map(group => (
              <div key={group.title}>
                <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-2">
                  {group.title}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map(item => (
                    <li key={item.label} className="flex items-center justify-between gap-4 text-[12.5px]">
                      <span className="text-slate-300">{item.label}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-slate-600 text-[10px]">+</span>}
                            <Kbd>{k}</Kbd>
                          </React.Fragment>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
