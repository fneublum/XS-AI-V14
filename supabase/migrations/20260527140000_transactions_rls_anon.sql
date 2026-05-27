-- Transactions RLS — open to anon as well.
--
-- The original policies in 20260527120000 restricted writes to the
-- `authenticated` role, but V14's browser client currently runs
-- anonymously against Supabase (no end-user auth session — the app
-- uses RLS-gated company scoping at the query level instead).
--
-- Mirror the practical pattern every other v2 CRUD table uses: allow
-- anon + authenticated to read and write. Company scoping is enforced
-- by the React Query hooks (see scopeByCompany in v2/queries/*.ts).

-- Transactions
drop policy if exists transactions_select on transactions;
create policy transactions_select on transactions
  for select to anon, authenticated using (true);

drop policy if exists transactions_insert on transactions;
create policy transactions_insert on transactions
  for insert to anon, authenticated with check (true);

drop policy if exists transactions_update on transactions;
create policy transactions_update on transactions
  for update to anon, authenticated using (true) with check (true);

drop policy if exists transactions_delete on transactions;
create policy transactions_delete on transactions
  for delete to anon, authenticated using (true);

-- Allocations
drop policy if exists alloc_select on transaction_allocations;
create policy alloc_select on transaction_allocations
  for select to anon, authenticated using (true);

drop policy if exists alloc_insert on transaction_allocations;
create policy alloc_insert on transaction_allocations
  for insert to anon, authenticated with check (true);

drop policy if exists alloc_update on transaction_allocations;
create policy alloc_update on transaction_allocations
  for update to anon, authenticated using (true) with check (true);

drop policy if exists alloc_delete on transaction_allocations;
create policy alloc_delete on transaction_allocations
  for delete to anon, authenticated using (true);
