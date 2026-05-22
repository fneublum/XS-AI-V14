-- Open INSERT on bl_audits for authenticated users too, so the XS-AI
-- frontend can seed test rows / let users manually create audits.
-- Hermes still writes via service_role and bypasses RLS regardless.

drop policy if exists bl_audits_insert on bl_audits;
create policy bl_audits_insert on bl_audits
  for insert to authenticated
  with check (true);
