-- Agent-to-supplier commission invoice plumbing.
--
-- The sales AGENT issues an invoice back to the SUPPLIER for the
-- commission earned on each closed order. Previously the v1 flow only
-- stored the commission amount on commission_sales_orders; there was
-- no dedicated place for the agent's invoice # / date / PDF. These
-- three columns give the v2 Agent Sales Orders drawer a home for
-- that artifact. The PDF itself lives in the `commission-invoices`
-- storage bucket and the column stores its public path.

alter table commission_sales_orders
  add column if not exists "commissionInvoiceNumber" text,
  add column if not exists "commissionInvoiceDate"   text,
  add column if not exists "commissionInvoicePdfUrl" text;

-- Storage bucket for agent-issued commission invoices (PDF files the
-- agent sends to the supplier). Private by default — signed URLs are
-- generated per download.
insert into storage.buckets (id, name, public)
values ('commission-invoices', 'commission-invoices', false)
on conflict (id) do nothing;

-- Let any authenticated user read/write inside this bucket. Finer
-- per-company policies can be layered later; for now we mirror the
-- permissive RLS used by the rest of the commission_* tables.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'commission_invoices_all'
  ) then
    create policy commission_invoices_all on storage.objects
      for all
      using (bucket_id = 'commission-invoices')
      with check (bucket_id = 'commission-invoices');
  end if;
end $$;
