
export enum Role {
  ADMIN = 'Admin',
  CEO = 'CEO',
  MANAGER = 'Manager',
  USER = 'User',
  CARGO_AGENT = 'Cargo Agent',
  CUSTOMER = 'Customer',
  SALES = 'Sales'
}

export enum DealStage {
  LEAD = 'Lead',
  FIRST_CONTACT = 'First Contact',
  REQUIREMENTS = 'Requirements',
  QUOTE_SENT = 'Quote Sent',
  NEGOTIATION = 'Negotiation',
  PO_EXPECTED = 'PO Expected',
  PO_RECEIVED = 'PO Received',
  PO_DELIVERED = 'PO Delivered',
  CLOSED_WON = 'Closed Won',
  CLOSED_LOST = 'Closed Lost'
}

// --- iCRM Agentic Types ---
export interface IcrmTask {
  id: string;
  title: string;
  details?: string;
  priority: 1 | 2 | 3 | 4 | 5; // 1 = Urgent
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
  dueAt?: string;
  entityType?: 'CUSTOMER' | 'ORDER' | 'SHIPMENT' | 'QUOTE';
  entityId?: string;
  actionType?: 'EMAIL' | 'CALL' | 'REVIEW' | 'APPROVE';
}

export interface ReorderModel {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  lastOrderDate: string;
  cadenceDays: number;
  nextExpectedDate: string;
  confidence: number; // 0-1
  avgQuantity: number;
  status: 'HEALTHY' | 'AT_RISK' | 'CHURNED';
}

export interface CustomerInteraction {
  id: string;
  customerId: string;
  channel: 'EMAIL' | 'CALL' | 'WHATSAPP' | 'MEETING';
  occurredAt: string;
  summary: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
}
// --------------------------

export interface User {
  id: string;
  name: string;
  username: string;
  password?: string;
  role: Role;
  avatarInitials: string;
  email?: string;
  phone?: string;
  allowed_company_ids?: string[];
  allowed_modules?: string[];
  canManageInventory?: boolean;
  linked_entity_id?: string;
  dock_config?: string[];
  allowed_product_categories?: string[];
  // Foreign key linkage to Supabase auth.users.id (UUID). Populated by
  // scripts/backfill-supabase-auth.mjs. NULL during the cutover for
  // pre-backfill rows — Login.tsx falls back to username match in that
  // window. See scripts/migration-add-users-auth-id.sql for the schema.
  auth_id?: string;
}

// General operational expense (utilities, fuel, office, broker fees,
// travel, etc.). Distinct from supplier-invoice "bills" which live in
// invoices_suppliers and are shipment-tied. Backed by public.expenses
// (see scripts/migration-add-expenses-table.sql).
export type ExpenseCategory =
  | 'UTILITIES'
  | 'OFFICE'
  | 'FREIGHT'
  | 'TRAVEL'
  | 'FUEL'
  | 'COMMISSIONS'
  | 'OTHER';

export type ExpensePaymentStatus = 'UNPAID' | 'PAID' | 'PARTIAL';

export interface Expense {
  id: string;
  companyId: string;
  date: string;            // ISO date, YYYY-MM-DD
  vendor: string;
  amount: number;
  currency: string;        // USD by default
  category: ExpenseCategory;
  notes?: string | null;
  /** Original receipt / invoice (the document that created the
   *  expense) — set by the AI Upload flow. */
  attachmentUrl?: string | null;
  paymentStatus: ExpensePaymentStatus;
  paidDate?: string | null;
  /** Proof-of-payment document — set by the Pay action, distinct
   *  from the original receipt. May be an OCR'd payment confirmation,
   *  a check stub, a wire screenshot, etc. */
  paymentReceiptUrl?: string | null;
  createdAt: string;
  createdBy?: string | null;
}

export interface Company {
  id: string;
  name: string;
  nickname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  ein?: string;
  phone?: string;
  email?: string;
}

export interface CompanyImage {
  id: string;
  companyId: string;
  url: string;
  name: string;
  createdAt: string;
  type: 'LOGO' | 'PRODUCT' | 'OTHER' | 'LOGIN_BG';
}

export interface Customer {
  id: string;
  companyId: string;
  name: string;
  nickname?: string;
  taxId?: string;
  contactPerson: string;
  email: string;
  email2?: string;
  email3?: string;
  phone?: string;
  location?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  creditLimit: number;
  paymentTerms: string;
  status: 'Active' | 'Inactive' | 'At Risk';
  totalVolumeLBS: number;
  lastOrderDate: string;
  sharedWith?: string[];
  pod?: string; // Port of Destination
  brokerName?: string;
  brokerEmail?: string;
  sales_person_id?: string;
  sales_person_name?: string;
  address?: string;
  poa?: string;
  pickupLocation?: string;
}

export interface Supplier {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  nickname?: string;
  taxId?: string;
  contactPerson: string;
  email: string;
  phone: string;
  location?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
  poa?: string;
  pickupLocation?: string;
  categories: string[];
  rating: number;
  paymentTerms: string;
  pickupLocationId?: string; // Link to SavedLocation for pickup
}

export interface Product {
  id: string;
  companyId: string;
  name: string;
  supplierProductName?: string;
  description?: string;
  sku?: string;
  category: string;
  grade: string;
  hsCode?: string;
  supplier: string;
  price: number;
  stockStatus: 'Available' | 'Low Stock' | 'Backorder';
  specs: {
    origin?: string;
    type?: string;
    color?: string;
    reinforced?: string;
    additives?: string;
    form?: string;
    rv?: string;
    process?: string;
    packages?: string;
    mfr?: string;
  };
  tdsFile?: string;
  tdsUrl?: string;
  sharedWith?: string[];
  imageIds?: string[];
}

export interface Port {
  id: string;
  companyId: string;
  code: string;
  portCode?: string;
  name: string;
  country: string;
}

export interface Bank {
  id: string;
  company_id: string;
  created_at?: string;
  code: string;
  name: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  swift_code?: string;
  wire?: string;
  routing?: string;
  account_number?: string;
}

export interface QuoteItem {
  productId: string;
  productName: string;
  grade: string;
  quantityLBS: number;
  unitPriceUSD: number;
  totalUSD: number;
}

export interface Quote {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  items: QuoteItem[];
  totalAmountUSD: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  createdDate: string;
  validUntil: string;
}

export interface OpportunityItem {
  productId: string;
  productName: string;
  volumeLBS: number;
  value: number;
}

export interface Opportunity {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  productName: string;
  volumeLBS: number;
  value: number;
  items?: OpportunityItem[];
  stage: DealStage;
  probability: number;
  expectedCloseDate: string;
  assignedTo: string;
  comments: string;
  poNumber?: string;
}

export interface ShipmentProduct {
  productName: string;
  quantity: number;
}

export interface Shipment {
  id: string;
  companyId: string;
  containerNumber: string;
  blNumber?: string;
  origin: string;
  destination: string;
  status: 'Booking' | 'In Transit' | 'Customs Hold' | 'Released' | 'Delivered';
  etd: string;
  eta: string;
  carrier: string;
  products?: ShipmentProduct[];
}

export interface InventoryItem {
  id: string;
  companyId: string;
  productId: string;
  productName: string;
  grade: string;
  quantityLBS: number;
  warehouseLocation: string;
  lastUpdated: string;
  notes?: string;
}

export interface InventoryLog {
  id: string;
  companyId: string;
  inventoryId: string;
  productName: string;
  grade: string;
  type: 'INITIAL' | 'INCREASE' | 'DECREASE';
  quantityChange: number;
  newQuantity: number;
  documentReference?: string;
  date: string;
  performedBy?: string;
}

export interface SupplierQuoteItem {
  productName: string;
  systemProductName?: string;
  quantity: number;
  unitPrice: number;
  moq?: number;
  leadTime?: string;
  total: number;
}

export interface SupplierQuote {
  id: string;
  quoteNumber: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  items: SupplierQuoteItem[];
  totalAmount: number;
  currency: 'USD' | 'EUR' | 'CNY';
  incoterm: 'EXW' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'DDP';
  loadingLocation?: string;
  originPort?: string;
  destinationPort?: string;
  validUntil: string;
  paymentTerms: string;
  status: 'Pending' | 'Received' | 'Expired';
  notes?: string;
  originalDocument?: string;
}

export interface SupplierOffer {
  id: string;
  offerNumber: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  items: SupplierQuoteItem[];
  totalAmount: number;
  currency: 'USD' | 'EUR' | 'CNY' | 'BRL' | 'GTQ';
  incoterm: 'EXW' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'DDP';
  loadingLocation?: string;
  originPort?: string;
  destinationPort?: string;
  validUntil: string;
  paymentTerms: string;
  status: 'Received' | 'Expired' | 'Accepted' | 'Rejected';
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  status: 'Draft' | 'Sent' | 'Confirmed' | 'Completed';
  orderDate: string;
  expectedDeliveryDate: string;
  paymentTerms: string;
  items: SupplierQuoteItem[];
  totalAmount: number;
  currency: string;
  notes?: string;
}

export interface FreightQuote {
  id: string;
  companyId: string;
  agentName: string;
  carrier: string;
  freightType: 'PORT_PORT' | 'PORT_DOOR' | 'DOOR_PORT' | 'DOOR_DOOR';
  originPort?: string;
  originPortCode?: string;
  pickupLocation?: string;
  pickupZip?: string;
  destinationPort?: string;
  destinationPortCode?: string;
  deliveryLocation?: string;
  deliveryZip?: string;
  rate: number;
  chassis?: number;
  overweight?: number;
  containerCount?: number;
  currency: string;
  validUntil: string;
  comments?: string;
  transitTime?: number;
  freeTime?: number;
  isAllIn?: boolean;
  pickupCost?: number;
  oceanCost?: number;
  deliveryCost?: number;
  portFees?: number;
  deconsolidation?: number;
  containerReturn?: number;
  blRelease?: number;
  thc?: number;
  isps?: number;
  trs?: number;
  securityFee?: number;
  observation?: string;
  originalDocument?: string;
  containerType?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED';
}

export interface CostCalculation {
  id: string;
  companyId: string;
  calculationNumber: string;
  date: string;
  productName: string;
  hsCode?: string;
  origin: string;
  destination: string;
  pickupLocation?: string;
  fobPrice: number;
  quantity: number;
  freightCost: number;
  insuranceCost: number;
  dutyPercent: number;
  portClearanceCost: number;
  deliveryCost: number;
  marginPercent: number;
  totalLandedCost: number;
  unitLandedCost: number;
  recommendedSalesPrice: number;
  deliveryCity?: string;
  deliveryZip?: string;
  deliveryMethod?: 'PICKUP' | 'DELIVERY' | 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';
  pickupMethod?: string;
  salesCommission?: number;
  salesCommissionType?: 'FLAT' | 'PERCENT';
  salesCarrierId?: string;
  salesCarrierName?: string;
  supplierName?: string;
  quoteNumber?: string;
  poa?: string;
  pod?: string;
  customerName?: string;
  loadingLocation?: string;
}

export interface PriceList {
  id: string;
  companyId?: string;
  name?: string;
  date?: string;
  items?: any;
  marginPercent?: number;
}


export interface Document {
  id: string;
  companyId: string;
  entityId: string;
  entityType: 'OPPORTUNITY' | 'ORDER' | 'SHIPMENT' | 'OTHER';
  type: 'PO' | 'BL' | 'INVOICE' | 'OTHER';
  name: string;
  url: string;
  uploadDate: string;
  size?: number;
}

export interface CargoAgent {
  id: string;
  companyId: string;
  code?: string;
  name: string;
  contact?: string;
  email?: string;
  email2?: string;
  phone?: string;
  country?: string;
}

export interface Carrier {
  id: string;
  companyId: string;
  code?: string;
  name: string;
  scac?: string;
  country?: string;
  contact?: string;
  email?: string;
  phone?: string;
}

export interface SavedLocation {
  id: string;
  companyId: string;
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  entityType: 'SUPPLIER' | 'CUSTOMER' | 'WAREHOUSE';
  entityId: string;
  entityName: string;
  contact?: string;
  email?: string;
  phone?: string;
}

export interface BillOfLading {
  id: string;
  companyId: string;
  createdAt?: string;
  blNumber: string;
  bookingNumber?: string;
  shipper: string;
  consignee: string;
  notifyParty?: string;
  vesselVoyage: string;
  portLoading: string;
  portDischarge: string;
  placeReceipt?: string;
  placeDelivery?: string;
  shippedDate: string;
  eta?: string;
  originals?: string;
  container?: string;
  seal?: string;
  description?: string;
  grossWeight?: string;
  measurement?: string;
  packages?: string;
  freightPayable?: string;
  remarks?: string;
  agentName?: string; // Cargo Agent Name for filtering
  originalDocument?: string;
  status?: string;
}

export interface Booking {
  id: string;
  companyId: string;
  createdAt?: string;
  bookingNumber: string;
  customer: string;
  vesselVoyage: string;
  pol: string;
  pod: string;
  equipment: string;
  etd: string;
  eta: string;
  cargoCutOff?: string;
  vgmCutOff?: string;
  draftCutOff?: string;
  freeTime?: string;
  terminal?: string;
  agentName?: string; // Cargo Agent Name for filtering
  originalDocument?: string;
  salesOrderId?: string;
  status?: 'REQUESTED' | 'ACTIVE' | 'SHIPPED' | 'CANCELLED' | 'AVAILABLE';
  carrier?: string;
  containerNumber?: string;
  blNumber?: string;
}

export interface Estimate {
  id: string;
  companyId: string;
  createdAt?: string;
  estimateNumber: string;
  supplier: string;
  buyer?: string;
  shipTo?: string;
  payTo?: string;
  date: string;
  terms?: string;
  incoterm?: string;
  subtotal?: number;
  tax?: number;
  totalAmount: number;
  currency: string;
  items?: string;
  acceptedBy?: string;
  acceptedDate?: string;
  originalDocument?: string;
}

export interface ProformaInvoice {
  id: string;
  companyId: string;
  createdAt?: string;
  piNumber: string;
  supplier: string;
  buyer?: string;
  shipTo?: string;
  payTo?: string;
  date: string;
  terms?: string;
  incoterm?: string;
  subtotal?: number;
  tax?: number;
  totalAmount: number;
  currency: string;
  items?: string;
  acceptedBy?: string;
  acceptedDate?: string;
  originalDocument?: string;
}

export interface PurchaseOrderExtract {
  id: string;
  companyId: string;
  createdAt?: string;
  poNumber: string;
  vendor: string;
  date: string;
  totalAmount: string;
  currency: string;
  items?: string;
  originalDocument?: string;
}

export interface Invoice {
  id: string;
  companyId: string;
  createdAt?: string;
  invoiceNumber: string;
  invoiceDate: string;
  shipperName: string;
  shipperAddress?: string;
  soldTo?: string;
  shipTo?: string;
  paymentTerms?: string;
  dateOrder?: string;
  customerPo?: string;
  carrier?: string;
  transportRef?: string;
  freightTerms?: string;
  items?: string;
  grossWeight?: string;
  netWeight?: string;
  tareWeight?: string;
  totalQuantity?: string;
  subtotal?: number;
  totalAmount: number;
  currency: string;
  remitTo?: string;
  bankName?: string;
  bankAddress?: string; // New Field for Bank Address
  swiftCode?: string;
  routingNumber?: string;
  accountNumber?: string;
  originalDocument?: string;
  supplier?: string;
  date?: string;
  plNumber?: string;
  soNumber?: string;
  containers?: string | any[];
  bank_details?: string | any;
  dueDate?: string;
  billToName?: string;
  billToAddress?: string;
  totalVolumes?: string;
  incoterm?: string;
  packaging?: string;
  commodity?: string;
  origin?: string;
  trackingNumber?: string;
  notes?: string;
  pod?: string;
  poa?: string; // Port of Arrival/Loading for PL-Invoice chain
  bl?: string; // Linked Bill of Lading number
  shipper?: string; // Shipper name for PL-Invoice chain
  consignee?: string; // Consignee for PL-Invoice chain
  bookingNumber?: string; // Booking reference for PL-Invoice chain
  memo?: string; // User memo/notes for additional information
  qb_status?: string; // QuickBooks sync status ('Sent' or null)
}

export interface SupplierInvoice extends Invoice { }

export interface PackingList {
  id: string;
  companyId: string;
  createdAt?: string;
  plNumber: string;
  blNumber?: string;
  shipper: string;
  supplier?: string;
  consignee: string;
  shippingPoint?: string;
  destination?: string;
  date: string;
  carrier?: string;
  containerNumber?: string;
  sealNumber?: string;
  vesselVoyage?: string;
  productDescription?: string;
  unitCount?: string;
  unitNumbers?: string;
  grossWeight?: string;
  netWeight?: string;
  freightTerms?: string;
  poNumber?: string;
  notes?: string;
  scheduledShipDate?: string;
  items?: string;
  containers?: string; // Container data as JSON string
  originalDocument?: string;
  soNumber?: string; // New Sales Order Number field
  status?: 'AVAILABLE' | 'INVOICED';
  invoiceNumber?: string;
}

export interface SalesOrderItem {
  productId: string;
  productName: string;
  customerDescription: string;
  hsCode: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface SalesOrder {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  orderNumber: string;
  orderDate: string;
  orderType: 'SPOT' | 'CONTRACT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'BOOKED';
  items: SalesOrderItem[];
  totalAmount: number;
  currency: string;
  paymentTerms: string;
  incoterm: string;
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  createdAt?: string;

  // New Fields
  saleType?: 'LOCAL' | 'EXPORT';
  deliveryMethod?: string; // PICKUP, DELIVERY, DOOR_TO_PORT etc
  deliveryAddress?: string;
  deliveryDate?: string; // Prompt, Specific Date
  pod?: string; // Port of Destination
  poa?: string; // Port of Origin / Acceptance (For Port-To-X stats)
  pickupLocation?: string; // Full Address (For Door-To-X stats)
  bankId?: string; // Selected bank for payment
  supplierName?: string; // Supplier from Source step
  supplierLoadingLocation?: string; // Supplier loading/pickup location
  soNumber?: string;
}

export interface FormLayout {
  id: string; // e.g., 'PROFORMA_INVOICE'
  companyId: string;
  name: string;
  layout: any; // JSON object
  updatedAt?: string;
}

export interface CommissionItem {
  id: string;
  productName: string;
  quantity: number;
  unit: 'LBS' | 'KGS';
  pricePerUnit: number;
  total: number;
}

export interface CommissionSalesOrder {
  id: string;
  companyId: string;
  orderNumber: string;
  sellerName: string;
  customerName: string;

  // Original Commission Order fields
  status?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SHIPPED' | 'COMPLETED' | 'REJECTED';
  paymentStatus?: 'PENDING';
  signedDocumentUrl?: string;
  approvedBy?: string;

  // New Commission from Invoice fields
  invoiceStatus?: 'UNPAID' | 'PAID';
  commissionPaymentStatus?: 'UNPAID' | 'PAID';
  invoiceNumber?: string;

  // Common fields
  incoterm: string;
  paymentTerms: string;
  pod: string;
  deliveryDate: string;
  etd?: string;
  eta?: string;
  bookingNumber?: string;
  blNumber?: string;
  vesselVoyage?: string;
  pol?: string;
  containerNumbers?: string;
  items: CommissionItem[];
  totalQuantity?: number;
  orderTotal: number;
  commissionRate: number;
  commissionType: 'PERCENT' | 'PER_LBS' | 'PER_KGS';
  commissionAmount: number;
  originalDocumentUrl?: string; // Used for Invoice in Invoice mode
  blDocumentUrl?: string; // New: Bill of Lading
  plDocumentUrl?: string; // New: Packing List
  bookingDocumentUrl?: string; // Booking confirmation PDF
  createdAt: string;
}
export interface BrazilSimulation {
  id: string;
  companyId: string;
  createdAt: string;
  name: string;

  // Inputs
  productDescription: string;
  ncm: string;
  portName: string;
  clearanceState: string;
  incoterm: 'CFR' | 'CIF';
  priceUsdPerTon: number;
  quantityKg: number;
  exchangeRate: number;
  insuranceUsd: number;
  oceanFreightBrl: number;
  thcCapatazia: number;
  storageWarehousing: number;
  terminalFees: number;
  customsBrokerFee: number;
  siscomexFee: number;
  inlandFreight: number;
  includeInlandInIcms: boolean;
  iiRate: number;
  ipiRate: number;
  pisRate: number;
  cofinsRate: number;
  applyAdditional1PctCofins: boolean;
  antidumpingValue: number;
  antidumpingType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
  cvdValue: number;
  cvdType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
  safeguardValue: number;
  safeguardType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
  selectedProgram: string;

  // Calculated Totals
  totalLandedCostBrl: number;
  costPerKgBrl: number;
  effectiveIcmsRate: number;
}

// ── QuickBooks Integration Types ──────────────────────────────

export interface QBSyncStatus {
  synced: boolean;
  qbEntityId?: string;
  qbEntityType?: 'Bill' | 'Invoice';
  syncedAt?: string;
  error?: string;
}

export interface QBConnectionStatus {
  connected: boolean;
  realmId?: string;
  companyName?: string;
  lastRefreshed?: string;
}

// ── AI Sales Agent ────────────────────────────────────────────

export type ProspectStage = 'new' | 'engaged' | 'qualified' | 'converted' | 'dropped';

export interface Prospect {
  id: string;
  companyId: string;
  name: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  source?: string | null;
  stage: ProspectStage;
  notes?: string | null;
  assignedTo?: string | null;
  createdAt: string;
}

export interface AiAgentIdentity {
  id: string;
  companyId: string;
  role: 'sales' | 'support' | 'logistics';
  displayName: string;
  emailAddress: string;
  whatsappSender: string;
  signature?: string | null;
  createdAt: string;
}

export type SalesProposalAudience = 'sales_rep' | 'customer' | 'prospect';
export type SalesProposalChannel = 'email' | 'whatsapp' | 'both';
export type SalesProposalStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'dismissed';
export type SalesProposalMode = 'auto' | 'review';

export interface AiSalesProposalLineItem {
  productName: string;
  customerDescription?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
}

export interface AiSalesProposal {
  id: string;
  companyId: string;
  audience: SalesProposalAudience;
  customerId?: string | null;
  prospectId?: string | null;
  salesRepId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  channel: SalesProposalChannel;
  status: SalesProposalStatus;
  mode: SalesProposalMode;
  intent: string;
  subject?: string | null;
  body?: string | null;
  whatsappPreview?: string | null;
  pdfUrl?: string | null;
  reasoning?: string | null;
  items?: AiSalesProposalLineItem[] | null;
  totalAmount?: number | null;
  currency?: string | null;
  agentIdentityId?: string | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  createdBy?: string | null;
  createdAt: string;
}
