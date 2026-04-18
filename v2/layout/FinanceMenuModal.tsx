// Phase 3B — Finance pop-up menu.
//
// Opens when the user clicks "Finance" in the sidebar. Matches the
// Data / Settings modal pattern so the sidebar doesn't need to
// dedicate a full section to Payables / Receivables / Customer
// Balances — they live here as click-through cards.

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, Wallet, Receipt, CreditCard, Landmark,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (id: string) => void;
}

interface FinanceItem {
  label: string;
  description: string;
  icon: React.ReactNode;
  routeId: string;
}

const ITEMS: FinanceItem[] = [
  {
    label: 'Payables',
    description: 'Supplier invoices owed',
    icon: <Wallet size={16} />,
    routeId: 'payables',
  },
  {
    label: 'Receivables',
    description: 'Customer invoices due',
    icon: <Receipt size={16} />,
    routeId: 'receivables',
  },
  {
    label: 'Customer Balances',
    description: 'Running A/R per customer',
    icon: <CreditCard size={16} />,
    routeId: 'customer-balances',
  },
];

export const FinanceMenuModal: React.FC<Props> = ({ open, onOpenChange, navigate }) => {
  const pick = (it: FinanceItem) => {
    onOpenChange(false);
    navigate(it.routeId);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[10%] -translate-x-1/2 z-50 w-[min(96vw,560px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[82vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-emerald-600/10 text-emerald-300">
              <Landmark size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                Finance
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                Accounts payable, receivable, and balances.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1">
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto">
            <div className="grid grid-cols-1 gap-1.5">
              {ITEMS.map(it => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => pick(it)}
                  className="group flex items-start gap-3 text-left px-3 py-2.5 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors"
                >
                  <span className="p-1.5 rounded-sm bg-[#161616] text-emerald-300 shrink-0">
                    {it.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-slate-100 font-medium">
                      {it.label}
                    </span>
                    <span className="block text-[11.5px] text-slate-500 mt-0.5">
                      {it.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
