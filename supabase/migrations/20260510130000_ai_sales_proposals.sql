-- AI Sales Agent proposal queue. The application code in
-- services/aiSalesAgentService.ts inserts every draft into this table
-- (status = 'pending_approval' for review-mode, 'sending' once an
-- auto-send is dispatched). The table was defined in
-- services/schema.ts as part of the copy-paste setup script but never
-- promoted to a migration, so the deployed Supabase instance returns
-- "Could not find the table 'public.ai_sales_proposals' in the schema
-- cache" on every draft attempt. This migration creates it.

create table if not exists ai_sales_proposals (
  "id" text primary key,
  "companyId" text,
  "audience" text,
  "customerId" text,
  "prospectId" text,
  "salesRepId" text,
  "recipientName" text,
  "recipientEmail" text,
  "recipientPhone" text,
  "channel" text,
  "status" text default 'draft',
  "mode" text default 'review',
  "intent" text,
  "subject" text,
  "body" text,
  "whatsappPreview" text,
  "pdfUrl" text,
  "reasoning" text,
  "items" jsonb,
  "totalAmount" numeric,
  "currency" text,
  "agentIdentityId" text,
  "sentAt" text,
  "errorMessage" text,
  "createdBy" text,
  "createdAt" text
);

-- Queue listings sort by createdAt desc and filter by status / audience.
create index if not exists ai_sales_proposals_company_created_idx
  on ai_sales_proposals ("companyId", "createdAt" desc);
create index if not exists ai_sales_proposals_status_idx
  on ai_sales_proposals ("status");

alter table ai_sales_proposals enable row level security;

-- Tenant-scoped access for authenticated clients. Mirrors the pattern
-- used elsewhere in the app: rows are visible iff their companyId is in
-- the caller's allowed_company_ids JWT claim. Falls back to "no rows"
-- when the claim is absent rather than leaking cross-tenant data.
create policy "ai_sales_proposals_tenant_select"
  on ai_sales_proposals for select
  to authenticated
  using (
    "companyId" is null
    or "companyId" in (
      select jsonb_array_elements_text(
        coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_company_ids')::jsonb, '[]'::jsonb)
      )
    )
  );

create policy "ai_sales_proposals_tenant_write"
  on ai_sales_proposals for all
  to authenticated
  using (
    "companyId" is null
    or "companyId" in (
      select jsonb_array_elements_text(
        coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_company_ids')::jsonb, '[]'::jsonb)
      )
    )
  )
  with check (
    "companyId" is null
    or "companyId" in (
      select jsonb_array_elements_text(
        coalesce((auth.jwt() -> 'app_metadata' -> 'allowed_company_ids')::jsonb, '[]'::jsonb)
      )
    )
  );
