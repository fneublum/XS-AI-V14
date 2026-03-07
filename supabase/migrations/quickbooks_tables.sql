-- QuickBooks Integration: Database Tables
-- Run this in the Supabase SQL editor to create the required tables.

-- ── qb_tokens ─────────────────────────────────────────────────
-- Stores OAuth 2.0 tokens per X-Solution company
CREATE TABLE IF NOT EXISTS qb_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id TEXT NOT NULL UNIQUE,
    realm_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE qb_tokens ENABLE ROW LEVEL SECURITY;

-- Service role only (Edge Functions use service role key)
CREATE POLICY "Service role full access" ON qb_tokens
    FOR ALL USING (true) WITH CHECK (true);

-- ── qb_sync_log ──────────────────────────────────────────────
-- Tracks which invoices have been synced to QuickBooks
CREATE TABLE IF NOT EXISTS qb_sync_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source_table TEXT NOT NULL,          -- 'invoices_suppliers' or 'invoices'
    source_id TEXT NOT NULL,             -- X-Solution invoice ID
    qb_entity_type TEXT NOT NULL,        -- 'Bill' or 'Invoice'
    qb_entity_id TEXT,                   -- QBO entity ID (null on error)
    sync_status TEXT NOT NULL DEFAULT 'pending',  -- 'success', 'error', 'pending'
    error_message TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by source invoice
CREATE INDEX IF NOT EXISTS idx_qb_sync_log_source
    ON qb_sync_log (source_table, source_id);

-- Index for batch status queries
CREATE INDEX IF NOT EXISTS idx_qb_sync_log_status
    ON qb_sync_log (source_table, sync_status);

-- Enable RLS
ALTER TABLE qb_sync_log ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access" ON qb_sync_log
    FOR ALL USING (true) WITH CHECK (true);

-- Anon read access (frontend needs to read sync statuses)
CREATE POLICY "Anon read access" ON qb_sync_log
    FOR SELECT USING (true);
