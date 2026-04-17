# Phase 1b — XSS & Edge-Function Hardening — Completion Report

**Branch:** `main`
**Date range:** started 2026-04-16
**Scope:** client-side XSS sinks, Edge Function auth/CORS,
webhook signature validation, multi-tenant column prep.

---

## Changes landed

### Client — XSS sinks closed
| File | Change |
| --- | --- |
| [pages/Documents.tsx](../../pages/Documents.tsx) | `document.write(<iframe src=${docUrl}>)` → safe `iframe.src` assignment with URL scheme validation + `sandbox` attribute. |
| [pages/Login.tsx](../../pages/Login.tsx) | Removed hardcoded `ADMIN` / `JCKING` auth backdoor; error message is now constant to prevent user enumeration. |
| [pages/Login_backup.tsx](../../pages/Login_backup.tsx) | **Deleted** — contained duplicate `JCKING` backdoor. |
| [utils/sanitizeHtml.ts](../../utils/sanitizeHtml.ts) | **New.** Dependency-free HTML whitelist sanitizer: blocks `<script>` / `<style>`, `on*` handlers, `javascript:` / `data:` URLs, CSS `url()`/`expression()`. Forces `rel="noopener noreferrer"` on target anchors. |
| [pages/PurchaseOrders.tsx](../../pages/PurchaseOrders.tsx) | `dangerouslySetInnerHTML` now passes through `sanitizeHtml()`. |

### Edge Functions — shared hardening helpers
All new helpers live under `supabase/functions/_shared/`.

| File | Purpose |
| --- | --- |
| [\_shared/cors.ts](../../supabase/functions/_shared/cors.ts) | Env-driven `ALLOWED_ORIGINS` allowlist with GCP-appspot + local-dev fallback. Echoes the exact origin when allowed, `null` otherwise. |
| [\_shared/auth.ts](../../supabase/functions/_shared/auth.ts) | `requireUser(req, corsHeaders)` — validates the `Authorization: Bearer <jwt>` header via a Supabase anon client + `auth.getUser()`. |
| [\_shared/twilioSignature.ts](../../supabase/functions/_shared/twilioSignature.ts) | HMAC-SHA1 webhook signature verification per Twilio's spec. **Fail-closed** if `TWILIO_AUTH_TOKEN` is unset. |

### Edge Functions — applied the helpers
| Function | CORS | JWT | Signature | Input limits |
| --- | --- | --- | --- | --- |
| [gemini-translate](../../supabase/functions/gemini-translate/index.ts) | shared | required | n/a | `MAX_BATCH_SIZE=100`, `MAX_DESCRIPTION_LEN=2000` |
| [twilio-send](../../supabase/functions/twilio-send/index.ts) | shared | required | n/a | `MAX_MESSAGE_LEN=4096`; **rejects** client-supplied `accountSid` / `authToken` (now read from env) |
| [whatsapp-send](../../supabase/functions/whatsapp-send/index.ts) | shared | required | n/a | `MAX_TEXT_LEN=4096`, validates `components` is an array |
| [twilio-webhook](../../supabase/functions/twilio-webhook/index.ts) | **none** (server-to-server) | n/a | **required** (HMAC-SHA1, fail-closed) | — |
| [qb-auth](../../supabase/functions/qb-auth/index.ts) | shared | required for `authorize`/`refresh`/`status`/`disconnect`; `callback` is public (browser redirect) | n/a | — |
| [qb-sync](../../supabase/functions/qb-sync/index.ts) | shared | required (all actions) | n/a | — |

### DB — multi-tenant foundation (Part 1)
| File | Change |
| --- | --- |
| [supabase/migrations/20260416000000_multitenant_foundation.sql](../../supabase/migrations/20260416000000_multitenant_foundation.sql) | Adds nullable `companyId` / `company_id` columns + indexes to `wa_messages`, `costumer_description`, `system_settings`. Idempotent; no backfill (deferred to Phase 1d along with RLS policies). |

### Documentation
- [docs/phase1/CRITICAL_FINDINGS.md](CRITICAL_FINDINGS.md) — deferred
  issues with owner/plan per item (plaintext passwords, client-side
  tenant filter, OAuth CSRF, CSP/SRI).

---

## Verification

- **`tsc --noEmit`** — 9 errors, **all pre-existing** in files I did
  not touch (`pages/Commissions.tsx`, `pages/FinanceReceivables.tsx`,
  `services/aiAssistantService.ts`). No new errors introduced by
  Phase 1b.
- **Dev server (Vite)** — port 3000 is in use by a separate project on
  the same machine (`/Users/felipeneublum/Desktop/XS-AI-ERP`). I did
  not kill it; the client-side changes are covered by `tsc` and a
  dev-server boot does not exercise the Edge-Function changes.
- **Edge Functions (Deno)** — Deno is not installed locally. Functions
  will be validated at `supabase functions deploy` time.

## Required before deploy

1. Set these env secrets in Supabase Edge Functions:
   - `ALLOWED_ORIGINS` — comma-separated, e.g.
     `https://xs-erp.appspot.com,http://localhost:3000,http://localhost:5173`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — moved from request
     body into env secrets for `twilio-send`.
   - `TWILIO_AUTH_TOKEN` is **required** for `twilio-webhook` — the
     function now fails closed without it.
2. Run the migration:
   `supabase db push` (or apply
   `20260416000000_multitenant_foundation.sql` to the `XS-ERP`
   project).
3. Audit client callers of `twilio-send` and remove any
   `accountSid` / `authToken` fields from request bodies (grep:
   `twilio-send.*accountSid` in `services/*`).

## Open follow-ups (Phase 1c and later)

- **Phase 1c** — move remaining AI calls to Edge Functions so
  `GEMINI_API_KEY` never ships to the client bundle.
- **Phase 1d** — backfill the new `companyId` / `company_id` columns,
  mark them `NOT NULL`, enable RLS policies, remove client-side
  `filterByCompany()`.
- **Phase 1e** — migrate to Supabase Auth (kills plaintext password
  store), CSP + SRI, password reset, TOTP for admin roles,
  CSRF-safe QB OAuth state.
