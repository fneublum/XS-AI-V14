// Phase 3B — Command palette.
//
// Wraps `cmdk` (the battle-tested Raycast-style palette) in a Radix
// Dialog so focus-trap + esc + backdrop dismissal come for free. All
// commands funnel through one imperative API: register a command via
// the `commands` prop, and cmdk handles the fuzzy match.
//
// Open with ⌘K (or the Search button in the top bar). Plain-letter
// hotkeys are handled separately in AppV2 — the palette is the
// discoverable path for everything.

import React, { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { cn } from '../primitives/utils';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;          // keyboard shortcut hint shown on the right
  section?: string;       // group label (e.g. "Navigate", "Actions")
  keywords?: string;      // extra fuzzy-search terms
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open, onOpenChange, commands,
}) => {
  // Global ⌘K / Ctrl+K to toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Group commands by section, preserving original order within each.
  const groups = new Map<string, PaletteCommand[]>();
  for (const cmd of commands) {
    const key = cmd.section ?? 'Commands';
    const arr = groups.get(key);
    if (arr) arr.push(cmd);
    else groups.set(key, [cmd]);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          onOpenAutoFocus={e => {
            // Let cmdk's input auto-focus instead of the dialog container.
            e.preventDefault();
          }}
          className="fixed left-1/2 top-[20%] z-50 w-[min(92vw,640px)] -translate-x-1/2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search for pages and actions. Use arrow keys to navigate and enter to select.
          </Dialog.Description>

          <Command label="Command palette" className="flex flex-col">
            <div className="flex items-center border-b border-[#1f1f1f] px-4">
              <span className="text-slate-500 mr-2" aria-hidden>⌘</span>
              <Command.Input
                placeholder="Search pages, customers, actions…"
                className="flex-1 bg-transparent py-3 text-[14px] text-slate-100 placeholder:text-slate-500 outline-none"
                autoFocus
              />
              <kbd className="ml-2 font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px">
                esc
              </kbd>
            </div>

            <Command.List className="max-h-[360px] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-[12px] text-slate-500">
                No matches.
              </Command.Empty>
              {Array.from(groups.entries()).map(([section, items]) => (
                <Command.Group
                  key={section}
                  heading={section}
                  className={cn(
                    '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1',
                    '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest',
                    '[&_[cmdk-group-heading]]:text-slate-600 [&_[cmdk-group-heading]]:font-medium',
                  )}
                >
                  {items.map(cmd => (
                    <Command.Item
                      key={cmd.id}
                      value={`${cmd.label} ${cmd.keywords ?? ''}`}
                      onSelect={() => {
                        onOpenChange(false);
                        cmd.onSelect();
                      }}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[13px] text-slate-300 cursor-pointer data-[selected=true]:bg-[#161616] data-[selected=true]:text-slate-100"
                    >
                      <span className="truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <kbd className="font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px">
                          {cmd.hint}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>

            <div className="border-t border-[#1f1f1f] px-3 py-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                <kbd className="font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px">↵</kbd>
                <span className="ml-1">Open</span>
              </span>
              <span>
                <kbd className="font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px">↑↓</kbd>
                <span className="ml-1">Navigate</span>
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
