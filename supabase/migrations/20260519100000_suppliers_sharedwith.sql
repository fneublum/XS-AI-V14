-- Add the sharedWith column on suppliers so the v2 SupplierDrawer can
-- offer cross-company visibility the same way the CustomerDrawer does.
-- Without this column, any PATCH that includes `sharedWith` would 400
-- and silently break unrelated writes on the same payload (the same
-- failure mode that drove 20260423190000_customers_sharedwith.sql).
--
-- Server-side scoping isn't filter-based today — the column is read
-- by the drawer for the toggle UI and used downstream by anywhere
-- that wants to honour multi-tenant sharing. Idempotent.
alter table suppliers add column if not exists "sharedWith" text[] default '{}';
