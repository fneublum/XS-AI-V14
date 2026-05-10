// Agent v2 — declarative catalog of "entities the agent can touch".
//
// Every table the agent is allowed to read / mutate registers here.
// The generic list/get/create/update/delete tools read this map to know
// the table name, which columns are safe to search on, which are
// writable (user never writes to id / createdAt / system columns), etc.
//
// Add a new entity: append an entry here and it becomes reachable by
// the agent. No tool code changes needed.

export interface EntityDef {
  /** Canonical name used in tool input (e.g. "customer", not "customers"). */
  key: string;
  /** Supabase table name. */
  table: string;
  /** Prefix for auto-generated ids. */
  idPrefix: string;
  /** Columns the list/search tool may match on (ILIKE). Order matters —
   *  first match wins when the agent calls find_entity_by_name. */
  searchColumns: string[];
  /** Columns the agent may include on create/update. Anything outside
   *  this allowlist is silently stripped. Keeps Claude from writing to
   *  protected columns (companyId, createdAt, sharedWith, etc.). */
  writableColumns: string[];
  /** Columns returned by default on list/get (keeps payloads small). */
  summaryColumns: string[];
  /** Whether this entity is scoped by company. When true, list queries
   *  filter by `companyId = ctx.companyId` (unless ctx is 'ALL'), and
   *  inserts auto-populate `companyId`. */
  companyScoped: boolean;
  /** Human label for audit log + confirmation UI. */
  humanLabel: string;
}

export const ENTITIES: EntityDef[] = [
  {
    key: 'customer',
    table: 'customers',
    idPrefix: 'CUST',
    searchColumns: ['name', 'nickname', 'taxId', 'email'],
    writableColumns: [
      'name', 'nickname', 'taxId', 'contactPerson',
      'email', 'email2', 'email3', 'phone',
      'location', 'city', 'state', 'zip', 'country', 'pod',
      'creditLimit', 'paymentTerms', 'status', 'totalVolumeLBS',
      'brokerName', 'brokerEmail',
    ],
    summaryColumns: ['id', 'name', 'email', 'phone', 'country', 'status'],
    companyScoped: true,
    humanLabel: 'customer',
  },
  {
    key: 'supplier',
    table: 'suppliers',
    idPrefix: 'SUP',
    searchColumns: ['name', 'taxId', 'email'],
    writableColumns: [
      'name', 'taxId', 'contactPerson', 'email', 'phone',
      'location', 'city', 'state', 'zip', 'country',
      'paymentTerms', 'status',
    ],
    summaryColumns: ['id', 'name', 'email', 'country', 'status'],
    companyScoped: true,
    humanLabel: 'supplier',
  },
  {
    key: 'product',
    table: 'products',
    idPrefix: 'PRD',
    searchColumns: ['sku', 'description', 'grade'],
    writableColumns: [
      'sku', 'description', 'grade', 'resin', 'color',
      'melt', 'moisture', 'additives', 'origin', 'basePriceUSD',
      'listPriceUSD', 'status', 'notes',
    ],
    summaryColumns: ['id', 'sku', 'description', 'grade', 'listPriceUSD'],
    companyScoped: true,
    humanLabel: 'product',
  },
  {
    key: 'sales_order',
    table: 'sales_orders',
    idPrefix: 'SO',
    searchColumns: ['orderNumber', 'customerName', 'status'],
    writableColumns: [
      'orderNumber', 'orderDate', 'customerId', 'customerName',
      'deliveryMethod', 'paymentTerms', 'incoterms', 'pod', 'pol',
      'status', 'notes', 'bankId', 'notifyParty',
    ],
    summaryColumns: ['id', 'orderNumber', 'customerName', 'orderDate', 'status'],
    companyScoped: true,
    humanLabel: 'sales order',
  },
  {
    key: 'invoice',
    table: 'invoices',
    idPrefix: 'INV',
    searchColumns: ['invoiceNumber', 'billToName', 'consignee', 'status'],
    writableColumns: [
      'invoiceNumber', 'invoiceDate', 'billToName', 'soldTo', 'consignee',
      'shipTo', 'status', 'paymentTerms', 'incoterms', 'pod', 'pol',
      'notes', 'bookingNumber', 'transportRef',
    ],
    summaryColumns: ['id', 'invoiceNumber', 'billToName', 'invoiceDate', 'status'],
    companyScoped: true,
    humanLabel: 'invoice',
  },
  {
    key: 'purchase_order',
    table: 'purchase_orders',
    idPrefix: 'PO',
    searchColumns: ['poNumber', 'supplierName', 'status'],
    writableColumns: [
      'poNumber', 'orderDate', 'supplierId', 'supplierName',
      'paymentTerms', 'incoterms', 'status', 'notes',
    ],
    summaryColumns: ['id', 'poNumber', 'supplierName', 'orderDate', 'status'],
    companyScoped: true,
    humanLabel: 'purchase order',
  },
  {
    key: 'packing_list',
    table: 'packing_lists',
    idPrefix: 'PL',
    searchColumns: ['plNumber', 'blNumber', 'soNumber', 'consignee'],
    writableColumns: [
      'plNumber', 'blNumber', 'soNumber', 'consignee',
      'containerNumber', 'carrier', 'scheduledShipDate',
      'status', 'date', 'notes',
    ],
    summaryColumns: ['id', 'plNumber', 'blNumber', 'consignee', 'status'],
    companyScoped: true,
    humanLabel: 'packing list',
  },
  {
    key: 'bill_of_lading',
    table: 'bill_of_ladings',
    idPrefix: 'BL',
    searchColumns: ['blNumber', 'consignee', 'containerNumber'],
    writableColumns: [
      'blNumber', 'consignee', 'shipper', 'carrier',
      'containerNumber', 'vessel', 'voyage', 'pol', 'pod',
      'etd', 'eta', 'agentName', 'status', 'notes',
    ],
    summaryColumns: ['id', 'blNumber', 'consignee', 'carrier', 'status'],
    companyScoped: true,
    humanLabel: 'bill of lading',
  },
  {
    key: 'freight_quote',
    table: 'freight_quotes',
    idPrefix: 'FQ',
    searchColumns: ['quote_number', 'agent_name', 'origin', 'destination'],
    writableColumns: [
      'quote_number', 'agent_name', 'origin', 'destination',
      'container_type', 'rate_usd', 'valid_until', 'notes', 'status',
    ],
    summaryColumns: ['id', 'quote_number', 'agent_name', 'origin', 'destination', 'rate_usd'],
    companyScoped: true,
    humanLabel: 'freight quote',
  },
  {
    key: 'booking',
    table: 'bookings',
    idPrefix: 'BK',
    searchColumns: ['bookingNumber', 'agentName', 'customerName'],
    writableColumns: [
      'bookingNumber', 'agentName', 'customerName',
      'containerNumber', 'vessel', 'voyage', 'pol', 'pod',
      'etd', 'eta', 'status', 'notes',
    ],
    summaryColumns: ['id', 'bookingNumber', 'agentName', 'pol', 'pod', 'status'],
    companyScoped: true,
    humanLabel: 'booking',
  },
  {
    key: 'receivable',
    table: 'receivables',
    idPrefix: 'AR',
    searchColumns: ['invoiceNumber', 'customerName'],
    writableColumns: [
      'invoiceNumber', 'customerName', 'amount', 'dueDate',
      'status', 'notes',
    ],
    summaryColumns: ['id', 'invoiceNumber', 'customerName', 'amount', 'dueDate', 'status'],
    companyScoped: true,
    humanLabel: 'receivable',
  },
  {
    key: 'payable',
    table: 'payables',
    idPrefix: 'AP',
    searchColumns: ['billNumber', 'supplierName'],
    writableColumns: [
      'billNumber', 'supplierName', 'amount', 'dueDate',
      'status', 'notes',
    ],
    summaryColumns: ['id', 'billNumber', 'supplierName', 'amount', 'dueDate', 'status'],
    companyScoped: true,
    humanLabel: 'payable',
  },
  {
    key: 'commission',
    table: 'commissions',
    idPrefix: 'COM',
    searchColumns: ['orderNumber', 'agentName', 'customerName'],
    writableColumns: [
      'orderNumber', 'agentName', 'customerName',
      'amount', 'rate', 'status', 'notes',
    ],
    summaryColumns: ['id', 'orderNumber', 'agentName', 'amount', 'status'],
    companyScoped: true,
    humanLabel: 'commission',
  },
  {
    key: 'cargo_agent',
    table: 'cargo_agents',
    idPrefix: 'CAG',
    searchColumns: ['name', 'email'],
    writableColumns: [
      'name', 'email', 'phone', 'contactPerson',
      'country', 'notes',
    ],
    summaryColumns: ['id', 'name', 'email', 'country'],
    companyScoped: true,
    humanLabel: 'cargo agent',
  },
  {
    key: 'payment_term',
    table: 'payment_terms',
    idPrefix: 'PT',
    searchColumns: ['description', 'code'],
    writableColumns: ['description', 'code', 'daysNet', 'notes'],
    summaryColumns: ['id', 'code', 'description', 'daysNet'],
    companyScoped: true,
    humanLabel: 'payment term',
  },
];

const BY_KEY = new Map<string, EntityDef>(ENTITIES.map(e => [e.key, e]));

export function getEntityDef(key: string): EntityDef | null {
  return BY_KEY.get(key) ?? null;
}

export function entityKeys(): string[] {
  return ENTITIES.map(e => e.key);
}

/**
 * Filter a payload down to writable columns for the given entity.
 * Anything outside `writableColumns` is silently dropped — the agent
 * can try to write `id` or `companyId`, but those will never reach the
 * DB. Returns the filtered payload and the list of stripped keys (for
 * debugging + audit).
 */
export function sanitizePayload(
  ent: EntityDef,
  payload: Record<string, unknown>,
): { clean: Record<string, unknown>; dropped: string[] } {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  const allowed = new Set(ent.writableColumns);
  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) clean[k] = v;
    else dropped.push(k);
  }
  return { clean, dropped };
}
