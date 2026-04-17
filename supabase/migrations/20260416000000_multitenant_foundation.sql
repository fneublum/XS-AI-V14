-- Phase 1b — Multi-tenant foundation (Part 1: company_id columns)
--
-- Adds nullable company_id columns to tables that don't yet have one so
-- Phase 1d can enable per-tenant RLS without breaking existing rows.
-- Nullable columns mean all existing data remains readable by the app
-- layer (which currently filters on companyId client-side in
-- App.tsx:297-305 via filterByCompany()).
--
-- No backfill is performed here — that is scheduled for Phase 1d along
-- with RLS policy rollout. All changes are idempotent.

-- ── wa_messages (camelCase convention — matches wa_conversations.companyId) ──
ALTER TABLE IF EXISTS wa_messages
  ADD COLUMN IF NOT EXISTS "companyId" text;

CREATE INDEX IF NOT EXISTS wa_messages_companyid_idx
  ON wa_messages ("companyId");

-- ── costumer_description (snake_case convention — matches customer_id) ──
-- (sic: misspelled table name preserved from schema.ts)
ALTER TABLE IF EXISTS costumer_description
  ADD COLUMN IF NOT EXISTS company_id text;

CREATE INDEX IF NOT EXISTS costumer_description_company_id_idx
  ON costumer_description (company_id);

-- ── system_settings (global settings table — new column allows per-company overrides) ──
-- When NULL, the setting applies globally (preserves existing behavior).
-- When set, the setting is scoped to that company.
ALTER TABLE IF EXISTS system_settings
  ADD COLUMN IF NOT EXISTS company_id text;

CREATE INDEX IF NOT EXISTS system_settings_company_id_idx
  ON system_settings (company_id);
