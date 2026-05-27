// Phase 3B — Settings pop-up menu.
//
// Clicking "Settings" in the sidebar opens this. Mirrors v1's SETTINGS
// module (App.tsx:1465) with just the three user-facing sections.

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, Settings, Building, Users, Plug } from 'lucide-react';
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

// Item.adminOnly gates the entry — non-admin users get a filtered
// list that only includes the Connections card so they can connect
// their personal email automation (M365 / Gmail). Companies + Users
// stay admin-tier-only.
interface AdminItem extends Item {
  adminOnly?: boolean;
  /** Description shown for non-admins. When omitted, the admin
   *  description is used unchanged. */
  descriptionForUser?: string;
}

const ITEMS: AdminItem[] = [
  {
    label: 'Companies', description: 'Legal entities, addresses, EIN',
    icon: <Building size={16} />, routeId: 'companies', adminOnly: true,
  },
  {
    label: 'Users', description: 'Roles, module access, allowed companies',
    icon: <Users size={16} />, routeId: 'users', adminOnly: true,
  },
  {
    label: 'Connections',
    description: 'Outlook / Gmail / QuickBooks / WhatsApp',
    descriptionForUser: 'Connect your Microsoft 365 or Google Gmail account for email automation',
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
          {ITEMS
            // Non-admins only see the cards without `adminOnly`.
            // Companies / Users stay admin-tier-only; Connections is
            // shown to everyone so users can hook up their personal
            // email automation.
            .filter(it => adminTier || !it.adminOnly)
            .map(it => (
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
                    {adminTier ? it.description : (it.descriptionForUser ?? it.description)}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
};
