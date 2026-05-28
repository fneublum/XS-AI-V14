-- Migration: auto-complete a Purchase Order when a Supplier Invoice
-- references it.
--
-- The link field is invoices_suppliers."customerPo" — semantically
-- "the PO number you issued to me, the supplier". When that field is
-- set on insert/update, this trigger flips the matching PO's status
-- to 'COMPLETED' so it falls out of the Cash Flow pipeline (which
-- excludes COMPLETED POs to avoid double-counting the imminent
-- supplier-invoice payment that's already projected in "Invoices
-- out").
--
-- Behaviour:
--   - Only updates POs that are NOT already COMPLETED or CANCELLED
--     (don't ressurect cancelled ones, don't churn the row needlessly).
--   - Empty/whitespace customerPo is ignored.
--   - The PO id must match exactly (case-sensitive). The Payables UI
--     uses purchase_orders.id directly as the PO number, so no fuzzy
--     matching needed.
--
-- Run once via Supabase Studio → SQL Editor. Safe to re-run thanks to
-- OR REPLACE / DROP IF EXISTS guards.

CREATE OR REPLACE FUNCTION public.mark_po_completed_on_supplier_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."customerPo" IS NOT NULL AND length(trim(NEW."customerPo")) > 0 THEN
    UPDATE public.purchase_orders
       SET status = 'COMPLETED'
     WHERE id = NEW."customerPo"
       AND status NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoice_completes_po ON public.invoices_suppliers;

CREATE TRIGGER trg_supplier_invoice_completes_po
  AFTER INSERT OR UPDATE OF "customerPo"
  ON public.invoices_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_po_completed_on_supplier_invoice();

-- One-time backfill: complete any PO that already has a supplier
-- invoice linked to it (no-op today since every existing row's
-- customerPo is null, but safe for future re-runs after admins have
-- backfilled the link).
UPDATE public.purchase_orders po
   SET status = 'COMPLETED'
  FROM public.invoices_suppliers si
 WHERE si."customerPo" = po.id
   AND po.status NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED');

-- Sanity check — should print 0 (or matching count post-backfill).
SELECT
  COUNT(DISTINCT po.id) AS pos_with_supplier_invoice
FROM public.purchase_orders po
JOIN public.invoices_suppliers si ON si."customerPo" = po.id;
