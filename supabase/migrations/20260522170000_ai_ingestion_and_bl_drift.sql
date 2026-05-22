-- AI-assisted ingestion (Item #1) + BL draft drift detection (Item #4)
--
-- Pattern: agent writes to source-of-truth tables with `ai_status='ai_draft'`,
-- ERP shows yellow ring + Approve/Reject, user flips to 'approved' or 'rejected'.
--
-- bl_audits drift columns let Logan detect when a BL PDF is replaced with a
-- new draft revision, re-audit, and diff against the prior version.

BEGIN;

-- ── Item #1: ai_status on packing_lists + invoices ────────────────────
ALTER TABLE packing_lists
  ADD COLUMN IF NOT EXISTS ai_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS ai_source_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS ai_source_email_id TEXT,
  ADD COLUMN IF NOT EXISTS ai_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_extracted_by TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ai_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS ai_source_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS ai_source_email_id TEXT,
  ADD COLUMN IF NOT EXISTS ai_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_extracted_by TEXT;

-- Constrain ai_status values (no enum to keep migration reversible)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packing_lists_ai_status_chk') THEN
    ALTER TABLE packing_lists ADD CONSTRAINT packing_lists_ai_status_chk
      CHECK (ai_status IN ('ai_draft', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_ai_status_chk') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_ai_status_chk
      CHECK (ai_status IN ('ai_draft', 'approved', 'rejected'));
  END IF;
END $$;

-- Partial indexes for the "show me AI drafts" filter
CREATE INDEX IF NOT EXISTS idx_packing_lists_ai_draft
  ON packing_lists(ai_extracted_at DESC) WHERE ai_status = 'ai_draft';
CREATE INDEX IF NOT EXISTS idx_invoices_ai_draft
  ON invoices(ai_extracted_at DESC) WHERE ai_status = 'ai_draft';

-- ── Item #4: BL draft drift columns on bl_audits ──────────────────────
ALTER TABLE bl_audits
  ADD COLUMN IF NOT EXISTS source_pdf_path   TEXT,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS source_pdf_mtime  BIGINT,
  ADD COLUMN IF NOT EXISTS prior_issues_json JSONB,
  ADD COLUMN IF NOT EXISTS drift_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drift_new_issue_count INT DEFAULT 0;

COMMIT;
