// Phase 3B — Command palette.
//
// Built on cmdk inside a Radix Dialog. Two kinds of commands:
//
//   1. `commands` — static entries (navigate, actions) that cmdk filters
//      client-side via its own fuzzy match.
//   2. `dataProviders` — async providers that fire a server query on
//      every keystroke (debounced 200ms). Results merge in as extra
//      groups beneath the static ones.
//
// Opens via ⌘K / Ctrl+K or the top-bar Search button. Esc and backdrop
// click dismiss.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { cn } from '../primitives/utils';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  section?: string;
  keywords?: string;
  onSelect: () => void;
}

export interface PaletteDataProvider {
  id: string;
  section: string;
  minQueryLength?: number;
  fetch: (query: string, signal: AbortSignal) => Promise<PaletteCommand[]>;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
  dataProviders?: PaletteDataProvider[];
}

const DEBOUNCE_MS = 200;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open, onOpenChange, commands, dataProviders,
}) => {
  const [query, setQuery] = useState('');
  const [asyncGroups, setAsyncGroups] = useState<Record<string, PaletteCommand[]>>({});
  const [asyncLoading, setAsyncLoading] = useState(false);

  // ⌘K / Ctrl+K toggle.
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

  // Reset local state every time the palette opens.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setAsyncGroups({});
    }
  }, [open]);

  // Debounced async search across every provider.
  useEffect(() => {
    if (!open || !dataProviders || dataProviders.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const active = dataProviders.filter(p =>
        query.length >= (p.minQueryLength ?? 1),
      );
      if (active.length === 0) {
        setAsyncGroups({});
        setAsyncLoading(false);
        return;
      }

      setAsyncLoading(true);
      try {
        const results = await Promise.all(
          active.map(async (p): Promise<[string, PaletteCommand[]]> => {
            try {
              const items = await p.fetch(query, controller.signal);
              return [p.section, items];
            } catch {
              return [p.section, []];
            }
          }),
        );
        if (controller.signal.aborted) return;
        const merged: Record<string, PaletteCommand[]> = {};
        for (const [section, items] of results) merged[section] = items;
        setAsyncGroups(merged);
      } finally {
        if (!controller.signal.aborted) setAsyncLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, dataProviders]);

  // Group static commands.
  const staticGroups = useMemo(() => {
    const groups = new Map<string, PaletteCommand[]>();
    for (const cmd of commands) {
      const key = cmd.section ?? 'Commands';
      const arr = groups.get(key);
      if (arr) arr.push(cmd);
      else groups.set(key, [cmd]);
    }
    return groups;
  }, [commands]);

  const asyncSections = Object.keys(asyncGroups);

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}
          className="fixed left-1/2 top-[20%] z-50 w-[min(92vw,640px)] -translate-x-1/2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search for pages, customers, sales orders, and actions.
          </Dialog.Description>

          <Command label="Command palette" className="flex flex-col" shouldFilter>
            <div className="flex items-center border-b border-[#1f1f1f] px-4">
              <span className="text-slate-500 mr-2" aria-hidden>⌘</span>
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages, customers, orders…"
                className="flex-1 bg-transparent py-3 text-[14px] text-slate-100 placeholder:text-slate-500 outline-none"
              />
              {asyncLoading && (
                <span
                  className="mr-2 w-3 h-3 rounded-full border-2 border-slate-500 border-t-transparent animate-spin"
                  aria-hidden
                />
              )}
              <kbd className="font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px">
                esc
              </kbd>
            </div>

            <Command.List className="max-h-[360px] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-[12px] text-slate-500">
                No matches.
              </Command.Empty>

              {Array.from(staticGroups.entries()).map(([section, items]) => (
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

              {/* Async results — already server-filtered. Force-value them to
                  the query so cmdk doesn't re-filter them away. */}
              {asyncSections.map(section => {
                const items = asyncGroups[section];
                if (!items || items.length === 0) return null;
                return (
                  <Command.Group
                    key={`async-${section}`}
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
                        value={`${query} ${cmd.id} ${cmd.label}`}
                        onSelect={() => {
                          onOpenChange(false);
                          cmd.onSelect();
                        }}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[13px] text-slate-300 cursor-pointer data-[selected=true]:bg-[#161616] data-[selected=true]:text-slate-100"
                      >
                        <span className="truncate">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {cmd.hint}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
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
