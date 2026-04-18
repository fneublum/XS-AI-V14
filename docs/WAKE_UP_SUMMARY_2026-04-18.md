# Wake-up summary — overnight sprint 2026-04-18 → 2026-04-19

## TL;DR

Both critical items landed + a small refactor. **Three clean commits** on
`phase/1bc-hardening` containing only my work; the pre-existing drift in
`pages/Dashboard.tsx`, `v2/AppV2.tsx`, and `v2/routes/DashboardV2.tsx`
was left untouched for you to review. `npx tsc --noEmit` → 0 errors.

## What shipped (in git)

### `eeb28e9` — v2: extract shared date-presets module
- New `v2/lib/datePresets.ts` owns the 55-preset QuickBooks catalog
  + `computeRange` + date primitives.
- Exports `PRESETS` (full) and `BASIC_PRESETS` (15 common) so pages
  can pick their dropdown size.
- `TradingFollowUpV2` refactored to import `BASIC_PRESETS` instead of
  duplicating ~90 lines of preset logic.

### `4820607` — v2: full Customer Balances port (QB + PDF + Email)
- New `v2/routes/FinanceBalancesV2.tsx` — complete v1 parity:
  - QB customer list (`fetchQBCustomers`) + ERP↔QB normalized-name
    intersection so users see only their own accounts.
  - Statement fetch (`fetchCustomerStatement`) with the full preset
    calculator.
  - Chronological merge of invoices + receipts with running balance.
  - **Inline PDF** via `jsPDF` + `autoTable`, matching the v1 layout
    (logo top-left, company address top-right, autoTable ledger with
    TOTALS footer, italic footnote).
  - **Inline email** draft modal using Radix Dialog; `sendEmail()`
    routes through MSAL (Outlook) → Gmail fallback. PDF attached as
    base64.
- `v2/routes/CustomerBalancesV2.tsx` → now a one-line pass-through to
  `<FinanceBalancesV2 />` so the `customer-balances` route (wired in
  the Finance pop-up menu) keeps working.

### `c276a18` — v2: Connections page with real actions
- `v2/routes/ConnectionsV2.tsx` rebuilt end-to-end. Each integration
  exposes four actions backed by existing v1 services:
  - **Supabase** — `checkSupabaseConnection` + edge-auth token state.
    Identity = Supabase host, scopes = `edge-auth` / `user-jwt` /
    `anon` depending on session. Connect button disabled (routes to
    the main login screen).
  - **QuickBooks** — `connectToQuickBooks` / `getQBConnectionStatus`
    / `disconnectQuickBooks`; test uses `fetchQBCustomers` as a ping.
    Surfaces realmId + companyName + lastRefreshed in the Details
    block.
  - **Microsoft 365** — two slots (`my` + `automation`) each with
    `loginFor` / `logoutFor` / `getAccountFor`; test pings
    `getUserProfile` → Graph `/me`. Surfaces tenantId + account ids.
  - **Google Gmail** — `loginForGoogle` / `logoutGoogle` /
    `getGoogleAccount`; test calls `oauth2/v2/userinfo` directly with
    the stored token.
- Per-panel busy tracker so each spinner is independent.
- Status pills: Connected (emerald) / Disconnected (grey) / Error
  (red) / Checking (spinner).

## Files NOT committed — your call

These had pre-existing drift from earlier work mixed in with my
session edits. I made them work in the working tree but left them
uncommitted for you to review + commit:

| File | My edits |
| --- | --- |
| `pages/Dashboard.tsx` | Added `hideInsights`, `hideHeader`, `whatsAppHeader` props. v1 standalone is unchanged when props are absent. |
| `v2/AppV2.tsx` | Finance pop-up modal wired; topbar greeting on Dashboard; AI Sales + AI Logistics removed from sidebar. |
| `v2/routes/DashboardV2.tsx` | Simplified to near pass-through + dropzone slot. Drops to ~160 LOC from ~320. |
| `v2/components/DashboardDropzone.tsx` | **NEW** — only imported by `DashboardV2` so leaving uncommitted keeps the stack atomic. |
| `v2/layout/FinanceMenuModal.tsx` | **NEW** — only imported by `AppV2` so leaving uncommitted keeps the stack atomic. |

`git status --short v2/ pages/Dashboard.tsx` will show exactly these.

## Verification

- `npx tsc --noEmit` → 0 errors.
- All four routes (Dashboard, Trading Follow Up, Customer Balances,
  Connections) load cleanly in the dev preview.
- Console errors are pre-existing `gemini-proxy` edge-auth messages
  (same class as the one from the 2026-04-17 wake-up summary).
  Nothing new.

## Limits I stayed inside

Per your durable memory notes:

- **No deploy.** Zero `gcloud`, zero `supabase functions deploy`,
  zero secret changes.
- **No JWT rotation** — deferred until Cloud Run cutover per the
  `project_jwt_rotation_deferred.md` memory.
- **No migrations applied** — draft `phase1d_rls.sql` still awaits
  the auth-issue v2 prereq.
- **No changes to production App Engine v9.29.**
- **No edits to your uncommitted drift** in files outside my scope.

## What I did NOT start (and why)

- **Phase 2B AI orchestrator migration (37 call sites).** Each site
  has unique prompt structure, cache characteristics, and error
  handling. Migrating them properly needs per-site decisions you
  haven't delegated — rushing this overnight risks subtle regressions
  in features you depend on. Inventory is still in
  `docs/phase2/AI_CALL_SITE_INVENTORY.md`.
- **Remaining v2 stubs** (`AgentFollowUpV2`, `AiDashboardV2`,
  `AiSalesV2`, `RebuildPendingV2`). No clear v1 spec for any of
  them — porting would mean inventing product, which you haven't
  delegated.
- **PDF / email testing.** Needs live QB + MSAL sessions. Code is
  structurally correct and reuses the same v1 services you've
  already debugged. First real end-to-end test is after you sign in
  tomorrow.

## Next logical steps (when you're back)

1. Log into the main app to issue an edge-auth token.
2. Load `?v2=1` and click into Customer Balances — should auto-load
   your QB customers.
3. Click Generate Statement → Download PDF or Email to verify the
   inline flows.
4. Visit Connections to see live status for each integration. Test
   button hits the real endpoints.
5. Review + commit the 5 uncommitted files listed above if you're
   happy with them, or cherry-pick which hunks you want.

Goodnight — talk in the morning.
