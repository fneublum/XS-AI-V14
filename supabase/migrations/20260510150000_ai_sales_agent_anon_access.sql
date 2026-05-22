-- Third follow-up. The previous migration's policies were scoped
-- `TO authenticated`, but the client uses the Supabase anon key (the app
-- runs its own auth via the `users` table — there's no Supabase Auth
-- session, so `auth.role()` is `anon`, not `authenticated`). With no
-- policy that admits `anon`, RLS denies every insert with error 42501.
--
-- Re-create the open policies without a role restriction so they admit
-- both anon and authenticated sessions. This stays consistent with the
-- rest of the app's tables, which were created before RLS was enforced
-- and so silently default to "no policy, no RLS check".
--
-- Once auth-issue v2 ships and the client switches to authenticated
-- sessions, tighten these back to `to authenticated using (...)`.

drop policy if exists "ai_sales_proposals_open" on ai_sales_proposals;
drop policy if exists "prospects_open"           on prospects;
drop policy if exists "ai_agent_identities_open" on ai_agent_identities;

create policy "ai_sales_proposals_open" on ai_sales_proposals for all
  using (true) with check (true);

create policy "prospects_open" on prospects for all
  using (true) with check (true);

create policy "ai_agent_identities_open" on ai_agent_identities for all
  using (true) with check (true);

notify pgrst, 'reload schema';
