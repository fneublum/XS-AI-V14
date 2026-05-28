-- Migration: add users.auth_id linking the application users table to
-- Supabase auth.users.id.
--
-- Why a new column instead of using users.id directly?
-- The application's users.id holds non-UUID strings (e.g. 'U_ADMIN',
-- 'USR1767552065337', 'USR-lara-076c1870'). Supabase's auth.users.id is
-- strictly UUID, so we can't reuse the existing id. Instead we let
-- Supabase generate a UUID for each auth identity and store that UUID
-- back here in users.auth_id.
--
-- Nullable on purpose:
--   - Rows existing before the backfill won't have a value until the
--     backfill runs. The login flow falls back to username-match
--     during this transition window.
--   - Future users provisioned via Supabase Auth admin API will get
--     auth_id populated at insert time (see auth-provision-user Edge
--     Function, Phase B).
--
-- UNIQUE (auth_id) so a single auth identity can't accidentally map to
-- two application user rows. `WHERE auth_id IS NOT NULL` makes the
-- constraint partial — many rows can be NULL.
--
-- Run once via Supabase Studio → SQL Editor (or `supabase db push`).
-- Safe to re-run thanks to IF NOT EXISTS guards.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_unique
  ON public.users (auth_id)
  WHERE auth_id IS NOT NULL;

-- Sanity check — should print 0 the first time, N after the backfill.
SELECT
  COUNT(*)                                  AS total_users,
  COUNT(*) FILTER (WHERE auth_id IS NOT NULL) AS linked_users
FROM public.users;
