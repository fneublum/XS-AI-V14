-- Add an email column to the companies table so each company can carry
-- its own contact email. Documents (proforma, invoice, packing list)
-- previously hardcoded `felipe@ec4.enterprises` in the header; once
-- populated this column overrides that fallback.

alter table companies add column if not exists "email" text;
