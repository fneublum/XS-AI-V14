// Phase 3B — Data pop-up menu.
//
// Opens when the user clicks "Data" in the sidebar. Mirrors v1's DATA
// module (App.tsx:1194) — every master-data list is here, plus the
// items that used to live in the v2 Catalog / Logistics sidebar
// sections (Products / Inventory / Suppliers / Customers / Packing
// Lists / Logistics Docs / Shipments / Opportunities). Clicking an
// option navigates to the corresponding v2 route and dismisses the
// modal; items that don't yet have a v2 route hand off to v1.

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, Package, Building2, Users, CreditCard, Anchor,
  Truck, Landmark, MapPin, FileText, Database, LayoutGrid,
  Briefcase, Ship, PackageCheck, Scan, Image as ImageIcon,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (id: string) => void;
}

interface DataItem {
  label: string;
  description: string;
  icon: React.ReactNode;
  /** v2 route id to navigate to. Omit + provide v1Module for handoff. */
  routeId?: string;
  /** v1 `activeModule` + optional `subModule` to deep-link when no v2
   *  route exists yet. */
  v1?: { module: string; submodule?: string };
}

const handoffToV1 = (mod: string, sub?: string) => {
  try {
    sessionStorage.setItem('xs_pending_v1_nav', JSON.stringify({ module: mod, submodule: sub }));
  } catch { /* noop */ }
  window.location.href = '/?v2=0';
};

const SECTIONS: Array<{ label: string; items: DataItem[] }> = [
  {
    label: 'Catalog',
    items: [
      {
        label: 'Products', description: 'Resins, grades, images, TDS',
        icon: <Package size={16} />, routeId: 'products',
      },
      {
        label: 'Inventory', description: 'Stock per warehouse',
        icon: <PackageCheck size={16} />, routeId: 'inventory',
      },
      {
        label: 'Payment Terms', description: 'Reusable term presets',
        icon: <CreditCard size={16} />,
        v1: { module: 'DATA', submodule: 'PAYMENT_TERMS' },
      },
    ],
  },
  {
    label: 'Partners',
    items: [
      {
        label: 'Customers', description: 'Sold-to / ship-to companies',
        icon: <Users size={16} />, routeId: 'customers',
      },
      {
        label: 'Suppliers', description: 'Sourcing side',
        icon: <Briefcase size={16} />, routeId: 'suppliers',
      },
      {
        label: 'Cargo Agents', description: 'Forwarders + brokers',
        icon: <Truck size={16} />,
        v1: { module: 'DATA', submodule: 'AGENTS' },
      },
      {
        label: 'Carriers', description: 'Ocean / air / trucking',
        icon: <Ship size={16} />,
        v1: { module: 'DATA', submodule: 'CARRIERS' },
      },
    ],
  },
  {
    label: 'Places',
    items: [
      {
        label: 'Ports', description: 'POA / POD reference',
        icon: <Anchor size={16} />,
        v1: { module: 'DATA', submodule: 'PORTS' },
      },
      {
        label: 'Locations', description: 'Pickup / drop points',
        icon: <MapPin size={16} />,
        v1: { module: 'DATA', submodule: 'LOCATIONS' },
      },
      {
        label: 'Banks', description: 'Remit-to accounts',
        icon: <Landmark size={16} />,
        v1: { module: 'DATA', submodule: 'BANKS' },
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        label: 'Opportunities', description: 'Sales pipeline',
        icon: <LayoutGrid size={16} />, routeId: 'opportunities',
      },
      {
        label: 'Shipments', description: 'Container tracking',
        icon: <Ship size={16} />, routeId: 'shipments',
      },
      {
        label: 'Packing Lists', description: 'PL master',
        icon: <Package size={16} />, routeId: 'packing-lists',
      },
      {
        label: 'Logistics Docs', description: 'BL / PL / FQ / Booking PDFs',
        icon: <FileText size={16} />, routeId: 'logistics-docs',
      },
      {
        label: 'Doc Viewer', description: 'v1 unified viewer',
        icon: <ImageIcon size={16} />,
        v1: { module: 'DATA', submodule: 'DOC_VIEWER' },
      },
      {
        label: 'AI Data Assistant', description: 'Enrich master-data with AI',
        icon: <Scan size={16} />,
        v1: { module: 'DATA', submodule: 'AI' },
      },
    ],
  },
];

const Group: React.FC<{
  label: string;
  items: DataItem[];
  onPick: (it: DataItem) => void;
}> = ({ label, items, onPick }) => (
  <div className="space-y-1.5">
    <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium">
      {label}
    </div>
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(it => (
        <button
          key={it.label}
          type="button"
          onClick={() => onPick(it)}
          className="group flex items-start gap-2.5 text-left px-2.5 py-2 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors"
        >
          <span className="p-1 rounded-sm bg-[#161616] text-indigo-300 shrink-0">
            {it.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] text-slate-100 font-medium truncate">
              {it.label}
            </span>
            <span className="block text-[11px] text-slate-500 truncate">
              {it.description}
            </span>
          </span>
          {!it.routeId && (
            <span className="text-[9px] uppercase tracking-wider text-amber-400/80 font-medium shrink-0">
              v1
            </span>
          )}
        </button>
      ))}
    </div>
  </div>
);

export const DataMenuModal: React.FC<Props> = ({ open, onOpenChange, navigate }) => {
  const pick = (it: DataItem) => {
    onOpenChange(false);
    if (it.routeId) {
      navigate(it.routeId);
    } else if (it.v1) {
      handoffToV1(it.v1.module, it.v1.submodule);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[8%] -translate-x-1/2 z-50 w-[min(96vw,720px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[84vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
              <Database size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                Data
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                Master data &amp; reference lists. Items marked <span className="text-amber-400">v1</span> still open in v1 until the native port lands.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1">
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto space-y-4">
            {SECTIONS.map(s => (
              <Group key={s.label} label={s.label} items={s.items} onPick={pick} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
