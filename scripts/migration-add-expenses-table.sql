-- Migration: create public.expenses for general operational expenses.
--
-- Distinct from public.invoices_suppliers (the supplier-invoice "bills"
-- already shown on the Payables page) — those are shipment-tied with
-- shipper/consignee/B-of-L fields. Expenses are freeform overhead:
-- utilities, fuel, office supplies, travel, broker fees, etc. They share
-- the Payables UI as a separate tab but are an independent entity.
--
-- Column naming: camelCase + quoted, matching every other table in the
-- app (e.g., invoices_suppliers, purchase_orders) so the React query
-- layer can pass values through without ad-hoc name mapping.
--
-- Run once via Supabase Studio → SQL Editor (or `supabase db push`).
-- Safe to re-run thanks to IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS public.expenses (
  id              TEXT PRIMARY KEY,
  "companyId"     TEXT NOT NULL,
  date            DATE NOT NULL,
  vendor          TEXT NOT NULL,
  amount          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  category        TEXT NOT NULL,
  notes           TEXT,
  "attachmentUrl" TEXT,
  "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  "paidDate"      DATE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"     TEXT,
  CONSTRAINT expenses_category_check
    CHECK (category IN ('UTILITIES', 'OFFICE', 'FREIGHT', 'TRAVEL', 'FUEL', 'OTHER')),
  CONSTRAINT expenses_payment_status_check
    CHECK ("paymentStatus" IN ('UNPAID', 'PAID', 'PARTIAL'))
);

-- Most queries scope by company + date-desc for "most recent first".
CREATE INDEX IF NOT EXISTS expenses_company_date_idx
  ON public.expenses ("companyId", date DESC);

-- Sanity check — should return 0 the first time.
SELECT COUNT(*) AS expense_count FROM public.expenses;
