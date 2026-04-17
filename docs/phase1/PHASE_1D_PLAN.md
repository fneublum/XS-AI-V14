# Phase 1d — Multi-tenant RLS rollout

**Status:** DRAFT (migration written, NOT applied)
**Migration file:** `supabase/migrations/DRAFT_20260417000000_phase1d_rls.sql`
**Owner:** user decision required before apply

## Why

Today the app achieves tenant isolation purely in the React layer via
`filterByCompany()` in [App.tsx:297](../../App.tsx). Anyone holding a valid
anon key or session token can read every tenant's rows with a raw
`supabase.from('invoices').select('*')` call — isolation is enforced
client-side, which is not isolation at all.

Phase 1b already added nullable `companyId` / `company_id` columns to every
tenant-scoped table. Phase 1d closes the loop at the database layer.

## What the migration does (4 parts)

1. **Backfill** every NULL `companyId` to a designated default company (seeded
   if absent). The default can be overridden with
   `set app.default_company_id = 'ACME'` before the run.
2. **Enforce NOT NULL** on `companyId` / `company_id` across 35 tables.
3. **Install `public.current_user_companies()`** — a SECURITY DEFINER SQL
   helper that reads the JWT's `app_metadata.allowed_company_ids` claim.
4. **Enable RLS + install `tenant_isolation` policy** on each tenant-scoped
   table. Policy: row visible iff its `companyId` ∈ caller's allowed set.

Service-role key bypasses RLS by default, so `qb-sync`, `gemini-proxy`, and
any Edge Function using the service role key continue to work unchanged.

## Hard prerequisites before applying

1. **auth-issue must embed `allowed_company_ids` into `app_metadata`.**
   Currently it only signs an HS256 JWT with sub+email+role. Without the
   claim, `current_user_companies()` returns `[]` and the policy denies
   everything — the app would go blank on deploy.
2. **Client must authenticate every request with the session JWT.**
   Any call path using the anon key directly for writes (or reads against
   tenant tables) will start returning zero rows. Audit
   `services/supabase.ts` and `services/edgeAuth.ts` before shipping.
3. **The "DEFAULT" backfill tenant must match the `allowed_company_ids`
   of existing users.** If current users don't have `DEFAULT` in their
   allowed set, they'll see an empty app after apply. Option: seed each
   user's `allowed_company_ids` with the value of `app.default_company_id`
   before applying.

## Rollout sequence (cannot skip steps)

1. Ship auth-issue v2 that adds `allowed_company_ids` to the JWT.
2. Reissue all live sessions (force sign-out) so tokens contain the claim.
3. Apply this migration during a low-traffic window.
4. Smoke-test each module against a user with a single-company allowlist.
5. Delete `filterByCompany()` from App.tsx in a follow-up PR (RLS now
   handles the filtering — the client-side filter becomes dead code).

## Rollback

The migration ships with an inline rollback block (commented) at the
bottom. Drop all policies, disable RLS, drop the helper function. Data is
untouched.

## Known gaps / follow-ups

- `system_settings.company_id` remains nullable (NULL = global). RLS
  policy TBD — likely a variant that allows NULL-company rows for all
  authenticated callers plus company-matched rows.
- `users` table itself has no RLS — intentional for login, but means any
  authenticated caller can enumerate all users. Separate Phase 1e concern.
- `companies` table has no RLS — users can see all companies, which might
  be acceptable for a company-picker UI. Evaluate before closing.
- The helper uses `auth.jwt()` which is Supabase Auth specific. If we
  migrate off the HS256 bridge to full Supabase Auth in Phase 1e, this
  helper Just Works. If we stay on the bridge, auth-issue must write a
  JWT that Supabase's `auth.jwt()` will accept — verify before apply.
