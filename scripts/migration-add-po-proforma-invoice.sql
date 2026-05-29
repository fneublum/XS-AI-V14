-- Migration: add proformaInvoiceUrl column to public.purchase_orders.
--
-- Background:
--   After issuing a PO, the supplier typically returns a PROFORMA
--   INVOICE — a binding price quote with payment terms, bank details
--   and an expiry. The buyer should attach this document to the
--   originating PO so it's right there when reconciling the eventual
--   commercial invoice, payment, or shipment.
--
-- Storage choice (data URL in TEXT, not Supabase Storage):
--   Mirrors how invoices."originalDocument" and expenses
--   ."paymentReceiptUrl" already work in this app — keeps everything
--   on the same code path (read column → render <iframe>/open in
--   tab) and avoids a separate bucket + RLS policy for one new field.
--   Proformas are usually 1-3 page PDFs (<1 MB), well within the
--   row-size budget for this pattern.
--
-- Behaviour after this migration:
--   - New column "proformaInvoiceUrl" TEXT, nullable, default NULL.
--   - Existing rows are unaffected (NULL = "no proforma uploaded").
--   - The application sets it via the PurchaseOrderDrawer's drop-zone.
--
-- Safe to re-run thanks to IF NOT EXISTS.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS "proformaInvoiceUrl" TEXT;

-- Sanity check — should print 1 row showing the column exists.
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'purchase_orders'
  AND column_name  = 'proformaInvoiceUrl';
