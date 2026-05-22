-- Denormalize document header fields onto bl_audits so the Document
-- Audit list view can show Date / Shipper / Consignee / Invoice # as
-- columns without joining out to the source CI / PL / BL document
-- tables. The audit row is the natural place for these — Hermes Agent
-- already reads all three source docs to compute the audit; it just has
-- to write a few extra fields into the row.
--
-- Hermes Agent (Mac mini side) must be updated to populate these on
-- every audit run going forward. Existing rows are best-effort
-- backfilled below from issues_json[] where Hermes flagged a relevant
-- discrepancy. Rows without that flag stay NULL until they are
-- re-audited (or a more thorough backfill runs).

alter table bl_audits add column if not exists shipper        text;
alter table bl_audits add column if not exists consignee      text;
alter table bl_audits add column if not exists invoice_number text;
alter table bl_audits add column if not exists bl_date        date;

-- ── Backfill: shipper ────────────────────────────────────────────────
-- Hermes stores per-document values in issues_json[].ci / .pl / .bl.
-- CI is the source of truth for shipper/consignee; fall back to BL.
update bl_audits ba
set shipper = (
  select coalesce(iss->>'ci', iss->>'bl')
  from jsonb_array_elements(ba.issues_json) iss
  where iss->>'field' in (
      'shipper', 'shipper_name', 'shipper_exporter', 'shipper_exporter_name',
      'exporter_name', 'exporter_entity'
    )
    and coalesce(iss->>'ci', iss->>'bl') is not null
    and coalesce(iss->>'ci', iss->>'bl') <> ''
  limit 1
)
where ba.shipper is null;

-- ── Backfill: consignee ──────────────────────────────────────────────
update bl_audits ba
set consignee = (
  select coalesce(iss->>'ci', iss->>'bl')
  from jsonb_array_elements(ba.issues_json) iss
  where iss->>'field' in (
      'consignee', 'consignee_name', 'consignee_importer', 'consignee_address'
    )
    and coalesce(iss->>'ci', iss->>'bl') is not null
    and coalesce(iss->>'ci', iss->>'bl') <> ''
  limit 1
)
where ba.consignee is null;

-- ── Backfill: bl_date ────────────────────────────────────────────────
-- BL date specifically. The cast can fail silently for malformed
-- strings, so wrap in a try-cast pattern. Postgres has no native
-- TRY_CAST; use a regex pre-check that ISO-like dates match.
update bl_audits ba
set bl_date = (
  select to_date(value, 'YYYY-MM-DD')
  from (
    select coalesce(iss->>'bl', iss->>'ci') as value
    from jsonb_array_elements(ba.issues_json) iss
    where iss->>'field' in ('bl_date', 'bl_document_date', 'document_date', 'issue_date')
      and coalesce(iss->>'bl', iss->>'ci') ~ '^\d{4}-\d{2}-\d{2}'
    limit 1
  ) s
  where value is not null
)
where ba.bl_date is null;

-- invoice_number: no reliable source field in issues_json (only
-- 'invoice_amount_mismatch', 'invoice_date_timing', etc. show up — none
-- carry the invoice number itself). Hermes must populate this going
-- forward.
