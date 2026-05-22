-- Agent regression-test harness.
--
-- Lets us run the full agent pipeline against historical deals as ground
-- truth without touching live rows. The harness writes shadow rows with
-- is_test=true and a comparator script diffs them against the live row
-- with the same business key (bl_number for audits, plNumber for PLs,
-- invoiceNumber for CIs). After review, `DELETE WHERE is_test=true` cleans
-- everything in one shot.

alter table bl_audits      add column if not exists is_test boolean default false not null;
alter table packing_lists  add column if not exists is_test boolean default false not null;
alter table invoices       add column if not exists is_test boolean default false not null;

-- Partial indexes: most queries hit live rows, so make the live-row path fast
create index if not exists idx_bl_audits_live      on bl_audits      (bl_number)   where is_test = false;
create index if not exists idx_packing_lists_live  on packing_lists  ("plNumber")  where is_test = false;
create index if not exists idx_invoices_live       on invoices       ("invoiceNumber") where is_test = false;

-- Also need an index on test rows for the test harness lookup
create index if not exists idx_bl_audits_test      on bl_audits      (bl_number)   where is_test = true;
create index if not exists idx_packing_lists_test  on packing_lists  ("plNumber")  where is_test = true;
create index if not exists idx_invoices_test       on invoices       ("invoiceNumber") where is_test = true;
