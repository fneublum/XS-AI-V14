// Phase 3B — Shared editor state.
//
// Centralises "which entity is currently being edited" so the palette,
// keyboard shortcuts, and page rows can all open the same drawer. The
// drawers themselves are mounted once in AppV2.

import React, { createContext, useContext, useMemo, useState } from 'react';
import { SalesOrder } from '../queries/useSalesOrders';
import { Customer } from '../queries/useCustomers';
import { Supplier } from '../queries/useSuppliers';
import { Invoice } from '../queries/useInvoices';
import { PurchaseOrder } from '../queries/usePurchaseOrders';

interface EditorContextValue {
  editingSalesOrder: SalesOrder | null;
  openSalesOrder: (o: SalesOrder) => void;
  closeSalesOrder: () => void;

  editingCustomer: Customer | null;
  openCustomer: (c: Customer) => void;
  closeCustomer: () => void;

  editingSupplier: Supplier | null;
  openSupplier: (s: Supplier) => void;
  closeSupplier: () => void;

  editingInvoice: Invoice | null;
  openInvoice: (i: Invoice) => void;
  closeInvoice: () => void;

  editingPurchaseOrder: PurchaseOrder | null;
  openPurchaseOrder: (p: PurchaseOrder) => void;
  closePurchaseOrder: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const useEditor = (): EditorContextValue => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within <EditorProvider />');
  return ctx;
};

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [editingSalesOrder, setSO]      = useState<SalesOrder | null>(null);
  const [editingCustomer, setCustomer]  = useState<Customer | null>(null);
  const [editingSupplier, setSupplier]  = useState<Supplier | null>(null);
  const [editingInvoice, setInvoice]    = useState<Invoice | null>(null);
  const [editingPurchaseOrder, setPO]   = useState<PurchaseOrder | null>(null);

  const value = useMemo<EditorContextValue>(() => ({
    editingSalesOrder,
    openSalesOrder: (o) => setSO(o),
    closeSalesOrder: () => setSO(null),

    editingCustomer,
    openCustomer: (c) => setCustomer(c),
    closeCustomer: () => setCustomer(null),

    editingSupplier,
    openSupplier: (s) => setSupplier(s),
    closeSupplier: () => setSupplier(null),

    editingInvoice,
    openInvoice: (i) => setInvoice(i),
    closeInvoice: () => setInvoice(null),

    editingPurchaseOrder,
    openPurchaseOrder: (p) => setPO(p),
    closePurchaseOrder: () => setPO(null),
  }), [
    editingSalesOrder, editingCustomer, editingSupplier,
    editingInvoice, editingPurchaseOrder,
  ]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};
