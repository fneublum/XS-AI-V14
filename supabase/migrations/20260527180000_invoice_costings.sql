-- Invoice Costings — per-sales-invoice cost overrides + "other"
-- (duty / brokerage / insurance / bank-fees / misc) entries that
-- power the Finance > Margins screen.
--
-- The base computation pulls supplier cost from `invoices_suppliers`
-- (preferred) or `purchase_orders` (fallback) and freight from
-- `freight_quotes`, auto-linked by bookingNumber. This table layers
-- explicit overrides on top: when a user disagrees with the auto-
-- match, or needs to record costs not captured upstream, the row
-- here is the source of truth.
--
-- Every column is optional. If a column is null, the margin engine
-- falls back to the auto-attributed value. A row exists iff the
-- user has touched the costing for that invoice at least once.

create table if not exists invoice_costings (
  "invoiceId"             text primary key
    references invoices(id) on delete cascade,
  "companyId"             text,
  -- Manual overrides for the auto-attributed amounts. NULL means
  -- "use the auto-computed value".
  "supplierCostOverride"  numeric,
  "freightCostOverride"   numeric,
  -- Itemised "other" costs entered manually.
  "dutyUSD"               numeric not null default 0,
  "brokerageUSD"          numeric not null default 0,
  "insuranceUSD"          numeric not null default 0,
  "bankFeesUSD"           numeric not null default 0,
  "otherUSD"              numeric not null default 0,
  notes                   text,
  -- Optional manual linkage when the auto-link-by-bookingNumber
  -- picked the wrong PO / supplier invoice. Stored as comma-
  -- separated ids (one invoice can attribute multiple POs when a
  -- shipment was sourced from several suppliers).
  "supplierInvoiceIds"    text,
  "purchaseOrderIds"      text,
  "freightQuoteIds"       text,
  "updatedAt"             timestamptz not null default now(),
  "updatedBy"             text
);

create index if not exists idx_invoice_costings_company
  on invoice_costings ("companyId");

-- RLS — V14 browser uses anon; service role bypasses.
alter table invoice_costings enable row level security;

drop policy if exists "anon read invoice_costings" on invoice_costings;
create policy  "anon read invoice_costings"
  on invoice_costings for select
  to anon, authenticated
  using (true);

drop policy if exists "anon write invoice_costings" on invoice_costings;
create policy  "anon write invoice_costings"
  on invoice_costings for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table invoice_costings is
  'Per-invoice cost overrides + "other" cost components powering the Finance > Margins page.';
