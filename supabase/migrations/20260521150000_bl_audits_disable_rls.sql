-- The XS-AI app uses its own application-layer auth (not Supabase
-- Auth), so client requests reach the database as the anon role.
-- Every other domain table in this DB has RLS disabled and relies on
-- the app for permission gating; bl_audits should match that pattern
-- so the Document Audit menu actually loads in the browser.
--
-- Hermes still writes via the service-role key, which always bypasses
-- RLS, so this change doesn't affect the agent-side ingest path.

alter table bl_audits disable row level security;
drop policy if exists bl_audits_select on bl_audits;
drop policy if exists bl_audits_update_decisions on bl_audits;
drop policy if exists bl_audits_insert on bl_audits;
