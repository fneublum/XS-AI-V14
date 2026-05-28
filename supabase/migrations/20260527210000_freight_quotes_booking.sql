-- Add booking_number to freight_quotes so the Margins page can
-- auto-attribute freight cost to a sales invoice that shares the
-- same booking.
--
-- The live freight_quotes table is snake_case end-to-end (per
-- v2/queries/useFreightQuotes.ts comment) — every existing column
-- is snake_cased. Sticking with that convention here.
--
-- Existing rows get NULL; users can backfill on individual quotes
-- as they go, or via a one-off update once we add a booking picker
-- to the freight-quote drawer.

alter table freight_quotes
  add column if not exists booking_number text;

comment on column freight_quotes.booking_number is
  'Booking # the freight quote applies to. NULL when the quote was issued without a confirmed booking yet. Powers the Margins page auto-attribution of freight cost to sales invoices via invoices.bookingNumber == freight_quotes.booking_number.';

-- Helpful index for the Margins per-booking lookup.
create index if not exists idx_freight_quotes_booking
  on freight_quotes (booking_number);
