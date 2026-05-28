-- Add `freightAmount` to invoices_suppliers.
--
-- Supplier invoices for ocean shipments commonly itemise:
--   subtotal (goods)
--   freight charges
--   total amount due
--
-- Today only `subtotal` and `totalAmount` exist on the table, which
-- means the freight component has nowhere to land — the AI Upload
-- prompt has to fold it into either of those. Adding an explicit
-- column lets the OCR extractor capture freight separately, and
-- the Margins page can later use it as an alternate freight-cost
-- signal when the standalone freight_quotes link is missing.
--
-- Nullable so existing rows stay valid; new uploads populate it
-- when present on the supplier invoice.

alter table invoices_suppliers
  add column if not exists "freightAmount" numeric;

comment on column invoices_suppliers."freightAmount" is
  'Freight charges line itemised on the supplier invoice. NULL when not present.';
