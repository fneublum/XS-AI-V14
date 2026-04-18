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
import { CommissionRow } from '../queries/useCommissions';
import { Product } from '../queries/useProducts';

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

  commission: Slot<CommissionRow>;
  openCommission: (c: CommissionRow) => void;
  closeCommission: () => void;

  product: Slot<Product>;
  openProduct: (p: Product) => void;
  openProductCreate: () => void;
  closeProduct: () => void;

  // Legacy getters (kept so existing drawer components don't need to
  // change their destructure).
  editingSalesOrder: SalesOrder | null;
  editingCustomer: Customer | null;
  editingSupplier: Supplier | null;
  editingInvoice: Invoice | null;
  editingPurchaseOrder: PurchaseOrder | null;
  editingCommission: CommissionRow | null;
  editingProduct: Product | null;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const useEditor = (): EditorContextValue => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within <EditorProvider />');
  return ctx;
};

export const EMPTY_CUSTOMER: Customer = {
  id: '',
  companyId: null,
  name: '',
  nickname: null,
  taxId: null,
  contactPerson: null,
  email: null,
  phone: null,
  location: null,
  city: null,
  state: null,
  zip: null,
  country: null,
  creditLimit: 0,
  paymentTerms: 'Net 30',
  status: 'Active',
  totalVolumeLBS: 0,
  lastOrderDate: null,
  sharedWith: [],
  pod: null,
};

export const EMPTY_SUPPLIER: Supplier = {
  id: '',
  companyId: null,
  name: '',
  taxId: null,
  contactPerson: null,
  email: null,
  phone: null,
  location: null,
  city: null,
  state: null,
  zip: null,
  country: null,
  categories: [],
  rating: 3,
  paymentTerms: 'Net 30 Days',
};

export const EMPTY_SALES_ORDER: SalesOrder = {
  id: '',
  companyId: null,
  customerId: null,
  customerName: '',
  orderNumber: '',
  orderDate: new Date().toISOString().slice(0, 10),
  orderType: 'SPOT',
  status: 'PENDING',
  items: [],
  totalAmount: 0,
  currency: 'USD',
  paymentTerms: 'Net 30 Days',
  incoterm: 'FOB',
  notes: null,
  createdBy: null,
  approvedBy: null,
  createdAt: '',
  saleType: 'LOCAL',
  deliveryMethod: null,
  deliveryAddress: null,
  deliveryDate: null,
  pod: null,
  poa: null,
  pickupLocation: null,
  bankId: null,
  notifyPartyId: null,
  notifyPartyName: null,
};

export const EMPTY_INVOICE: Invoice = {
  id: '',
  companyId: null,
  invoiceNumber: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dateOrder: null,
  shipperName: null,
  shipperAddress: null,
  soldTo: null,
  shipTo: null,
  consignee: null,
  billToName: null,
  paymentTerms: 'Net 30 Days',
  incoterm: 'FOB',
  incoterms: null,
  customerPo: null,
  carrier: null,
  transportRef: null,
  freightTerms: null,
  items: [],
  grossWeight: null,
  netWeight: null,
  tareWeight: null,
  totalQuantity: null,
  subtotal: 0,
  totalAmount: 0,
  currency: 'USD',
  remitTo: null,
  bankName: null,
  bankAddress: null,
  swiftCode: null,
  routingNumber: null,
  accountNumber: null,
  originalDocument: null,
  supplier: null,
  shipper: null,
  date: null,
  bookingNumber: null,
  pod: null,
  poa: null,
  plNumber: null,
  soNumber: null,
  memo: null,
  containers: null,
  createdAt: '',
};

export const EMPTY_PRODUCT: Product = {
  id: '',
  companyId: null,
  name: '',
  supplierProductName: null,
  description: null,
  sku: null,
  category: 'Resin',
  grade: '',
  hsCode: null,
  supplier: '',
  price: 0,
  stockStatus: 'Available',
  specs: { form: 'Pellets' },
  tdsFile: null,
  tdsUrl: null,
  sharedWith: [],
  imageIds: [],
  productType: 'resale',
};

export const EMPTY_PURCHASE_ORDER: PurchaseOrder = {
  id: '',
  companyId: null,
  supplierId: null,
  supplierName: '',
  status: 'PENDING',
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDeliveryDate: null,
  paymentTerms: 'Net 30 Days',
  items: [],
  totalAmount: 0,
  currency: 'USD',
  notes: null,
};

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [salesOrder,    setSO]       = useState<Slot<SalesOrder>>(emptySlot);
  const [customer,      setCustomer] = useState<Slot<Customer>>(emptySlot);
  const [supplier,      setSupplier] = useState<Slot<Supplier>>(emptySlot);
  const [invoice,       setInvoice]  = useState<Slot<Invoice>>(emptySlot);
  const [purchaseOrder, setPO]       = useState<Slot<PurchaseOrder>>(emptySlot);
  const [commission, setCommission]  = useState<Slot<CommissionRow>>(emptySlot);
  const [product, setProduct]        = useState<Slot<Product>>(emptySlot);

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

    commission,
    openCommission:  (c) => setCommission({ entity: c, mode: 'edit' }),
    closeCommission: ()  => setCommission(emptySlot),

    product,
    openProduct:       (p) => setProduct({ entity: p, mode: 'edit' }),
    openProductCreate: ()  => setProduct({ entity: EMPTY_PRODUCT, mode: 'create' }),
    closeProduct:      ()  => setProduct(emptySlot),

    // Legacy getters.
    editingSalesOrder:    salesOrder.entity,
    editingCustomer:      customer.entity,
    editingSupplier:      supplier.entity,
    editingInvoice:       invoice.entity,
    editingPurchaseOrder: purchaseOrder.entity,
    editingCommission:    commission.entity,
    editingProduct:       product.entity,
  }), [salesOrder, customer, supplier, invoice, purchaseOrder, commission, product]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};
