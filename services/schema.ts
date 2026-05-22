
export const SUPABASE_SCHEMA_SQL = `
-- 1. Core Tables
create table if not exists companies (
  "id" text primary key,
  "name" text,
  "nickname" text,
  "address" text,
  "city" text,
  "state" text,
  "zip" text,
  "country" text,
  "ein" text,
  "phone" text,
  "email" text
);

create table if not exists users (
  "id" text primary key,
  "name" text,
  "username" text,
  "password" text,
  "role" text,
  "avatarInitials" text,
  "email" text,
  "phone" text,
  "allowed_company_ids" text[],
  "allowed_modules" text[],
  "canManageInventory" boolean,
  "linked_entity_id" text
);

create table if not exists imagens (
  "id" text primary key,
  "companyId" text,
  "url" text,
  "name" text,
  "createdAt" text,
  "type" text
);

-- 2. CRM Tables
create table if not exists customers (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "nickname" text,
  "taxId" text,
  "contactPerson" text,
  "email" text,
  "email2" text,
  "email3" text,
  "phone" text,
  "location" text,
  "city" text,
  "state" text,
  "zip" text,
  "country" text,
  "creditLimit" numeric,
  "paymentTerms" text,
  "status" text,
  "totalVolumeLBS" numeric,
  "lastOrderDate" text,
  "sharedWith" text[],
  "pod" text
);

create table if not exists suppliers (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "taxId" text,
  "contactPerson" text,
  "email" text,
  "phone" text,
  "location" text,
  "city" text,
  "state" text,
  "zip" text,
  "country" text,
  "categories" text[],
  "rating" numeric,
  "paymentTerms" text,
  "sharedWith" text[]
);

create table if not exists opportunities (
  "id" text primary key,
  "companyId" text,
  "customerId" text,
  "customerName" text,
  "productName" text,
  "volumeLBS" numeric,
  "value" numeric,
  "items" jsonb,
  "stage" text,
  "probability" numeric,
  "expectedCloseDate" text,
  "assignedTo" text,
  "comments" text,
  "poNumber" text
);

create table if not exists sales_orders (
  "id" text primary key,
  "companyId" text,
  "customerId" text,
  "customerName" text,
  "orderNumber" text,
  "orderDate" text,
  "orderType" text,
  "status" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "paymentTerms" text,
  "incoterm" text,
  "notes" text,
  "createdBy" text,
  "approvedBy" text,
  "createdAt" text,
  "saleType" text,
  "deliveryMethod" text,
  "deliveryAddress" text,
  "deliveryDate" text,
  "pod" text,
  "poa" text,
  "pickupLocation" text,
  "bankId" text
);

-- 3. Product & Inventory
create table if not exists products (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "supplierProductName" text,
  "description" text,
  "sku" text,
  "category" text,
  "grade" text,
  "hsCode" text,
  "supplier" text,
  "price" numeric,
  "stockStatus" text,
  "specs" jsonb,
  "tdsFile" text,
  "tdsUrl" text,
  "sharedWith" text[],
  "imageIds" text[],
  -- Curated-vs-auto distinction. Defaults to true so existing rows
  -- stay visible in the system-product dropdowns. New rows
  -- auto-created from OCR via ensureProducts() write false, so they
  -- live in the catalog (still searchable by Products page) but stay
  -- out of curated dropdowns until a human picks/promotes them.
  "isSystemProduct" boolean not null default true
);

create table if not exists inventory (
  "id" text primary key,
  "companyId" text,
  "productId" text,
  "productName" text,
  "grade" text,
  "quantityLBS" numeric,
  "warehouseLocation" text,
  "lastUpdated" text,
  "notes" text
);

create table if not exists inventory_logs (
  "id" text primary key,
  "companyId" text,
  "inventoryId" text,
  "productName" text,
  "grade" text,
  "type" text,
  "quantityChange" numeric,
  "newQuantity" numeric,
  "documentReference" text,
  "date" text,
  "performedBy" text
);

-- 4. Logistics & Shipping
create table if not exists ports (
  "id" text primary key,
  "companyId" text,
  "code" text,
  "name" text,
  "country" text
);

create table if not exists carriers (
  "id" text primary key,
  "companyId" text,
  "code" text,
  "name" text,
  "scac" text,
  "country" text,
  "contact" text,
  "email" text,
  "phone" text
);

create table if not exists cargo_agents (
  "id" text primary key,
  "companyId" text,
  "code" text,
  "name" text,
  "contact" text,
  "email" text,
  "email2" text,
  "phone" text,
  "country" text
);

create table if not exists saved_locations (
  "id" text primary key,
  "companyId" text,
  "code" text,
  "name" text,
  "address" text,
  "city" text,
  "state" text,
  "zip" text,
  "country" text,
  "entityType" text,
  "entityId" text,
  "entityName" text,
  "contact" text,
  "email" text,
  "phone" text
);

create table if not exists freight_quotes (
  "id" text primary key,
  "companyId" text,
  "agentName" text,
  "carrier" text,
  "freightType" text,
  "originPort" text,
  "originPortCode" text,
  "pickupLocation" text,
  "pickupZip" text,
  "destinationPort" text,
  "destinationPortCode" text,
  "deliveryLocation" text,
  "deliveryZip" text,
  "rate" numeric,
  "chassis" numeric,
  "overweight" numeric,
  "containerCount" numeric,
  "currency" text,
  "validUntil" text,
  "comments" text,
  "transitTime" numeric,
  "freeTime" numeric,
  "isAllIn" boolean,
  "pickupCost" numeric,
  "oceanCost" numeric,
  "deliveryCost" numeric,
  "portFees" numeric,
  "deconsolidation" numeric,
  "containerReturn" numeric,
  "blRelease" numeric,
  "thc" numeric,
  "isps" numeric,
  "trs" numeric,
  "securityFee" numeric,
  "observation" text,
  "originalDocument" text,
  "status" text
);

create table if not exists shipments (
  "id" text primary key,
  "companyId" text,
  "containerNumber" text,
  "blNumber" text,
  "origin" text,
  "destination" text,
  "status" text,
  "etd" text,
  "eta" text,
  "carrier" text,
  "products" jsonb
);

-- 5. Documentation (The Missing Pieces)
create table if not exists bill_landings (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "blNumber" text,
  "shipper" text,
  "consignee" text,
  "notifyParty" text,
  "vesselVoyage" text,
  "portLoading" text,
  "portDischarge" text,
  "placeReceipt" text,
  "placeDelivery" text,
  "shippedDate" text,
  "originals" text,
  "container" text,
  "seal" text,
  "description" text,
  "grossWeight" text,
  "measurement" text,
  "packages" text,
  "freightPayable" text,
  "remarks" text,
  "originalDocument" text,
  "status" text
);

create table if not exists bookings (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "bookingNumber" text,
  "customer" text,
  "vesselVoyage" text,
  "pol" text,
  "pod" text,
  "equipment" text,
  "etd" text,
  "eta" text,
  "cargoCutOff" text,
  "vgmCutOff" text,
  "draftCutOff" text,
  "freeTime" text,
  "terminal" text,
  "originalDocument" text,
  "salesOrderId" text,
  "status" text
);

create table if not exists estimates (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "estimateNumber" text,
  "supplier" text,
  "buyer" text,
  "shipTo" text,
  "payTo" text,
  "date" text,
  "terms" text,
  "incoterm" text,
  "subtotal" numeric,
  "tax" numeric,
  "totalAmount" numeric,
  "currency" text,
  "items" text,
  "acceptedBy" text,
  "acceptedDate" text,
  "originalDocument" text
);

create table if not exists proforma_invoices (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "piNumber" text,
  "supplier" text,
  "buyer" text,
  "shipTo" text,
  "payTo" text,
  "date" text,
  "terms" text,
  "incoterm" text,
  "subtotal" numeric,
  "tax" numeric,
  "totalAmount" numeric,
  "currency" text,
  "items" text,
  "acceptedBy" text,
  "acceptedDate" text,
  "originalDocument" text
);

create table if not exists purchase_order_extracts (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "poNumber" text,
  "vendor" text,
  "date" text,
  "totalAmount" text,
  "currency" text,
  "items" text,
  "originalDocument" text
);

create table if not exists invoices (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "invoiceNumber" text,
  "invoiceDate" text,
  "shipperName" text,
  "shipperAddress" text,
  "soldTo" text,
  "shipTo" text,
  "paymentTerms" text,
  "incoterms" text,
  "dateOrder" text,
  "customerPo" text,
  "carrier" text,
  "transportRef" text,
  "freightTerms" text,
  "items" text,
  "grossWeight" text,
  "netWeight" text,
  "tareWeight" text,
  "totalQuantity" text,
  "subtotal" numeric,
  "totalAmount" numeric,
  "currency" text,
  "remitTo" text,
  "bankName" text,
  "bankAddress" text,
  "swiftCode" text,
  "routingNumber" text,
  "accountNumber" text,
  "originalDocument" text,
  "supplier" text,
  "date" text
);

create table if not exists invoices_suppliers (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "invoiceNumber" text,
  "invoiceDate" text,
  "shipperName" text,
  "shipperAddress" text,
  "soldTo" text,
  "shipTo" text,
  "paymentTerms" text,
  "incoterms" text,
  "dateOrder" text,
  "customerPo" text,
  "carrier" text,
  "transportRef" text,
  "freightTerms" text,
  "items" text,
  "grossWeight" text,
  "netWeight" text,
  "tareWeight" text,
  "totalQuantity" text,
  "subtotal" numeric,
  "totalAmount" numeric,
  "currency" text,
  "remitTo" text,
  "bankName" text,
  "swiftCode" text,
  "routingNumber" text,
  "accountNumber" text,
  "originalDocument" text,
  "supplier" text,
  "date" text
);

create table if not exists packing_lists (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "plNumber" text,
  "blNumber" text,
  "shipper" text,
  "consignee" text,
  "shippingPoint" text,
  "destination" text,
  "date" text,
  "carrier" text,
  "containerNumber" text,
  "sealNumber" text,
  "vesselVoyage" text,
  "productDescription" text,
  "unitCount" text,
  "unitNumbers" text,
  "grossWeight" text,
  "netWeight" text,
  "freightTerms" text,
  "poNumber" text,
  "notes" text,
  "scheduledShipDate" text,
  "items" text,
  "originalDocument" text,
  "soNumber" text,
  "status" text
);

create table if not exists packing_lists_suppliers (
  "id" text primary key,
  "companyId" text,
  "createdAt" text,
  "filename" text,
  "extractedData" jsonb,
  "originalDocument" text,
  "productDescription" text,
  "containerNumber" text,
  "sealNumber" text,
  "grossLbs" numeric,
  "netLbs" numeric,
  "grossKg" numeric,
  "netKg" numeric,
  "volumes" numeric,
  "supplier" text,
  "blNumber" text,
  "soNumber" text,
  "bookingNumber" text
);

-- 6. Purchasing
create table if not exists supplier_quotes (
  "id" text primary key,
  "quoteNumber" text,
  "companyId" text,
  "supplierId" text,
  "supplierName" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "incoterm" text,
  "loadingLocation" text,
  "originPort" text,
  "destinationPort" text,
  "validUntil" text,
  "paymentTerms" text,
  "status" text,
  "notes" text,
  "originalDocument" text
);

create table if not exists supplier_offers (
  "id" text primary key,
  "offerNumber" text,
  "companyId" text,
  "supplierId" text,
  "supplierName" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "incoterm" text,
  "loadingLocation" text,
  "originPort" text,
  "destinationPort" text,
  "validUntil" text,
  "paymentTerms" text,
  "status" text,
  "notes" text
);

create table if not exists purchase_orders (
  "id" text primary key,
  "companyId" text,
  "supplierId" text,
  "supplierName" text,
  "status" text,
  "orderDate" text,
  "expectedDeliveryDate" text,
  "paymentTerms" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "notes" text
);

create table if not exists cost_calculations (
  "id" text primary key,
  "companyId" text,
  "calculationNumber" text,
  "date" text,
  "productName" text,
  "hsCode" text,
  "origin" text,
  "destination" text,
  "pickupLocation" text,
  "fobPrice" numeric,
  "quantity" numeric,
  "freightCost" numeric,
  "insuranceCost" numeric,
  "dutyPercent" numeric,
  "portClearanceCost" numeric,
  "deliveryCost" numeric,
  "marginPercent" numeric,
  "totalLandedCost" numeric,
  "unitLandedCost" numeric,
  "recommendedSalesPrice" numeric,
  "deliveryCity" text,
  "deliveryZip" text,
  "deliveryMethod" text,
  "pickupMethod" text,
  "salesCommission" numeric,
  "salesCommissionType" text,
  "salesCarrierId" text,
  "salesCarrierName" text,
  "supplierName" text,
  "quoteNumber" text,
  "poa" text,
  "pod" text,
  "customerName" text
);

-- 7. Misc
create table if not exists form_layouts (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "layout" jsonb,
  "updatedAt" timestamp with time zone default now()
);

create table if not exists customer_banks (
  "id" text primary key,
  "companyId" text,
  "customerId" text,
  "bankName" text,
  "bankAddress" text,
  "routingNumber" text,
  "swiftCode" text,
  "accountNumber" text,
  "createdAt" text
);

create table if not exists costumer_description (
    "customer_id" text,
    "original_description" text,
    "customer_description" text,
    "hs_code" text,
    "unit_price_lbs" numeric,
    "unit_price_kgs" numeric,
    primary key ("customer_id", "original_description")
);

-- 8. WhatsApp / Twilio
create table if not exists wa_conversations (
  "id" text primary key,
  "companyId" text,
  "twilioNumber" text,
  "phoneNumber" text,
  "contactName" text default '',
  "status" text default 'active',
  "unreadCount" integer default 0,
  "lastMessagePreview" text default '',
  "lastMessageAt" text,
  "createdAt" text
);

create table if not exists wa_messages (
  "id" text primary key,
  "conversationId" text,
  "content" text,
  "direction" text,
  "messageType" text default 'text',
  "status" text default 'sent',
  "twilioSid" text default '',
  "metadata" jsonb default '{}',
  "createdAt" text
);

create table if not exists commission_sales_orders (
  "id" text primary key,
  "companyId" text,
  "orderNumber" text,
  "sellerName" text,
  "customerName" text,
  "status" text,
  "incoterm" text,
  "paymentTerms" text,
  "pod" text,
  "deliveryDate" text,
  "items" jsonb,
  "totalQuantity" numeric,
  "orderTotal" numeric,
  "commissionRate" numeric,
  "commissionType" text,
  "commissionAmount" numeric,
  "originalDocumentUrl" text,
  "blDocumentUrl" text,
  "plDocumentUrl" text,
  "signedDocumentUrl" text,
  "paymentStatus" text,
  "invoiceStatus" text,
  "commissionPaymentStatus" text,
  "invoiceNumber" text,
  "commissionInvoiceNumber" text,
  "commissionInvoiceDate" text,
  "commissionInvoicePdfUrl" text,
  "createdAt" text,
  "approvedBy" text
);

-- 9. AI Assistant Memory
create table if not exists ai_conversations (
  "id" text primary key,
  "userId" text not null,
  "companyId" text default 'ALL',
  "title" text default '',
  "lastMessageAt" text,
  "messageCount" integer default 0,
  "createdAt" text
);

create table if not exists ai_messages (
  "id" text primary key,
  "conversationId" text not null,
  "role" text not null,
  "content" text not null,
  "actionType" text,
  "actionData" jsonb default '{}',
  "createdAt" text
);

create table if not exists ai_learned_tasks (
  "id" text primary key,
  "userId" text not null,
  "companyId" text default 'ALL',
  "trigger" text not null,
  "instruction" text not null,
  "parameters" jsonb default '{}',
  "createdAt" text
);

-- 10. AI Sales Agent
create table if not exists prospects (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "companyName" text,
  "email" text,
  "phone" text,
  "country" text,
  "source" text,
  "stage" text default 'new',
  "notes" text,
  "assignedTo" text,
  "createdAt" text
);

create table if not exists ai_agent_identities (
  "id" text primary key,
  "companyId" text,
  "role" text,
  "displayName" text,
  "emailAddress" text,
  "whatsappSender" text,
  "signature" text,
  "createdAt" text
);

create table if not exists ai_sales_proposals (
  "id" text primary key,
  "companyId" text,
  "audience" text,
  "customerId" text,
  "prospectId" text,
  "salesRepId" text,
  "recipientName" text,
  "recipientEmail" text,
  "recipientPhone" text,
  "channel" text,
  "status" text default 'draft',
  "mode" text default 'review',
  "intent" text,
  "subject" text,
  "body" text,
  "whatsappPreview" text,
  "pdfUrl" text,
  "reasoning" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "agentIdentityId" text,
  "sentAt" text,
  "errorMessage" text,
  "createdBy" text,
  "createdAt" text
);

-- 11. Activity Logging (AI-Trainable)
create table if not exists activity_logs (
  "id" text primary key,
  "timestamp" timestamptz default now(),
  "session_id" text not null,
  "user_id" text,
  "user_role" text,
  "company_id" text,
  "event_category" text not null,
  "event_action" text not null,
  "module" text,
  "sub_module" text,
  "entity_type" text,
  "entity_id" text,
  "details" jsonb default '{}',
  "duration_ms" integer,
  "error" text,
  "result_status" text default 'SUCCESS'
);
`;