-- Capture the user's per-issue correction decisions on the audit row.
-- Schema-less JSONB array; canonical entry shape matches the
-- AppliedCorrection TypeScript type in v2/queries/useBlAudits.ts:
--   {
--     field:       string,           -- e.g. "net_weight"
--     doc:         'CI' | 'PL',      -- which document gets corrected
--     old_value:   string | null,    -- typically null (missing data)
--     new_value:   string,           -- approved cross-fill value
--     approved_at: string,           -- ISO timestamp
--     approved_by: string | null     -- user email when known
--   }
--
-- For CI / PL suggestions the XS-AI app stamps the approval here; the
-- Hermes Agent polling worker reads the array on its next pass and
-- writes the corrected value into the source document table it owns.
-- BL corrections still flow through the existing email path
-- (correction_authorized → send-pending-corrections.py).

alter table bl_audits add column if not exists applied_corrections jsonb default '[]'::jsonb;
