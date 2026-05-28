-- Migration: add a paymentReceiptUrl column to public.expenses.
--
-- Used by the Pay action — when the user records a payment, they can
-- optionally upload (or OCR) a payment receipt PDF/image. Stored as a
-- data URL inline on the row, same pattern as expenses.attachmentUrl
-- (which holds the original invoice/receipt that created the expense).
-- Two columns so the original invoice and the proof-of-payment stay
-- distinct.
--
-- Safe to re-run thanks to IF NOT EXISTS.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS "paymentReceiptUrl" TEXT;

SELECT
  COUNT(*) FILTER (WHERE "paymentReceiptUrl" IS NOT NULL) AS with_payment_receipt,
  COUNT(*) AS total
FROM public.expenses;
