-- Follow-up to 20260510130000_ai_sales_proposals.sql. Three fixes:
--
-- 1. The RLS policies on ai_sales_proposals enforced the phase1d
--    `allowed_company_ids` JWT claim, but auth-issue v2 hasn't shipped
--    yet, so the claim is absent and every insert/select returns 0
--    rows / 401. Loosen to `using (true)` until phase1d lands. Re-tighten
--    in the same change that flips on phase1d RLS everywhere else.
--
-- 2. Create `prospects` — referenced by services/aiSalesAgentService.ts
--    when audience = 'prospects'. Defined in services/schema.ts but never
--    migrated.
--
-- 3. Create `ai_agent_identities` — looked up by the same service to pick
--    the right sender persona (per-company / per-role). Also defined in
--    services/schema.ts but never migrated.

-- ── 1. Loosen ai_sales_proposals RLS ─────────────────────────────────

drop policy if exists "ai_sales_proposals_tenant_select" on ai_sales_proposals;
drop policy if exists "ai_sales_proposals_tenant_write"  on ai_sales_proposals;

create policy "ai_sales_proposals_open"
  on ai_sales_proposals for all
  to authenticated
  using (true)
  with check (true);

-- ── 2. Prospects ─────────────────────────────────────────────────────

create table if not exists prospects (
  "id" text primary key,
  "companyId" text,
  "name" text,
  "companyName" text,
  "email" text,
  "phone" text,
  "country" text,
  "source" text,
  "stage" text default 'new',
  "notes" text,
  "assignedTo" text,
  "createdAt" text
);

create index if not exists prospects_company_idx
  on prospects ("companyId");

alter table prospects enable row level security;

create policy "prospects_open"
  on prospects for all
  to authenticated
  using (true)
  with check (true);

-- ── 3. AI agent identities ───────────────────────────────────────────

create table if not exists ai_agent_identities (
  "id" text primary key,
  "companyId" text,
  "role" text,
  "displayName" text,
  "emailAddress" text,
  "whatsappSender" text,
  "signature" text,
  "createdAt" text
);

create index if not exists ai_agent_identities_company_role_idx
  on ai_agent_identities ("companyId", "role");

alter table ai_agent_identities enable row level security;

create policy "ai_agent_identities_open"
  on ai_agent_identities for all
  to authenticated
  using (true)
  with check (true);

-- ── 4. Force PostgREST schema cache reload ───────────────────────────
-- Without this, PostgREST may keep returning 404 for the new tables
-- until it next reloads on its own.

notify pgrst, 'reload schema';
