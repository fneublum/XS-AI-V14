# Phase 1e — CSP hardening audit

**Status:** DRAFT (analysis only, no code changes)
**Goal:** reduce the current permissive CSP to a least-privilege policy
without breaking any runtime network call.

## Current CSP (shipping today)

Two copies — they must stay in sync or production drifts silently:

- [index.html:9](../../index.html) — `<meta http-equiv="Content-Security-Policy">`
- [nginx.conf:72](../../nginx.conf) — `add_header Content-Security-Policy` (Cloud Run)

Both are effectively identical and permissive:

```
default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval';
connect-src 'self'
  https://qfskvevighylzzmyiwre.supabase.co wss://qfskvevighylzzmyiwre.supabase.co
  https://*.supabase.co wss://*.supabase.co
  https://esm.sh https://login.microsoftonline.com https://graph.microsoft.com
  https://*.googleapis.com https://generativelanguage.googleapis.com
  https://api.allorigins.win https://corsproxy.io https://corsproxy.org
  https://gen-lang-client-0755290444.ue.r.appspot.com
  https://hall-memory-714806671182.us-central1.run.app
  https://shipsgo.com https://api.elevenlabs.io;
frame-src / child-src 'self' blob: data: https://login.microsoftonline.com;
script-src 'self' 'unsafe-inline' 'unsafe-eval'
  https://cdn.tailwindcss.com https://aistudiocdn.com https://esm.sh;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: cid: https: http:;
```

## Problem inventory

| Directive | Concern | Impact |
|---|---|---|
| `default-src https: data: blob: 'unsafe-inline' 'unsafe-eval'` | Functionally equivalent to disabling CSP for anything we don't list. | **HIGH** |
| `script-src 'unsafe-inline' 'unsafe-eval'` | Any XSS becomes RCE on the page. | **HIGH** |
| `script-src https://cdn.tailwindcss.com` | We ship Tailwind via CDN at runtime. Any compromise of that CDN owns every user. | **HIGH** |
| `script-src https://aistudiocdn.com https://esm.sh` | Importmap targets. esm.sh is generally trustworthy but still untrusted third-party code. | MED |
| `connect-src https://api.allorigins.win https://corsproxy.io https://corsproxy.org` | Open CORS proxies — any response can be forged en-route. | **HIGH** |
| `img-src https: http:` | Allows mixed-content http images on an https page. | MED |
| `frame-src https://login.microsoftonline.com` | Correct for MSAL popup/redirect. Keep. | OK |

## Network call-site inventory

Grep `fetch(` / `import(` targets across the codebase produced this list
(dedupe + grouped):

**Supabase (OK, scoped):**
- `https://qfskvevighylzzmyiwre.supabase.co/rest/v1/*`
- `https://qfskvevighylzzmyiwre.supabase.co/functions/v1/*`
- `wss://qfskvevighylzzmyiwre.supabase.co/realtime/*`

**Microsoft Graph / MSAL (OK, scoped):**
- `https://login.microsoftonline.com/*` (auth redirect)
- `https://graph.microsoft.com/v1.0/*` (email via Outlook)

**Gemini direct (TO BE REMOVED in Phase 1e):**
- `https://generativelanguage.googleapis.com/v1beta/models/*`
  All browser-side Gemini calls now go via Supabase Edge Function
  `gemini-proxy` as of Phase 1c. Remove from CSP once call-sites are
  audited (grep for any remaining `GoogleGenAI(` + `apiKey` pattern that
  isn't in `services/geminiClient.ts`).

**HALL memory (OK, scoped):**
- `https://hall-memory-714806671182.us-central1.run.app/*`

**Legacy App Engine backend (to retire):**
- `https://gen-lang-client-0755290444.ue.r.appspot.com/*`
  Used by some Gemini pass-through that predates gemini-proxy. Audit all
  callers in `services/` and remove before dropping from CSP.

**CORS proxies (REMOVE):**
- `https://api.allorigins.win`, `https://corsproxy.io`, `https://corsproxy.org`
  Used for scraping public pages (ShipsGo tracking, some government
  tariff lookups). All three should be replaced with a server-side
  proxy on Supabase Edge Functions so the payload is signed and the
  third party never sees the user's IP.

**ShipsGo (keep, scoped):**
- `https://shipsgo.com/*`

**ElevenLabs TTS (keep, scoped):**
- `https://api.elevenlabs.io/*`

**CDN scripts (to eliminate):**
- `https://cdn.tailwindcss.com/` — runtime Tailwind. Kill by building
  Tailwind at compile time (already planned in Phase 3A).
- `https://aistudiocdn.com/*` — Google AI Studio CDN, probably importmap.
  Audit `index.html` importmap.
- `https://esm.sh/*` — importmap. Replace with local npm bundling in
  Phase 3A rebuild.

## Proposed hardened CSP (Phase 1e target)

Apply after Phase 3A bundles Tailwind and drops the CDN/importmap imports:

```
default-src 'none';
connect-src 'self'
  https://qfskvevighylzzmyiwre.supabase.co wss://qfskvevighylzzmyiwre.supabase.co
  https://login.microsoftonline.com https://graph.microsoft.com
  https://hall-memory-714806671182.us-central1.run.app
  https://shipsgo.com https://api.elevenlabs.io;
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
frame-src 'self' https://login.microsoftonline.com;
form-action 'self';
base-uri 'self';
object-src 'none';
```

Notes:
- Drop `'unsafe-eval'` entirely — requires auditing any library that
  uses `new Function()` / `eval`. Known suspects: PDF rendering libs.
- Keep `'unsafe-inline'` on `style-src` only while Tailwind emits inline
  styles from the utility classes. A nonce strategy is a post-1e concern.
- Add `Content-Security-Policy-Report-Only` with the target policy FIRST
  for one week and collect `report-uri` violations before flipping to
  enforce.
- Remove the `<meta>` tag from index.html and rely on the HTTP header
  (nginx) as the single source of truth — avoids drift.

## Exit criteria

- [ ] No runtime CSP violations in DevTools on a full-path smoke test
  (login → dashboard → each AI flow → logistics → commissions).
- [ ] CSP is set only in HTTP response (nginx); the `<meta>` in
  index.html is deleted.
- [ ] `generativelanguage.googleapis.com` removed from `connect-src`.
- [ ] `cdn.tailwindcss.com`, `aistudiocdn.com`, `esm.sh` removed from
  `script-src`.
- [ ] All three CORS proxy domains removed from `connect-src`.
- [ ] Report-only shadow run for ≥7 days with zero violations before
  enforcement.
