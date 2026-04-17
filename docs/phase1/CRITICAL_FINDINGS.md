# Phase 1 — Critical Security Findings (to resolve in Phase 1e)

These are known-unresolved issues discovered during Phase 1a/1b. They are
deliberately **deferred** to Phase 1e because resolving them touches the
auth UX and data model beyond the scope of the current hardening pass.

---

## 1. Plaintext password storage — CRITICAL

**Where:**
- [services/supabase.ts](../../services/supabase.ts) — `authenticateUser()`
- [pages/Login.tsx](../../pages/Login.tsx) — comparison site
- `users` table (Supabase) — `password` column stores raw user passwords

**Evidence (Login.tsx after Phase 1b):**
```ts
// After Phase 1b removed the ADMIN/JCKING backdoor, the remaining check is:
if (dbUser.password === cleanPassword) { ... }
```

**Impact:**
- Any read of the `users` table (SQL injection, leaked backup, RLS
  misconfiguration, disgruntled admin with DB access) immediately
  compromises every user credential for every tenant.
- Password reuse across other services (email, banking) means the
  blast radius extends well beyond this app.
- Violates every modern auth standard (NIST SP 800-63B, OWASP ASVS
  V2.1.5) and most compliance frameworks (SOC 2, PCI, HIPAA).

**Phase 1e plan:**
1. Migrate all users to **Supabase Auth** (built-in `auth.users` table
   with salted hashes — bcrypt-equivalent). This replaces the custom
   `users` table login path entirely.
2. Add email-based password reset and mandatory first-login password
   change (existing plaintext passwords are assumed compromised).
3. Add optional MFA (TOTP) for admin roles.
4. Drop the `password` column from the custom `users` table after
   migration.

**Mitigations in place today (Phase 1b + 1c):**
- Login error messages are constant (`"Invalid username or password."`)
  to prevent user enumeration — see [pages/Login.tsx](../../pages/Login.tsx).
- ADMIN/JCKING hardcoded bypass removed.
- Dev-server credentials (`FELIPE` / `JCKING`) continue to work only
  because a row exists in the DB with that plaintext — they will be
  invalidated by the Phase 1e migration.
- **Phase 1c:** the compare path against the `users` table now ALSO
  happens server-side inside [supabase/functions/auth-issue/index.ts](../../supabase/functions/auth-issue/index.ts)
  before a user JWT is minted. Edge Functions no longer trust a
  plain client session — they require that server-signed JWT. Reduces
  but does not eliminate the plaintext-storage risk; the `password`
  column still exists and is read by service role.

---

## 2. Twilio credentials previously accepted in request body

**Where:** [supabase/functions/twilio-send/index.ts](../../supabase/functions/twilio-send/index.ts)

**Status:** **Fixed in Phase 1b.** Function now reads
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` from Deno env and returns
400 if the caller tries to pass them in the body. Any client code that
still sends them must be updated — grep for `accountSid:` /
`authToken:` in `services/*`.

**Follow-up:** audit `services/smailGraph.ts`,
`services/notificationService.ts`, and any other caller of the
`twilio-send` function — remove credential pass-through and rely on the
server-side env secrets.

---

## 2a. Hardcoded Supabase anon JWT + Gemini API key in client bundle

**Status:** **Fixed in Phase 1c.**

**Before:** `services/quickbooksService.ts`, `components/WhatsAppChatWidget.tsx`,
and `pages/ConnectionsHub.tsx` all inlined a full JWT (`eyJhbGciOi…`)
as a string constant so `fetch()` could hit Edge Functions directly.
`services/geminiService.ts` passed `process.env.API_KEY` into the
Gemini SDK at runtime — which meant the key shipped in the client
bundle (Vite replaces `process.env.API_KEY` at build time).

**Now:**
- All three call sites go through
  [`invokeEdgeFunction`](../../services/edgeAuth.ts) which reads the
  Supabase anon key from `getSupabaseConfig()` (Vite env) and attaches
  the server-issued user JWT from `sessionStorage`.
- Gemini calls route through
  [gemini-proxy](../../supabase/functions/gemini-proxy/index.ts).
  The SDK shim at [services/geminiClient.ts](../../services/geminiClient.ts)
  preserves the `new GoogleGenAI({ apiKey }).models.generateContent()`
  API surface so the 40+ existing call sites compile unchanged; the
  `apiKey` argument is silently ignored.
- `GEMINI_API_KEY` lives only in Supabase Edge Function secrets.

**Follow-up (Phase 1d hygiene):** `services/hallService.ts` and
`services/brainService.ts` still inline a Supabase anon key — this is a
SEPARATE Supabase project used for the HALL external integration, so
the key is public-by-design, not a leak. Move it to Vite env for
consistency.

---

## 3. Client-side multi-tenant filtering — HIGH

**Where:** [App.tsx:297-305](../../App.tsx) — `filterByCompany()`

Rows for ALL companies are fetched from Supabase and filtered in JS.
A crafted request that skips `filterByCompany()` (e.g. a modified
client, a new page added without the wrapper) will read cross-tenant
data.

**Phase 1b prep:** migration
[20260416000000_multitenant_foundation.sql](../../supabase/migrations/20260416000000_multitenant_foundation.sql)
adds nullable `companyId` / `company_id` columns to the three tables
that were missing them (`wa_messages`, `costumer_description`,
`system_settings`).

**Phase 1d plan:**
1. Backfill the new `companyId` columns from parent rows.
2. Make the columns `NOT NULL` after backfill.
3. Enable RLS on every tenant-scoped table with a policy like:
   `using (companyId = any(auth.jwt() -> 'allowed_company_ids'))`.
4. Remove client-side `filterByCompany()` — the DB enforces isolation.

---

## 4. QuickBooks OAuth state is not CSRF-protected

**Where:** [supabase/functions/qb-auth/index.ts](../../supabase/functions/qb-auth/index.ts) — `handleCallback`

The `state` parameter is re-purposed to carry `companyId`, so a
malicious link could pre-seed an attacker's QB tokens against the
victim's company slot.

**Phase 1e plan:** generate a random nonce, store it in the DB keyed
by user+companyId at `authorize` time, and verify it at `callback`
time. Keep the nonce opaque from the companyId.

---

## 5. Weak CSP in `index.html` / `app.yaml`

No `Content-Security-Policy` is sent today. Phase 0 added HSTS,
X-Frame-Options, X-Content-Type-Options, and Referrer-Policy, but
CSP was deliberately left out because the app uses `aistudiocdn.com`
and `esm.sh` via importmaps and we needed a Phase-1 inventory of
every runtime `fetch` target before writing a meaningful CSP.

**Phase 1e plan:** enumerate all `fetch()` targets + importmap URLs,
write a nonce-based CSP, add Subresource Integrity hashes to any
third-party scripts loaded directly in `index.html`.
