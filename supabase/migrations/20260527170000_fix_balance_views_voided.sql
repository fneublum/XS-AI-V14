-- Fix AR/AP balance views — voided transactions were still counted.
--
-- The original views (20260527120000, 20260527130000) put the
-- `t.status != 'VOIDED'` and `t.kind = ...` filters in the LEFT JOIN's
-- ON clause:
--
--   left join transaction_allocations a on a."invoiceId" = i.id
--   left join transactions t on t.id = a."transactionId"
--     and t.status != 'VOIDED' and t.kind = 'PAYMENT_IN'
--
-- Because the JOIN to `transactions` is LEFT, a voided transaction
-- simply fails the JOIN's ON match — but the allocation row was
-- already attached in the prior LEFT JOIN, so its amount kept being
-- summed. Result: voiding a $8,100 receipt and recording a new
-- $8,100 receipt produced paid = $16,200 on the AR view (and the
-- Statement view in the drawer reconciled the phantom $8,100 as
-- "Legacy / QB-imported payments" — see screenshot flagged
-- 2026-05-27).
--
-- Fix: pre-aggregate allocations through an INNER JOIN to
-- transactions with the proper filters, then LEFT JOIN the
-- aggregate to invoices / supplier_invoices / POs. The LEFT JOIN
-- still preserves rows with zero payments.

create or replace view ar_invoice_balances as
select
  i.id as "invoiceId",
  i."companyId",
  i."invoiceNumber",
  i."invoiceDate",
  i."soldTo",
  coalesce(nullif(i."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(p.paid, 0) as paid,
  coalesce(nullif(i."totalAmount"::text, '')::numeric, 0) - coalesce(p.paid, 0) as balance
from invoices i
left join (
  select a."invoiceId", sum(a.amount) as paid
  from transaction_allocations a
  inner join transactions t
    on t.id = a."transactionId"
   and t.status != 'VOIDED'
   and t.kind = 'PAYMENT_IN'
  where a."invoiceId" is not null
  group by a."invoiceId"
) p on p."invoiceId" = i.id;

create or replace view ap_po_balances as
select
  po.id as "purchaseOrderId",
  po."companyId",
  coalesce(nullif(po."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(p.paid, 0) as paid,
  coalesce(nullif(po."totalAmount"::text, '')::numeric, 0) - coalesce(p.paid, 0) as balance
from purchase_orders po
left join (
  select a."purchaseOrderId", sum(a.amount) as paid
  from transaction_allocations a
  inner join transactions t
    on t.id = a."transactionId"
   and t.status != 'VOIDED'
   and t.kind = 'PAYMENT_OUT'
  where a."purchaseOrderId" is not null
  group by a."purchaseOrderId"
) p on p."purchaseOrderId" = po.id;

create or replace view ap_supplier_invoice_balances as
select
  si.id as "supplierInvoiceId",
  si."companyId",
  si."invoiceNumber",
  si."invoiceDate",
  coalesce(si."shipperName", si."soldTo") as supplier,
  coalesce(nullif(si."totalAmount"::text, '')::numeric, 0) as "totalAmount",
  coalesce(p.paid, 0) as paid,
  coalesce(nullif(si."totalAmount"::text, '')::numeric, 0) - coalesce(p.paid, 0) as balance
from invoices_suppliers si
left join (
  select a."supplierInvoiceId", sum(a.amount) as paid
  from transaction_allocations a
  inner join transactions t
    on t.id = a."transactionId"
   and t.status != 'VOIDED'
   and t.kind = 'PAYMENT_OUT'
  where a."supplierInvoiceId" is not null
  group by a."supplierInvoiceId"
) p on p."supplierInvoiceId" = si.id;
