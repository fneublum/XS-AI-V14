# Phase 1c — Edge Function Auth + Secrets Relocation

**Status:** Implemented, awaiting deploy.
**Date:** 2026-04-16.
**Typecheck:** 9 errors — same 9 pre-existing from before Phase 1c. No new errors introduced.

---

## Goal

Move every secret that was shipping in the browser bundle (Gemini API key, hardcoded Supabase anon JWTs, Twilio creds) behind Supabase Edge Functions gated by a per-user JWT — without rewriting the 40+ Gemini call sites or migrating the custom `users`-table login to Supabase Auth (deferred to Phase 1e).

---

## What shipped

### 1. `auth-issue` Edge Function
New function at `supabase/functions/auth-issue/index.ts`.

- Takes `{ username, password }`, compares against the existing `users` table (service role read), and on success signs an HS256 JWT with `SUPABASE_JWT_SECRET` via `djwt@v3.0.1`.
- Payload shape matches Supabase's own tokens (`aud: "authenticated"`, `role: "authenticated"`, `sub: <user.id>`), so `supabase.auth.getUser(token)` on the server side accepts it without any Supabase Auth migration.
- TTL 1 hour. Returns `{ token, expiresIn, user: { id, username, email, role, allowed_company_ids } }`.
- Constant-shape 401 on failure to prevent user enumeration.

### 2. `gemini-proxy` Edge Function
New function at `supabase/functions/gemini-proxy/index.ts`.

- Generic `generateContent` forwarder. Takes the exact shape of the SDK's `ai.models.generateContent({ model, contents, config })` and translates it to the Gemini REST payload:
  - `config.{responseMimeType, responseSchema, temperature, ...}` → `generationConfig`.
  - `config.{tools, toolConfig, safetySettings, systemInstruction, cachedContent}` → top-level.
  - Bare-string `contents` normalized to `[{ role: 'user', parts: [{ text }] }]`.
- Requires a valid user JWT via `_shared/auth.ts` (the one `auth-issue` mints).
- Model allowlist (`gemini-3-pro-preview`, `gemini-3-pro`, `gemini-2.0-flash` / `-exp` / `-lite`, `gemini-1.5-flash` / `-pro`).
- 2 MB body cap.
- Returns `{ text, functionCalls?, candidates, usageMetadata }` matching the SDK's response shape so the shim can pass it straight through.

### 3. `services/edgeAuth.ts` — client token store + invoker
New module.

- `issueEdgeToken(username, password)` — calls `auth-issue`, stores token in `sessionStorage` under `xs_edge_auth_token` with epoch-expiry key `xs_edge_auth_exp`. Falls back to in-memory if `sessionStorage` is blocked (private browsing).
- `getEdgeToken()` — returns the token if still in-TTL, else `null`.
- `clearEdgeToken()` — wipe on logout.
- `invokeEdgeFunction(fnName, { method, body, params, allowAnon })` — single entry point for all Edge Function calls. Attaches `Authorization: Bearer <user token>` and `apikey: <supabase anon from env>`. Throws if no token and `allowAnon !== true`.

### 4. `services/geminiClient.ts` — drop-in SDK shim
New module. Re-exports `GoogleGenAI`, `Type`, `FunctionDeclaration` with signatures that match `@google/genai@1.30.0`. `new GoogleGenAI({ apiKey })` silently ignores the key and routes every `.models.generateContent(req)` through `invokeEdgeFunction('gemini-proxy', { body: req })`.

Call sites didn't need to change their signature — only their import path.

### 5. `pages/Login.tsx` — issue token on successful login
After the existing plaintext password compare passes, calls `issueEdgeToken(username, password)` in a `try/catch`. Soft-fails so the rest of the app still works against Supabase directly if `auth-issue` is unreachable — only Edge-Function-backed features (AI, QB sync, WhatsApp send) will surface a "please sign in again" error.

### 6. Import swap — Gemini SDK → shim
- `services/geminiService.ts:2` — one-line import swap. All 40+ call sites unchanged because the shim matches the SDK shape.
- `pages/SmailApp.tsx` — 2 dynamic-import sites updated (lines ~200 and ~238). `apiKey` arg dropped since the shim ignores it.

### 7. Hardcoded JWT removal
- `services/quickbooksService.ts` — removed inline anon JWT (was present twice at lines 23 and 34). Collapsed `callEdgeFunction` to a thin wrapper around `invokeEdgeFunction`.
- `components/WhatsAppChatWidget.tsx` — removed `SUPABASE_FN_URL` + `SUPABASE_ANON_KEY` constants. `callWhatsAppSend` now uses `invokeEdgeFunction('whatsapp-send', …)`.
- `pages/ConnectionsHub.tsx` — same removal. Both the initial free-form/template send and the follow-up retry now go through `invokeEdgeFunction`.

---

## What did NOT change (and why)

- **`services/hallService.ts` + `services/brainService.ts`** still contain an anon JWT (`xkoknmidesfzqktndwgf.supabase.co`). This is a **separate Supabase project** used for the HALL external integration — the JWT is a public Supabase anon key by design, gated by HALL's own RLS. Not a secret leak. Flagged for Phase 1d hygiene: move to Vite env.
- **`users` table is still plaintext passwords.** `auth-issue` reads them via service role on the server side, so the password no longer has to be compared in the browser bundle against the whole users table — but the hash-less storage remains. Kill target for Phase 1e (Supabase Auth migration).
- **The existing client-bundle anon JWT for the main CRM Supabase (`qfskvevighylzzmyiwre`)** continues to ship — it is public by design and already in Vite env (`getSupabaseConfig().key`). All the locations that previously inlined a *second* copy now read from env via `invokeEdgeFunction`.

---

## Deploy prerequisites

Before the app works end-to-end after Phase 1c:

1. **Edge Function secrets** (Supabase dashboard → Project Settings → Edge Functions → Secrets):
   - `GEMINI_API_KEY` — the same key currently living in Vite `API_KEY` env. After deploy, remove it from `.env` and `app.yaml`.
   - `SUPABASE_JWT_SECRET` — the same value Supabase uses to sign its own tokens (dashboard → Project Settings → API → JWT Secret). `auth-issue` needs this to mint a JWT that the server-side `_shared/auth.ts` (which uses `supabase.auth.getUser`) accepts.
   - `SUPABASE_SERVICE_ROLE_KEY` — `auth-issue` reads the `users` table server-side.
   - `SUPABASE_URL` — auto-set by Supabase.

2. **Deploy the new + updated functions:**
   ```
   supabase functions deploy auth-issue --project-ref qfskvevighylzzmyiwre
   supabase functions deploy gemini-proxy --project-ref qfskvevighylzzmyiwre
   # Phase 1b functions already deployed, but redeploy if shared helpers changed:
   supabase functions deploy twilio-send whatsapp-send twilio-webhook qb-auth qb-sync --project-ref qfskvevighylzzmyiwre
   ```

3. **After verify** — remove client-side Gemini key from the bundle:
   - `.env.local`: delete `VITE_API_KEY`, `API_KEY`.
   - `app.yaml`: delete `API_KEY` env var.
   - `vite.config.ts`: already reads `API_KEY` via `define` — that define can be removed in Phase 1d cleanup.

---

## Verification

- `npx tsc --noEmit` → 9 errors (all pre-existing; none in files touched this phase).
- Local dev server: not tested (port 3000 in use by another project at time of writing). Once the secrets above are set and deploys complete, verify:
  - Login → network tab shows POST to `/functions/v1/auth-issue` returning 200 with a JWT.
  - Open any page that calls Gemini (AiDashboard, ProposalEngine, etc.) → network tab shows POST to `/functions/v1/gemini-proxy` with `Authorization: Bearer …`, and NO outbound to `generativelanguage.googleapis.com` from the browser.
  - QB connect flow still opens the popup → `/functions/v1/qb-auth?action=authorize` returns 200 (was 401 before Phase 1c if called with an unauthenticated session, because the function requires user JWT).
  - WhatsApp send → `/functions/v1/whatsapp-send` returns 200.

---

## Residual risks (handed off to later phases)

| Risk | Deferred to | Why not now |
|---|---|---|
| Plaintext passwords in `users` table | Phase 1e | Requires password-reset UX + Supabase Auth migration + backfill. Out of Phase 1c scope. |
| No CSP / SRI on `index.html` | Phase 1e | CSP interacts with every third-party script (MSAL, Google Identity, Tailwind CDN). Needs its own survey. |
| Client-side multi-tenant filter (`filterByCompany()`) | Phase 1d | Requires the `companyId` backfill + RLS policies from the Phase 1b migration to finish first. |
| QB OAuth state lacks CSRF nonce | Phase 1e | QB callback is low-traffic; not exploitable without also breaking the Intuit redirect. |
| `gemini-3-pro-preview` model has narrow Google allowlist | — | Already in `ALLOWED_MODELS`. Monitor upstream 400s and prune. |
