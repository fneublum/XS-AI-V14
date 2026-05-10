-- Create commissions_proformas table for storing proforma invoices
CREATE TABLE IF NOT EXISTS commissions_proformas (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pi_number TEXT NOT NULL,
    pi_date TEXT,
    seller TEXT,
    buyer TEXT,
    incoterm TEXT,
    payment_terms TEXT,
    pod TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    total NUMERIC DEFAULT 0,
    contract_id TEXT,
    status TEXT DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE commissions_proformas ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "commissions_proformas_all" ON commissions_proformas
    FOR ALL USING (true) WITH CHECK (true);
