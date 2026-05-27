-- Transaction allocations — extend to support supplier invoices.
--
-- The original migration (20260527120000) modelled allocation targets
-- as either invoices (AR) or purchase_orders (AP). But V14's AP flow
-- actually settles against `invoices_suppliers` rows, not POs — the PO
-- is the upstream commitment, the supplier invoice is what you pay.
--
-- Add a third target column + relax the one-of-N constraint.
-- Also add a balance view per supplier invoice that mirrors
-- ar_invoice_balances.

alter table transaction_allocations
  add column if not exists "supplierInvoiceId" text;

create index if not exists idx_alloc_supplier_invoice
  on transaction_allocations ("supplierInvoiceId");

-- Drop the old "exactly one of invoice/PO" constraint and replace with
-- "exactly one of invoice / supplier invoice / PO".
alter table transaction_allocations
  drop constraint if exists chk_one_target;

alter table transaction_allocations
  add constraint chk_one_target check (
    (("invoiceId"         is not null)::int +
     ("supplierInvoiceId" is not null)::int +
     ("purchaseOrderId"   is not null)::int) = 1
  );

-- AP balance per supplier invoice. Mirrors ar_invoice_balances:
-- sum of allocations against this supplier invoice from non-VOIDED
-- PAYMENT_OUT transactions.
--
-- `invoices_suppliers.totalAmount` is stored as TEXT in V14 (same
-- legacy quirk as customer invoices) so we cast and NULLIF-guard.
-- Supplier name lives on `shipperName` (with a `soldTo` fallback) in
-- the live invoices_suppliers schema. The `supplier` column referenced
-- in services/schema.ts does not actually exist — see comment in
-- v2/queries/usePayables.ts.
create or replace view ap_supplier_invoice_balances as
select
  si.id as "supplierInvoiceId",
  si."companyId",
  si."invoiceNumber",
  si."invoiceDate",
  coalesce(si."shipperName", si."soldTo") as supplier,
  coalesce(nullif(si."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(sum(a.amount), 0) as paid,
  coalesce(nullif(si."totalAmount"::text, '')::numeric, 0) - coalesce(sum(a.amount), 0) as balance
from invoices_suppliers si
left join transaction_allocations a on a."supplierInvoiceId" = si.id
left join transactions t on t.id = a."transactionId"
  and t.status != 'VOIDED'
  and t.kind = 'PAYMENT_OUT'
group by si.id, si."companyId", si."invoiceNumber", si."invoiceDate", si."shipperName", si."soldTo", si."totalAmount";

comment on column transaction_allocations."supplierInvoiceId" is
  'AP allocation target. Pays an invoices_suppliers row (vendor bill).';
