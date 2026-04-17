// Phase 3B — Shared editor state.
//
// Centralises "which entity is currently being edited" AND whether the
// drawer is in create or edit mode. Create drawers open with an empty
// skeleton entity; edit drawers open with a full one. Both drawers
// branch on `mode` to call insert vs update.

import React, { createContext, useContext, useMemo, useState } from 'react';
import { SalesOrder } from '../queries/useSalesOrders';
import { Customer } from '../queries/useCustomers';
import { Supplier } from '../queries/useSuppliers';
import { Invoice } from '../queries/useInvoices';
import { PurchaseOrder } from '../queries/usePurchaseOrders';

export type EditorMode = 'edit' | 'create';

interface Slot<T> {
  entity: T | null;
  mode: EditorMode;
}

const emptySlot = <T,>(): Slot<T> => ({ entity: null, mode: 'edit' });

interface EditorContextValue {
  salesOrder: Slot<SalesOrder>;
  openSalesOrder: (o: SalesOrder) => void;
  openSalesOrderCreate: () => void;
  closeSalesOrder: () => void;

  customer: Slot<Customer>;
  openCustomer: (c: Customer) => void;
  openCustomerCreate: () => void;
  closeCustomer: () => void;

  supplier: Slot<Supplier>;
  openSupplier: (s: Supplier) => void;
  openSupplierCreate: () => void;
  closeSupplier: () => void;

  invoice: Slot<Invoice>;
  openInvoice: (i: Invoice) => void;
  openInvoiceCreate: () => void;
  closeInvoice: () => void;

  purchaseOrder: Slot<PurchaseOrder>;
  openPurchaseOrder: (p: PurchaseOrder) => void;
  openPurchaseOrderCreate: () => void;
  closePurchaseOrder: () => void;

  // Legacy getters (kept so existing drawer components don't need to
  // change their destructure).
  editingSalesOrder: SalesOrder | null;
  editingCustomer: Customer | null;
  editingSupplier: Supplier | null;
  editingInvoice: Invoice | null;
  editingPurchaseOrder: PurchaseOrder | null;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const useEditor = (): EditorContextValue => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within <EditorProvider />');
  return ctx;
};

export const EMPTY_CUSTOMER: Customer = {
  id: '',
  name: '',
  email: null,
  phone: null,
  country: null,
  city: null,
  pod: null,
  paymentTerms: null,
  lastOrderDate: null,
};

export const EMPTY_SUPPLIER: Supplier = {
  id: '',
  name: '',
  email: null,
  phone: null,
  country: null,
  city: null,
  categories: null,
  rating: null,
  paymentTerms: null,
};

export const EMPTY_SALES_ORDER: SalesOrder = {
  id: '',
  orderNumber: '',
  customerName: '',
  status: 'DRAFT',
  totalAmount: 0,
  currency: 'USD',
  orderDate: new Date().toISOString().slice(0, 10),
  createdAt: '',
  paymentTerms: null,
  incoterm: null,
  deliveryDate: null,
};

export const EMPTY_INVOICE: Invoice = {
  id: '',
  invoiceNumber: '',
  soldTo: null,
  billToName: null,
  invoiceDate: new Date().toISOString().slice(0, 10),
  paymentTerms: null,
  incoterm: null,
  totalAmount: 0,
  currency: 'USD',
  soNumber: null,
  plNumber: null,
  bookingNumber: null,
  createdAt: '',
};

export const EMPTY_PURCHASE_ORDER: PurchaseOrder = {
  id: '',
  supplierName: '',
  status: 'DRAFT',
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDeliveryDate: null,
  paymentTerms: null,
  totalAmount: 0,
  currency: 'USD',
};

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [salesOrder,    setSO]       = useState<Slot<SalesOrder>>(emptySlot);
  const [customer,      setCustomer] = useState<Slot<Customer>>(emptySlot);
  const [supplier,      setSupplier] = useState<Slot<Supplier>>(emptySlot);
  const [invoice,       setInvoice]  = useState<Slot<Invoice>>(emptySlot);
  const [purchaseOrder, setPO]       = useState<Slot<PurchaseOrder>>(emptySlot);

  const value = useMemo<EditorContextValue>(() => ({
    salesOrder,
    openSalesOrder:       (o) => setSO({ entity: o, mode: 'edit' }),
    openSalesOrderCreate: ()  => setSO({ entity: EMPTY_SALES_ORDER, mode: 'create' }),
    closeSalesOrder:      ()  => setSO(emptySlot),

    customer,
    openCustomer:       (c) => setCustomer({ entity: c, mode: 'edit' }),
    openCustomerCreate: ()  => setCustomer({ entity: EMPTY_CUSTOMER, mode: 'create' }),
    closeCustomer:      ()  => setCustomer(emptySlot),

    supplier,
    openSupplier:       (s) => setSupplier({ entity: s, mode: 'edit' }),
    openSupplierCreate: ()  => setSupplier({ entity: EMPTY_SUPPLIER, mode: 'create' }),
    closeSupplier:      ()  => setSupplier(emptySlot),

    invoice,
    openInvoice:       (i) => setInvoice({ entity: i, mode: 'edit' }),
    openInvoiceCreate: ()  => setInvoice({ entity: EMPTY_INVOICE, mode: 'create' }),
    closeInvoice:      ()  => setInvoice(emptySlot),

    purchaseOrder,
    openPurchaseOrder:       (p) => setPO({ entity: p, mode: 'edit' }),
    openPurchaseOrderCreate: ()  => setPO({ entity: EMPTY_PURCHASE_ORDER, mode: 'create' }),
    closePurchaseOrder:      ()  => setPO(emptySlot),

    // Legacy getters.
    editingSalesOrder:    salesOrder.entity,
    editingCustomer:      customer.entity,
    editingSupplier:      supplier.entity,
    editingInvoice:       invoice.entity,
    editingPurchaseOrder: purchaseOrder.entity,
  }), [salesOrder, customer, supplier, invoice, purchaseOrder]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};
