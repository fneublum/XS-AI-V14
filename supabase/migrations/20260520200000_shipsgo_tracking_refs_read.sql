-- Allow authenticated users to READ the ShipsGo tracking-refs cache so
-- the Logistics Follow Up page can surface "last refresh" / "tracked
-- by" per invoice. Writes still go through the service role only — no
-- new write policy is added.

drop policy if exists shipsgo_tracking_refs_read on shipsgo_tracking_refs;

create policy shipsgo_tracking_refs_read
on shipsgo_tracking_refs
for select
to authenticated
using (true);
