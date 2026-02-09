-- ============================================
-- ADD ALL MISSING COLUMNS TO INVOICES TABLE
-- Run this in Supabase SQL Editor
-- This fixes the 406 error by ensuring all columns exist
-- ============================================

-- Core fields
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "invoiceDate" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "date" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "billToName" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "soldTo" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "customerPo" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "shipperName" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "shipper" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "supplier" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "consignee" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "shipTo" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;

-- Financial fields
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "totalAmount" NUMERIC;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'USD';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "grossWeight" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "netWeight" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "totalQuantity" TEXT;

-- Bank details
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "bankAddress" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "accountNumber" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "swiftCode" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "routingNumber" TEXT;

-- Shipping / Logistics
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "transportRef" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "bookingNumber" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "incoterm" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "pod" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "plNumber" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "soNumber" TEXT;

-- Items / Containers (JSON stored as TEXT)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "items" TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "containers" TEXT;

-- Bill of Lading (stored as Base64 data URL)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "bolUrl" TEXT;
