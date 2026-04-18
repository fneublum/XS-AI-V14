// Phase 3B — PDF generator context.
//
// The v1 generators ran as closures over page-level React state. To
// reuse them from v2 we pass all dependencies in explicitly. Only the
// data shapes that the generators read live here — the generators
// never see React.

export interface PdfCompany {
  id?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  ein?: string;
}

export interface PdfCustomer {
  id?: string;
  name?: string;
  nickname?: string;
  taxId?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  pod?: string | null;
  poa?: string | null;
  paymentTerms?: string | null;
}

export interface PdfSupplier {
  id?: string;
  name?: string;
  nickname?: string;
  state?: string | null;
  country?: string | null;
}

export interface PdfProduct {
  id?: string;
  name?: string;
  grade?: string | null;
  hsCode?: string | null;
}

export interface PdfPort {
  id?: string;
  code?: string;
  name?: string;
  country?: string;
}

export interface PdfPackingList {
  plNumber?: string | null;
  blNumber?: string | null;
  soNumber?: string | null;
  shipper?: string | null;
  supplier?: string | null;
  consignee?: string | null;
  carrier?: string | null;
  containerNumber?: string | null;
  scheduledShipDate?: string | null;
  date?: string | null;
}

export interface PdfBooking {
  bookingNumber?: string | null;
  pol?: string | null;
  pod?: string | null;
  vesselVoyage?: string | null;
}

export interface InvoicePdfCtx {
  company: PdfCompany | undefined;
  customers: PdfCustomer[];
  suppliers: PdfSupplier[];
  products: PdfProduct[];
  packingLists: PdfPackingList[];
  ports: PdfPort[];
  bookings: PdfBooking[];
  logoUrl: string | null;
  stampUrl: string | null;
  /** Brazil mode — affects number formatting in packing list / SLI. */
  brMode?: boolean;
}

/** Minimal Invoice subset the generator needs. Kept loose so both v1
 *  and v2 Invoice shapes can pass through. */
export interface PdfInvoice {
  id?: string;
  invoiceNumber?: string;
  invoiceDate?: string | null;
  date?: string | null;
  billToName?: string | null;
  soldTo?: string | null;
  consignee?: string | null;
  customerId?: string;
  customerPo?: string | null;
  soNumber?: string | null;
  plNumber?: string | null;
  salesOrderNumber?: string | null;
  bookingNumber?: string | null;
  transportRef?: string | null;
  paymentTerms?: string | null;
  incoterm?: string | null;
  pod?: string | null;
  poa?: string | null;
  items?: unknown;
  containers?: unknown;
  bankName?: string | null;
  bankAddress?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  routingNumber?: string | null;
  memo?: string | null;
  shipper?: string | null;
  shipperName?: string | null;
  supplier?: string | null;
  originState?: string | null;
  carrier?: string | null;
  currency?: string | null;
  totalAmount?: number | null;
  subtotal?: number | null;
}

export const findLinkedPL = (
  inv: PdfInvoice,
  packingLists: PdfPackingList[],
): PdfPackingList | undefined => {
  if (!inv.plNumber) return undefined;
  return packingLists.find(pl => pl.plNumber === inv.plNumber);
};

export const findCompany = (
  companies: PdfCompany[],
  currentCompanyId: string | undefined,
): PdfCompany | undefined => {
  if (!currentCompanyId || currentCompanyId === 'ALL') return companies[0];
  return companies.find(c => c.id === currentCompanyId);
};
