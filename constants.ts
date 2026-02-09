

import { Customer, DealStage, Opportunity, Product, Shipment, Role, User, Company, InventoryItem, Quote, InventoryLog, Supplier, SupplierQuote, PurchaseOrder, Port } from './types';

export const PAYMENT_TERM_OPTIONS = ['Prepaid', 'LC at Sight', 'Net 10', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', '90% ADV - 10% CAD', '30% ADV - 70% CAD', '20% ADV - 80% CAD'];

export const MOCK_COMPANIES: Company[] = [];
export const MOCK_USERS: User[] = [];
export const MOCK_CUSTOMERS: Customer[] = [];
export const MOCK_PRODUCTS: Product[] = [];
export const MOCK_INVENTORY: InventoryItem[] = [];
export const MOCK_INVENTORY_LOGS: InventoryLog[] = [];
export const MOCK_OPPORTUNITIES: Opportunity[] = [];
export const MOCK_SHIPMENTS: Shipment[] = [];
export const MOCK_QUOTES: Quote[] = [];
export const MOCK_SUPPLIERS: Supplier[] = [];
export const MOCK_SUPPLIER_QUOTES: SupplierQuote[] = [];
export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [];
export const MOCK_PORTS: Port[] = [];