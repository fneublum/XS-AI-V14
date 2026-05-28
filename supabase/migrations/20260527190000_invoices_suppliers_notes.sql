-- Add `notes` to invoices_suppliers.
--
-- The PayablesV2 QuickCreate drawer has a Notes textarea (the user
-- can leave a free-text comment on a supplier bill) and the save
-- payload includes a `notes` field. The column was never created
-- in the live schema, so PostgREST returned 400 with
-- `column invoices_suppliers.notes does not exist` whenever the
-- user tried to save a new payable (2026-05-27 reproduced).
--
-- Adding as nullable text — matches the camelCase / quoted style
-- the rest of the table uses, and lets existing rows stay untouched.

alter table invoices_suppliers
  add column if not exists notes text;

comment on column invoices_suppliers.notes is
  'Free-text note from the PayablesV2 drawer (Notes field).';
