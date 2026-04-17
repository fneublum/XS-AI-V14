# Wake-up summary — overnight sprint 2026-04-16 → 2026-04-17

## TL;DR

All requested scaffolding and planning landed on `phase/1bc-hardening`
branch. Two commits pushed to the `xs-erp` remote. Zero TS errors.
Nothing is deployed; no secrets are set; no production SQL has run.
Everything that touches production is gated, drafted, or documented.

## What shipped (in git)

### Commit 1 — `ecc83de` Phase 1b + 1c security hardening
Already covered in prior session — summary:
- Edge Function hardening (cors/_shared/auth, signed Twilio webhooks).
- Gemini + QB proxy through server-side keys (no more hardcoded JWTs).
- auth-issue HS256 bridge (`djwt@v3.0.1`).
- Cloud Run: Dockerfile, nginx.conf, .dockerignore, rewritten
  .gcloudignore, updated `.agent/workflows/deployment.md`.
- PHASE_1B_REPORT.md, PHASE_1C_REPORT.md, CRITICAL_FINDINGS.md updated.

### Commit 2 — `8299eda` Phase 1d/1e/2A/3A scaffolds

**Phase 1d** (draft — NOT applied):
- `supabase/migrations/DRAFT_20260417000000_phase1d_rls.sql` — backfill
  nullable `companyId` columns to a `DEFAULT` tenant, set NOT NULL,
  enable RLS on 35 tables with `tenant_isolation` policy gated by a
  `public.current_user_companies()` helper reading
  `auth.jwt() -> 'app_metadata' -> 'allowed_company_ids'`.
- `docs/phase1/PHASE_1D_PLAN.md` — prerequisites (auth-issue v2 MUST
  embed the claim first), rollout sequence, rollback.

**Phase 1e** (plans only):
- `docs/phase1/PHASE_1E_CSP_AUDIT.md` — current CSP weaknesses
  (`'unsafe-eval'`, CDN Tailwind, 3 open CORS proxies, legacy App
  Engine backend) + proposed hardened policy + report-only rollout.
- `docs/phase1/PHASE_1E_AUTH_MIGRATION.md` — HS256 bridge → native
  Supabase Auth, QB OAuth CSRF fix, TOTP for admin.

**Phase 2A** — AI Orchestrator scaffold (gated off):
- `services/ai/` — 10 files covering orchestrator entry point, config,
  in-memory LRU cache, exponential-backoff retry with full jitter,
  per-provider circuit breaker, fire-and-forget telemetry, provider
  adapters for Anthropic (Claude Opus 4.7) + Gemini (Gemini 3 Pro
  Preview).
- `orchestratorConfig.enabled = false` — no existing call site routes
  through the orchestrator yet; the 37 cataloged sites migrate in Phase 2B.
- `docs/phase2/PHASE_2A_SCAFFOLD.md` — turn-on checklist.

**Phase 3A** — Frontend v2 shell (opt-in via `?v2=1`):
- `v2/` — 20 files: design tokens (colors/spacing/typography),
  6 accessible primitives (Button/Input/Table/Modal/Toast/Form),
  Auth/Company/Query providers, Zustand-compatible UI store, example
  query hook (`useCustomers`), placeholder `DashboardV2` route, and a
  tiny (~35 LOC) AppV2 shell.
- `index.tsx` modified to lazy-load `./v2/AppV2` when `?v2=1` is in the
  URL; v1 bundle unchanged when the flag is absent.
- `docs/phase3/PHASE_3A_SCAFFOLD.md` — turn-on checklist including the
  npm installs that land with Phase 3B.

**Pre-existing TS fix:**
- `services/geminiService.ts` — added 7 missing logistics fields
  (`incoterm`, `portOfLoading`, `portOfDischarge`, `poa`,
  `deliveryMethod`, `paymentTerms`, `deliveryDate`) to the
  `AgentAction.entities` interface so `aiAssistantService.ts:CREATE_SO`
  compiles without error.

**NOT in the commit (working-tree, unrelated to this session):**
- 2 small TS fixes in `pages/Commissions.tsx` and
  `pages/FinanceReceivables.tsx` remain in the working tree alongside
  the user's other pre-existing uncommitted changes in those files.
  They were the `TS2345` and `TS2367` fixes mentioned in the summary —
  they are applied locally and typecheck passes, but staging them
  would have bundled in 900+ lines of unrelated in-flight work that
  belongs to the user. Commit them separately once the rest of those
  files is ready.

## Verification

- `npx tsc --noEmit` → 0 errors.
- No page in v1 imports anything from `services/ai/` or `v2/` — both
  new trees are dormant.
- `?v2=1` boots the placeholder Dashboard; all other URLs render v1
  identically to before.

## Deploy blockers (awaiting user decision)

### 1. PR cannot be auto-opened
`gh pr create --repo fneublum/XS-AI-ERP --base main --head phase/1bc-hardening`
fails with *"no history in common with main"*. The `xs-erp/main` HEAD
and the local `main` HEAD are on different commit histories.

Either:
- (a) Reset `xs-erp/main` to the current local `main` (destructive,
  but branch is freshly owned);
- (b) Open the PR against a different base branch that shares history;
- (c) Push `main` to `xs-erp` with a merge strategy, then open PR.

`origin` cannot be pushed to — GitHub secret scanning still blocks the
initial commit `4faf4d2` (hardcoded secrets in `services/emailService.ts`
and `src/pages/AdminCredentials.tsx`) which is part of that remote's
history. Not fixable from this branch.

### 2. Edge Function secrets still unset
Before Phase 1c goes live on prod, set these in the Supabase
dashboard → Edge Functions → Secrets:
- `GEMINI_API_KEY`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_SECRET`

Then deploy:
```
supabase functions deploy auth-issue gemini-proxy \
  --project-ref qfskvevighylzzmyiwre
```
(Plus any other edited functions.)

### 3. Cloud Run image not yet built
Per `.agent/workflows/deployment.md`:
```
gcloud builds submit --tag gcr.io/xs-erp/xs-erp-app
gcloud run deploy xs-erp \
  --image gcr.io/xs-erp/xs-erp-app \
  --platform managed --region us-central1 \
  --service-account xs-erp-runtime@xs-erp.iam.gserviceaccount.com \
  --allow-unauthenticated --port 8080
```

### 4. Phase 1d migration NOT applied
The `DRAFT_` prefix and the plan doc both call out that auth-issue v2
must embed `allowed_company_ids` first. Do not run the migration before
that ships and live sessions are reissued.

## Pending work not in this sprint

- Phase 2B — migrate the 37 cataloged AI call sites to `runAi()`.
  Inventory: `docs/phase2/AI_CALL_SITE_INVENTORY.md`.
- Phase 3B — install the real deps (TanStack / Zustand / Radix /
  Tailwind-local) and port the "rebuild-first" pages from
  `docs/phase3/FRONTEND_AUDIT.md` (Logistics, Dashboard, FreightQuotes).
- Remove `App.tsx`'s `filterByCompany()` helper once Phase 1d RLS is live.
- Drop `cdn.tailwindcss.com` / `esm.sh` / `aistudiocdn.com` from CSP
  once Phase 3B bundles everything locally.
- Delete `auth-issue` and `SUPABASE_JWT_SECRET` once Phase 1e Supabase
  Auth migration is complete.

## Branches + remotes

- Local branch: `phase/1bc-hardening`
- Pushed to: `xs-erp/phase/1bc-hardening` (https://github.com/fneublum/XS-AI-ERP)
- Not pushed to `origin` (blocked by GitHub secret scanning on the
  historic `Initial commit` 4faf4d2).
- Two commits ahead of `phase/1bc-hardening@ecc83de`:
  - `ecc83de` Phase 1b + 1c security hardening
  - `8299eda` Phase 1d draft + 1e plans + 2A/3A scaffolds

## Files added this sprint (recap)

```
docs/phase1/PHASE_1D_PLAN.md
docs/phase1/PHASE_1E_AUTH_MIGRATION.md
docs/phase1/PHASE_1E_CSP_AUDIT.md
docs/phase2/PHASE_2A_SCAFFOLD.md
docs/phase3/PHASE_3A_SCAFFOLD.md
docs/WAKE_UP_SUMMARY.md                    (this file)
services/ai/cache.ts
services/ai/circuitBreaker.ts
services/ai/config.ts
services/ai/index.ts
services/ai/orchestrator.ts
services/ai/providers/anthropicProvider.ts
services/ai/providers/geminiProvider.ts
services/ai/retry.ts
services/ai/telemetry.ts
services/ai/types.ts
supabase/migrations/DRAFT_20260417000000_phase1d_rls.sql
v2/AppV2.tsx
v2/README.md
v2/primitives/{Button,Form,Input,Modal,Table,Toast,index,utils}.{ts,tsx}
v2/providers/{Auth,Company,Query}Provider.tsx
v2/queries/useCustomers.ts
v2/routes/DashboardV2.tsx
v2/state/uiStore.ts
v2/tokens/{colors,index,spacing,typography}.ts
```

## Files modified this sprint

```
index.tsx                  — ?v2=1 branch to lazy-load AppV2
services/geminiService.ts  — logistics fields on AgentAction.entities
```

---

Ready for review. Nothing awaits autonomous action; each next step
needs a user decision (PR base reconciliation, secret-setting,
Cloud Run build, Phase 1d apply window).

---

## Post-sprint update — 2026-04-17

### Phase 1c partial deploy (DONE)
- `auth-issue` and `gemini-proxy` deployed to `qfskvevighylzzmyiwre`.
- `APP_JWT_SIGNING_SECRET` set on Supabase (renamed from
  `SUPABASE_JWT_SECRET` because the CLI blocks that prefix — commit
  `3f812ca` carries the rename).
- Smoke tests green: auth-issue returns 400/401 as expected,
  gemini-proxy returns 401 without a valid user JWT.
- Live production (App Engine v9.29) is untouched — the new endpoints
  sit dormant until a new frontend build consumes them.

### ⚠️ Deferred: JWT secret rotation
The JWT secret value was pasted into the chat transcript during setup
and is now exposed at rest in that conversation history. Rotation is
**deliberately deferred** until the Cloud Run cutover because rotating
alone would break production:

- The live anon key and service-role key are JWTs signed with that
  same secret. Rotating invalidates them.
- Production v9.29 has the OLD anon key baked into the JS bundle — it
  would start returning 401 on every Supabase call.
- All active user sessions would be kicked out.

**Do the rotation as part of the Cloud Run cutover**, in one
coordinated move:
1. Rotate JWT secret in Supabase dashboard → copy new anon key.
2. Update frontend build env with new anon key.
3. `gcloud builds submit` + `gcloud run deploy`.
4. Re-run `supabase secrets set APP_JWT_SIGNING_SECRET=<new>`
   so `auth-issue` signs with the new key.
5. Users re-login.

Until then: don't share this conversation transcript outside the team.
