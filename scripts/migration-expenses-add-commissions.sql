-- Migration: add COMMISSIONS to the public.expenses.category check constraint.
--
-- The original migration (migration-add-expenses-table.sql) constrained
-- category to UTILITIES / OFFICE / FREIGHT / TRAVEL / FUEL / OTHER.
-- We can't extend a check constraint in place — drop and recreate with
-- the new value included. Idempotent thanks to IF EXISTS / IF NOT EXISTS
-- guards: safe to re-run.
--
-- Run once via Supabase Studio → SQL Editor.

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_category_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('UTILITIES', 'OFFICE', 'FREIGHT', 'TRAVEL', 'FUEL', 'COMMISSIONS', 'OTHER'));

-- Sanity check — should list every category present in the table.
SELECT category, COUNT(*) AS n
  FROM public.expenses
 GROUP BY category
 ORDER BY n DESC;
