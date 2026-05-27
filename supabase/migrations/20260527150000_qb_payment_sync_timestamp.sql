-- Phase 4 — track last QB → Supabase payment-sync per company.
--
-- The qb-pull-payments edge function (new in this migration set)
-- writes this timestamp after each successful pull. Surfaces in the
-- Statements view as "Last synced N min ago".

alter table qb_tokens
  add column if not exists last_payment_sync_at timestamptz;
