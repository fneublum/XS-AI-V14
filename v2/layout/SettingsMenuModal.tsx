// Phase 3B — Settings pop-up menu.
//
// Clicking "Settings" in the sidebar opens this. Mirrors v1's SETTINGS
// module (App.tsx:1465) with just the three user-facing sections.

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, Settings, Building, Users, Plug, ShieldAlert } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { isAdminRole } from '../lib/roles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (id: string) => void;
}

interface Item {
  label: string;
  description: string;
  icon: React.ReactNode;
  routeId: string;
}

const ITEMS: Item[] = [
  {
    label: 'Companies', description: 'Legal entities, addresses, EIN',
    icon: <Building size={16} />, routeId: 'companies',
  },
  {
    label: 'Users', description: 'Roles, module access, allowed companies',
    icon: <Users size={16} />, routeId: 'users',
  },
  {
    label: 'Connections', description: 'Outlook / Gmail / QuickBooks / WhatsApp',
    icon: <Plug size={16} />, routeId: 'connections',
  },
];

export const SettingsMenuModal: React.FC<Props> = ({ open, onOpenChange, navigate }) => {
  const { user } = useAuth();
  const adminTier = isAdminRole(user?.role);
  return (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
      <Dialog.Content className="fixed left-1/2 top-[12%] -translate-x-1/2 z-50 w-[min(96vw,520px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[84vh]">
        <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
          <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
            <Settings size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <Dialog.Title className="text-[14px] font-semibold text-slate-100">
              Settings
            </Dialog.Title>
            <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
              Admin surfaces for the workspace.
            </Dialog.Description>
          </div>
          <Dialog.Close aria-label="Close"
            className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1">
            <XIcon size={14} />
          </Dialog.Close>
        </div>

        <div className="px-3 py-3 space-y-1.5">
          {adminTier ? ITEMS.map(it => (
            <button
              key={it.routeId}
              type="button"
              onClick={() => { onOpenChange(false); navigate(it.routeId); }}
              className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors"
            >
              <span className="p-1.5 rounded-sm bg-[#161616] text-indigo-300 shrink-0">
                {it.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-slate-100 font-medium">
                  {it.label}
                </span>
                <span className="block text-[11.5px] text-slate-500 truncate">
                  {it.description}
                </span>
              </span>
            </button>
          )) : (
            // Defence-in-depth: the sidebar already hides this entry
            // for non-admins, but if the modal somehow gets opened
            // (deep-link, programmatic call, future regression),
            // render a clean access-denied state instead of leaking
            // the admin route ids via the navigation buttons.
            <div className="flex flex-col items-center text-center px-4 py-8 gap-3">
              <span className="p-2.5 rounded-full bg-amber-500/10 text-amber-300">
                <ShieldAlert size={18} />
              </span>
              <div>
                <div className="text-[13px] font-semibold text-slate-100">Admin access required</div>
                <div className="text-[11.5px] text-slate-500 mt-1">
                  Companies, Users, and Connections are restricted to ADMIN / OWNER roles.
                  Ask a workspace administrator if you need to manage these settings.
                </div>
              </div>
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
};
