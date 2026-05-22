-- Carry the chosen carrier booking on the sales order so docs (proforma,
-- invoice, packing list) can reference it without an extra join, and
-- the editor can pick from existing AVAILABLE bookings.

alter table sales_orders add column if not exists "bookingNumber" text;
