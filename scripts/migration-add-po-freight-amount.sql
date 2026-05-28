-- Migration: add freightAmount column to public.purchase_orders.
--
-- Background:
--   Some POs carry a separate "local freight" line the buyer owes the
--   supplier on top of the goods price (e.g. inland freight to port).
--   Storing it on the line items would lose semantic — reports could
--   not tell freight apart from a goods line. Mirroring the
--   invoices_suppliers."freightAmount" column keeps the data model
--   consistent and makes future reconciliation (PO freight → bill
--   freight) trivial.
--
-- Behaviour after this migration:
--   - New column "freightAmount" NUMERIC NOT NULL DEFAULT 0.
--   - Existing rows backfill to 0 — no existing PO has captured
--     freight separately, so 0 preserves the old behaviour (totalAmount
--     already equals the goods subtotal for those rows).
--   - The application sets totalAmount = subtotal + freightAmount on
--     save, so the cash-flow / payables side keeps reading totalAmount
--     and automatically picks up freight without further changes.
--
-- Safe to re-run thanks to IF NOT EXISTS.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS "freightAmount" NUMERIC NOT NULL DEFAULT 0;

-- Sanity check — should print 0 rows where the column is missing.
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'purchase_orders'
  AND column_name  = 'freightAmount';
