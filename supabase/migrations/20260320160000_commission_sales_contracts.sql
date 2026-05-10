-- Commission Sales Contracts table
-- Stores OCR-extracted contract data and original PDF/image documents
CREATE TABLE IF NOT EXISTS commission_sales_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "contractNumber" TEXT NOT NULL,
    seller TEXT,
    buyer TEXT,
    date TEXT,
    total NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    incoterm TEXT,
    "paymentTerms" TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    "originalDocument" TEXT,  -- base64 data URL of the original PDF/image
    "originalDocType" TEXT,   -- MIME type of the original document
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by company
CREATE INDEX IF NOT EXISTS idx_commission_sales_contracts_company 
ON commission_sales_contracts ("companyId");

-- RLS policy
ALTER TABLE commission_sales_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON commission_sales_contracts
    FOR ALL USING (true) WITH CHECK (true);
