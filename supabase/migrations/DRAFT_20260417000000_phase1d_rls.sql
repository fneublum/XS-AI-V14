-- ⚠️ DRAFT — DO NOT APPLY AS-IS.
-- Phase 1d — Multi-tenant RLS rollout (Part 2 of 2).
--
-- Prerequisites (completed in Phase 1b — 20260416000000_multitenant_foundation.sql):
--   - Nullable companyId / company_id columns exist on all tenant-scoped tables.
--   - Indexes on those columns.
--
-- This migration:
--   1. Backfills NULL companyId values to a designated default tenant.
--   2. Enforces NOT NULL on companyId across tenant-scoped tables.
--   3. Enables RLS on each tenant-scoped table.
--   4. Installs a per-tenant policy that gates access via the caller's
--      allowed_company_ids (sourced from the JWT `app_metadata` claims
--      set by `supabase/functions/auth-issue/index.ts` when it mints
--      the session JWT).
--
-- Why draft-only:
--   - The client currently uses filterByCompany() in App.tsx:297. Enabling
--     RLS before the client sends a proper bearer token per request will
--     cause hard failures (zero rows returned). The sequence must be:
--       (a) Deploy auth-issue v2 that embeds allowed_company_ids into the
--           JWT claim `allowed_companies` (array of text).
--       (b) Verify every supabase.from(...) call in the app is using the
--           user's session JWT (not the anon key for writes).
--       (c) Run this migration.
--       (d) Remove filterByCompany() client-side (separate PR).
--
-- Rollback:
--   - `alter table <t> disable row level security;` then `drop policy ...`
--     — see the rollback block at the bottom of this file.

begin;

-- ── 1. Backfill helper ────────────────────────────────────────────────────
-- Designate the "legacy" company that will inherit any pre-multitenant rows.
-- Override before running in non-default environments.
do $$
declare
  v_default_company text := coalesce(current_setting('app.default_company_id', true), 'DEFAULT');
begin
  -- Seed a DEFAULT company if absent so the FK-style reference resolves.
  insert into companies (id, name)
  values (v_default_company, 'Default (backfilled)')
  on conflict (id) do nothing;

  -- Backfill every camelCase "companyId" column that's currently nullable.
  update customers              set "companyId" = v_default_company where "companyId" is null;
  update suppliers              set "companyId" = v_default_company where "companyId" is null;
  update opportunities          set "companyId" = v_default_company where "companyId" is null;
  update sales_orders           set "companyId" = v_default_company where "companyId" is null;
  update products               set "companyId" = v_default_company where "companyId" is null;
  update inventory              set "companyId" = v_default_company where "companyId" is null;
  update inventory_logs         set "companyId" = v_default_company where "companyId" is null;
  update ports                  set "companyId" = v_default_company where "companyId" is null;
  update carriers               set "companyId" = v_default_company where "companyId" is null;
  update cargo_agents           set "companyId" = v_default_company where "companyId" is null;
  update saved_locations        set "companyId" = v_default_company where "companyId" is null;
  update freight_quotes         set "companyId" = v_default_company where "companyId" is null;
  update shipments              set "companyId" = v_default_company where "companyId" is null;
  update bill_landings          set "companyId" = v_default_company where "companyId" is null;
  update bookings               set "companyId" = v_default_company where "companyId" is null;
  update estimates              set "companyId" = v_default_company where "companyId" is null;
  update proforma_invoices      set "companyId" = v_default_company where "companyId" is null;
  update purchase_order_extracts set "companyId" = v_default_company where "companyId" is null;
  update invoices               set "companyId" = v_default_company where "companyId" is null;
  update invoices_suppliers     set "companyId" = v_default_company where "companyId" is null;
  update packing_lists          set "companyId" = v_default_company where "companyId" is null;
  update packing_lists_suppliers set "companyId" = v_default_company where "companyId" is null;
  update commission_packing_lists set "companyId" = v_default_company where "companyId" is null;
  update commission_customer_invoices set "companyId" = v_default_company where "companyId" is null;
  update supplier_quotes        set "companyId" = v_default_company where "companyId" is null;
  update supplier_offers        set "companyId" = v_default_company where "companyId" is null;
  update purchase_orders        set "companyId" = v_default_company where "companyId" is null;
  update cost_calculations      set "companyId" = v_default_company where "companyId" is null;
  update form_layouts           set "companyId" = v_default_company where "companyId" is null;
  update customer_banks         set "companyId" = v_default_company where "companyId" is null;
  update wa_conversations       set "companyId" = v_default_company where "companyId" is null;
  update wa_messages            set "companyId" = v_default_company where "companyId" is null;
  update commission_sales_orders set "companyId" = v_default_company where "companyId" is null;
  -- Tables that use snake_case company_id:
  update costumer_description   set company_id  = v_default_company where company_id  is null;
  update activity_logs          set company_id  = v_default_company where company_id  is null;
  -- system_settings intentionally left NULL-able (NULL = global default).
end $$;

-- ── 2. Enforce NOT NULL ───────────────────────────────────────────────────
alter table customers                    alter column "companyId" set not null;
alter table suppliers                    alter column "companyId" set not null;
alter table opportunities                alter column "companyId" set not null;
alter table sales_orders                 alter column "companyId" set not null;
alter table products                     alter column "companyId" set not null;
alter table inventory                    alter column "companyId" set not null;
alter table inventory_logs               alter column "companyId" set not null;
alter table ports                        alter column "companyId" set not null;
alter table carriers                     alter column "companyId" set not null;
alter table cargo_agents                 alter column "companyId" set not null;
alter table saved_locations              alter column "companyId" set not null;
alter table freight_quotes               alter column "companyId" set not null;
alter table shipments                    alter column "companyId" set not null;
alter table bill_landings                alter column "companyId" set not null;
alter table bookings                     alter column "companyId" set not null;
alter table estimates                    alter column "companyId" set not null;
alter table proforma_invoices            alter column "companyId" set not null;
alter table purchase_order_extracts      alter column "companyId" set not null;
alter table invoices                     alter column "companyId" set not null;
alter table invoices_suppliers           alter column "companyId" set not null;
alter table packing_lists                alter column "companyId" set not null;
alter table packing_lists_suppliers      alter column "companyId" set not null;
alter table commission_packing_lists     alter column "companyId" set not null;
alter table commission_customer_invoices alter column "companyId" set not null;
alter table supplier_quotes              alter column "companyId" set not null;
alter table supplier_offers              alter column "companyId" set not null;
alter table purchase_orders              alter column "companyId" set not null;
alter table cost_calculations            alter column "companyId" set not null;
alter table form_layouts                 alter column "companyId" set not null;
alter table customer_banks               alter column "companyId" set not null;
alter table wa_conversations             alter column "companyId" set not null;
alter table wa_messages                  alter column "companyId" set not null;
alter table commission_sales_orders      alter column "companyId" set not null;
alter table costumer_description         alter column company_id  set not null;
alter table activity_logs                alter column company_id  set not null;

-- ── 3. Helper: extract caller's allowed companies from JWT ────────────────
-- auth-issue embeds allowed_company_ids into the JWT's app_metadata claim.
-- This function reads the raw JWT via auth.jwt() and returns the array.
create or replace function public.current_user_companies()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'allowed_company_ids')::jsonb
      ->> 0 is not null
      and array(
        select jsonb_array_elements_text(
          (auth.jwt() -> 'app_metadata' -> 'allowed_company_ids')::jsonb
        )
      ),
    array[]::text[]
  );
$$;

grant execute on function public.current_user_companies() to anon, authenticated;

-- ── 4. Enable RLS + per-tenant policy on every tenant-scoped table ────────
-- The policy pattern: allow the row iff "companyId" is in the caller's
-- allowed_company_ids. Service role bypasses RLS by default so qb-sync,
-- gemini-proxy, and other server-side paths remain unaffected.

do $$
declare
  t record;
  col text;
begin
  for t in
    select unnest(array[
      ('customers',               '"companyId"'),
      ('suppliers',               '"companyId"'),
      ('opportunities',           '"companyId"'),
      ('sales_orders',            '"companyId"'),
      ('products',                '"companyId"'),
      ('inventory',               '"companyId"'),
      ('inventory_logs',          '"companyId"'),
      ('ports',                   '"companyId"'),
      ('carriers',                '"companyId"'),
      ('cargo_agents',            '"companyId"'),
      ('saved_locations',         '"companyId"'),
      ('freight_quotes',          '"companyId"'),
      ('shipments',               '"companyId"'),
      ('bill_landings',           '"companyId"'),
      ('bookings',                '"companyId"'),
      ('estimates',               '"companyId"'),
      ('proforma_invoices',       '"companyId"'),
      ('purchase_order_extracts', '"companyId"'),
      ('invoices',                '"companyId"'),
      ('invoices_suppliers',      '"companyId"'),
      ('packing_lists',           '"companyId"'),
      ('packing_lists_suppliers', '"companyId"'),
      ('commission_packing_lists','"companyId"'),
      ('commission_customer_invoices','"companyId"'),
      ('supplier_quotes',         '"companyId"'),
      ('supplier_offers',         '"companyId"'),
      ('purchase_orders',         '"companyId"'),
      ('cost_calculations',       '"companyId"'),
      ('form_layouts',            '"companyId"'),
      ('customer_banks',          '"companyId"'),
      ('wa_conversations',        '"companyId"'),
      ('wa_messages',             '"companyId"'),
      ('commission_sales_orders', '"companyId"'),
      ('costumer_description',    'company_id'),
      ('activity_logs',           'company_id')
    ]::record[])
      as (table_name text, col_name text)
  loop
    execute format('alter table %I enable row level security;', t.table_name);
    execute format('drop policy if exists tenant_isolation on %I;', t.table_name);
    execute format(
      'create policy tenant_isolation on %I
         for all
         using (%s = any (public.current_user_companies()))
         with check (%s = any (public.current_user_companies()));',
      t.table_name, t.col_name, t.col_name
    );
  end loop;
end $$;

commit;

-- ── Rollback (run manually if needed) ─────────────────────────────────────
-- begin;
-- do $$
-- declare t text;
-- begin
--   for t in select unnest(array[
--     'customers','suppliers','opportunities','sales_orders','products',
--     'inventory','inventory_logs','ports','carriers','cargo_agents',
--     'saved_locations','freight_quotes','shipments','bill_landings',
--     'bookings','estimates','proforma_invoices','purchase_order_extracts',
--     'invoices','invoices_suppliers','packing_lists','packing_lists_suppliers',
--     'commission_packing_lists','commission_customer_invoices',
--     'supplier_quotes','supplier_offers','purchase_orders','cost_calculations',
--     'form_layouts','customer_banks','wa_conversations','wa_messages',
--     'commission_sales_orders','costumer_description','activity_logs'
--   ])
--   loop
--     execute format('drop policy if exists tenant_isolation on %I;', t);
--     execute format('alter table %I disable row level security;', t);
--   end loop;
-- end $$;
-- drop function if exists public.current_user_companies();
-- commit;
