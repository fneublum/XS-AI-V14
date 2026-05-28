// Phase 3B — Company switcher.
//
// Replaces the hard-coded "Felipe N. / ACME" tile in the sidebar with a
// real Radix dropdown-menu of selectable companies. Selecting one updates
// the CompanyProvider and every scoped query refetches via its key change.

import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies, Company } from '../queries/useCompanies';
import { useAuth } from '../providers/AuthProvider';
import { cn } from '../primitives/utils';

const ALL_OPTION: Company = {
  id: 'ALL', name: 'All accessible',
  nickname: null, address: null, city: null, state: null, zip: null,
  country: null, phone: null, ein: null,
};

export const CompanySwitcher: React.FC = () => {
  const { currentCompanyId, setCurrentCompanyId } = useCompany();
  const { user } = useAuth();
  const { data: companies, isLoading, error } = useCompanies();

  const options: Company[] = [ALL_OPTION, ...(companies ?? [])];
  const active = options.find(o => o.id === currentCompanyId) ?? ALL_OPTION;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#141414] text-left transition-colors"
          aria-label="Switch company"
        >
          <div
            className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 shrink-0"
            aria-hidden
          />
          <div className="text-[12px] leading-tight min-w-0 flex-1">
            <div className="text-slate-100 truncate">
              {user?.name ?? 'Signed out'}
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              {active.name}
            </div>
          </div>
          <span className="text-slate-600 text-[10px]" aria-hidden>⌄</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-widest text-slate-600 font-medium">
            Switch company
          </div>
          {isLoading && (
            <div className="px-2 py-1.5 text-[11px] text-slate-500">Loading…</div>
          )}
          {error && (
            <div className="px-2 py-1.5 text-[11px] text-red-400">
              {error.message}
            </div>
          )}
          {!isLoading && !error && options.map(opt => {
            const selected = opt.id === currentCompanyId;
            return (
              <DropdownMenu.Item
                key={opt.id}
                onSelect={() => setCurrentCompanyId(opt.id)}
                className={cn(
                  'flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[12.5px] cursor-pointer outline-none',
                  'text-slate-300 data-[highlighted]:bg-[#161616] data-[highlighted]:text-slate-100',
                )}
              >
                <span className="truncate">{opt.name}</span>
                {selected && (
                  <span className="text-indigo-400 text-[11px]" aria-hidden>●</span>
                )}
              </DropdownMenu.Item>
            );
          })}

          <DropdownMenu.Separator className="my-1 h-px bg-[#1f1f1f]" />

          <DropdownMenu.Item
            onSelect={async () => {
              // Phase 1e — tear down the Supabase session AND the legacy
              // sessionStorage blob. `scope: 'local'` ensures the local
              // tokens are cleared even if the server-side revocation
              // call fails (network blip, 401, etc.) — without this,
              // a silent signOut failure leaves the user "logged in"
              // after the redirect. Belt-and-suspenders: manually nuke
              // any sb-* localStorage entries as a final guarantee.
              try {
                const { getSupabaseClient } = await import('../../services/supabase');
                await getSupabaseClient().auth.signOut({ scope: 'local' }).catch(() => { /* best effort */ });
              } catch { /* noop */ }
              try {
                Object.keys(localStorage)
                  .filter(k => k.startsWith('sb-'))
                  .forEach(k => localStorage.removeItem(k));
              } catch { /* noop */ }
              try { sessionStorage.removeItem('xs_current_user'); } catch { /* noop */ }
              try { sessionStorage.removeItem('xs_edge_auth_token'); } catch { /* noop */ }
              try { sessionStorage.removeItem('xs_edge_auth_exp'); } catch { /* noop */ }
              window.location.href = '/';
            }}
            className="px-2 py-1.5 rounded text-[12px] text-slate-400 cursor-pointer outline-none data-[highlighted]:bg-[#161616] data-[highlighted]:text-slate-100"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
