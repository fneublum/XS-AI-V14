-- One-off renumber: GENRYO's first invoice was auto-numbered against
-- EC4's pool before the per-company sequence fix landed, so it came
-- in as INV-3406. Resetting it to INV-0001 lets GENRYO's sequence
-- start fresh from #1; the next auto-generated number will be
-- INV-0002.
--
-- Safe to re-run: the update is conditional on the row still being
-- INV-3406 under GENRYO, and the WHERE narrows by both invoice
-- number and companyId so no other tenant is touched.
--
-- IMPORTANT: also re-point any downstream rows that reference the
-- invoice number as a string (transaction_allocations.invoiceId
-- stores the row UUID, not the number — so those don't need to
-- change. Same for receivables views, which join on the row id).
-- The only string references to invoiceNumber are display copies
-- in transaction memos / Dropbox file names, which we leave as
-- historical breadcrumbs.

update invoices
set "invoiceNumber" = 'INV-0001'
where "invoiceNumber" = 'INV-3406'
  and "companyId" = (
    select id from companies where name = 'GENRYO INTERNATIONAL' limit 1
  );
