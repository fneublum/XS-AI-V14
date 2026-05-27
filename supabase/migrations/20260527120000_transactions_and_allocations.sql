-- Transactions + allocations — Phase 1 foundation.
--
-- Unified payment ledger. Holds AR receipts (PAYMENT_IN) and AP payments
-- (PAYMENT_OUT) from three sources:
--   - MANUAL    : Felipe enters via Record-payment/receipt modal
--   - OCR       : Lara/Gemini extracts from uploaded receipt PDFs
--   - QB_SYNC   : Phase 4 — pulled from QuickBooks per-company
--   - BANK_IMPORT : (future) CSV bank-statement reconciliation
--
-- Granularity: one row per bank movement. A single wire that pays
-- multiple invoices creates ONE `transactions` row + N child rows in
-- `transaction_allocations`. Unallocated payments (advances / credit
-- notes) just have no child allocations and sit as a credit balance
-- on the counterparty.
--
-- AR statement = invoices.totalAmount - sum(allocations.amount) per
-- invoice, aged by today() - invoiceDate. Same logic for AP against
-- purchase_orders / supplier bills.
--
-- Source-of-truth design lives in this migration's header + the
-- in-product Finance runbook (TBD, Phase 3).

-- ──────────────────────────────────────────────────────────────────
-- TRANSACTIONS — one row per bank movement
-- ──────────────────────────────────────────────────────────────────
create table if not exists transactions (
  id                  text primary key,             -- 'TXN-{epoch_ms}-{rand}'
  "companyId"         text not null,                -- scoping (same as everything else)

  source              text not null
    check (source in ('MANUAL','OCR','QB_SYNC','BANK_IMPORT')),

  kind                text not null
    check (kind in ('PAYMENT_IN','PAYMENT_OUT','CREDIT_NOTE','WRITE_OFF')),

  "txnDate"           date not null,
  amount              numeric(14,2) not null check (amount >= 0),
  currency            text not null default 'USD',
  method              text                          -- 'WIRE'|'ACH'|'CHECK'|'CARD'|'CASH'|'OTHER'
    check (method in ('WIRE','ACH','CHECK','CARD','CASH','OTHER') or method is null),

  -- Counterparty: who paid us / who we paid. Stored both as a FK
  -- (counterpartyId) and a denormalised name for fast read on the
  -- transactions journal without joining on every row.
  "counterpartyType"  text                          -- 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL'
    check ("counterpartyType" in ('CUSTOMER','SUPPLIER','INTERNAL') or "counterpartyType" is null),
  "counterpartyId"    text,
  "counterpartyName"  text,

  reference           text,                         -- bank ref / check # / wire ID
  memo                text,

  status              text not null default 'UNMATCHED'
    check (status in ('UNMATCHED','MATCHED','RECONCILED','VOIDED')),
    -- UNMATCHED  = entered but not yet linked to any invoice (advance / credit)
    -- MATCHED    = at least one allocation row created, manually or by AI
    -- RECONCILED = matched + verified against bank statement (future)
    -- VOIDED     = soft-delete; ignore for balances

  -- OCR / AI provenance
  "receiptUrl"        text,                         -- public URL of the receipt PDF
  "ocrConfidence"     numeric(4,3),                 -- 0.000-1.000
  ai_status           text                          -- mirrors invoices/packing_lists pattern
    check (ai_status in ('ai_draft','approved','rejected') or ai_status is null),

  -- QuickBooks provenance (Phase 4). Unique so re-runs of the sync
  -- upsert instead of duplicating.
  "qbId"              text unique,
  "qbSyncedAt"        timestamptz,

  "createdAt"         timestamptz not null default now(),
  "createdBy"         text,                         -- user id / agent id
  "updatedAt"         timestamptz not null default now()
);

create index if not exists idx_txn_company_date
  on transactions ("companyId", "txnDate" desc);
create index if not exists idx_txn_counterparty
  on transactions ("counterpartyId");
create index if not exists idx_txn_status
  on transactions (status) where status != 'VOIDED';
create index if not exists idx_txn_ai_status
  on transactions (ai_status) where ai_status = 'ai_draft';

-- ──────────────────────────────────────────────────────────────────
-- TRANSACTION_ALLOCATIONS — split a single bank movement across invoices
-- ──────────────────────────────────────────────────────────────────
-- A $50,000 wire that pays INV-100 ($30k) + INV-101 ($20k) is:
--   transactions row (amount = 50000)
--   ↳ allocation row (invoiceId=INV-100, amount=30000)
--   ↳ allocation row (invoiceId=INV-101, amount=20000)
--
-- Invariant: sum(allocations.amount) <= transactions.amount.
-- Anything unallocated is the counterparty's credit balance.
create table if not exists transaction_allocations (
  id                  text primary key,             -- 'ALLOC-{epoch_ms}-{rand}'
  "transactionId"     text not null references transactions(id) on delete cascade,

  -- Exactly ONE of these two should be set per row. AR receipts allocate
  -- to invoices; AP payments allocate to purchase_orders.
  "invoiceId"         text,                         -- references invoices.id
  "purchaseOrderId"   text,                         -- references purchase_orders.id

  amount              numeric(14,2) not null check (amount > 0),
  memo                text,
  "createdAt"         timestamptz not null default now(),

  -- A row must reference exactly one of invoice or PO (not both, not neither)
  constraint chk_one_target check (
    ("invoiceId" is not null and "purchaseOrderId" is null) or
    ("invoiceId" is null and "purchaseOrderId" is not null)
  )
);

create index if not exists idx_alloc_txn
  on transaction_allocations ("transactionId");
create index if not exists idx_alloc_invoice
  on transaction_allocations ("invoiceId");
create index if not exists idx_alloc_po
  on transaction_allocations ("purchaseOrderId");

-- ──────────────────────────────────────────────────────────────────
-- RLS — authenticated users in the same company can read + write
-- ──────────────────────────────────────────────────────────────────
-- The CompanyProvider client-side filter still applies (queries always
-- send a companyId.eq filter), so this policy is the floor: anyone
-- authenticated can read/write any company's transactions. Tighten
-- to per-company role-based access in a later migration if we ever
-- onboard external bookkeepers.
alter table transactions enable row level security;
alter table transaction_allocations enable row level security;

drop policy if exists transactions_select on transactions;
create policy transactions_select on transactions
  for select to authenticated using (true);

drop policy if exists transactions_insert on transactions;
create policy transactions_insert on transactions
  for insert to authenticated with check (true);

drop policy if exists transactions_update on transactions;
create policy transactions_update on transactions
  for update to authenticated using (true) with check (true);

drop policy if exists transactions_delete on transactions;
create policy transactions_delete on transactions
  for delete to authenticated using (true);

drop policy if exists alloc_select on transaction_allocations;
create policy alloc_select on transaction_allocations
  for select to authenticated using (true);

drop policy if exists alloc_insert on transaction_allocations;
create policy alloc_insert on transaction_allocations
  for insert to authenticated with check (true);

drop policy if exists alloc_update on transaction_allocations;
create policy alloc_update on transaction_allocations
  for update to authenticated using (true) with check (true);

drop policy if exists alloc_delete on transaction_allocations;
create policy alloc_delete on transaction_allocations
  for delete to authenticated using (true);

-- ──────────────────────────────────────────────────────────────────
-- VIEWS — convenience for AR/AP balance computation
-- ──────────────────────────────────────────────────────────────────
-- AR balance per invoice: invoice.totalAmount minus sum of allocations
-- against it from non-VOIDED PAYMENT_IN transactions. Negative balance
-- = customer overpaid (credit on account).
-- invoices.totalAmount is stored as TEXT in V14's legacy schema, so we
-- cast to numeric inside the view. NULLIF guards against blank strings
-- that would otherwise blow up the cast.
create or replace view ar_invoice_balances as
select
  i.id as "invoiceId",
  i."companyId",
  i."invoiceNumber",
  i."invoiceDate",
  i."soldTo",
  coalesce(nullif(i."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(sum(a.amount), 0) as paid,
  coalesce(nullif(i."totalAmount"::text, '')::numeric, 0) - coalesce(sum(a.amount), 0) as balance
from invoices i
left join transaction_allocations a on a."invoiceId" = i.id
left join transactions t on t.id = a."transactionId"
  and t.status != 'VOIDED'
  and t.kind = 'PAYMENT_IN'
group by i.id, i."companyId", i."invoiceNumber", i."invoiceDate", i."soldTo", i."totalAmount";

-- AP balance per PO. Mirrors the AR view but against purchase_orders +
-- PAYMENT_OUT transactions. If purchase_orders has a different total
-- column name, the FinancePayables hook adapts; this view returns
-- whatever's stored under "totalAmount" on the PO row.
create or replace view ap_po_balances as
select
  po.id as "purchaseOrderId",
  po."companyId",
  coalesce(nullif(po."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(sum(a.amount), 0) as paid,
  coalesce(nullif(po."totalAmount"::text, '')::numeric, 0) - coalesce(sum(a.amount), 0) as balance
from purchase_orders po
left join transaction_allocations a on a."purchaseOrderId" = po.id
left join transactions t on t.id = a."transactionId"
  and t.status != 'VOIDED'
  and t.kind = 'PAYMENT_OUT'
group by po.id, po."companyId", po."totalAmount";

comment on table transactions is
  'Unified payment ledger. AR + AP. Sources: MANUAL, OCR, QB_SYNC, BANK_IMPORT.';
comment on table transaction_allocations is
  'Splits a single bank movement across one or more invoices / POs.';
