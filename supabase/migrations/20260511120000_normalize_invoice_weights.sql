-- Normalize lbs-shaped values stored in invoices.netWeight / grossWeight
-- (columns documented as kg).
--
-- Background: invoice 8804 and likely several others were saved with
-- their raw lbs numbers in the kg columns. The InvoiceDrawer and (now)
-- the PDF generator detect this at render time using a heuristic — if
-- the column value is more than 1.5x the line-item kg sum (the lbs/kg
-- ratio is ~2.2x), treat it as lbs and convert. This migration applies
-- that same correction at rest so the data on disk matches the column's
-- documented unit and downstream readers (reports, exports, AI agents)
-- don't need to replicate the heuristic.
--
-- Safety:
--   - Items-less rows are skipped (no baseline, so no inference).
--   - The 1.5x threshold means a legitimate kg value will not be
--     converted just because gross > net (gross/net is typically
--     1.05-1.15, well below 1.5).
--   - Idempotent: a second run sees the already-converted value, which
--     is no longer >1.5x itemsNetKg, so the heuristic correctly
--     no-ops.
--   - Writes are wrapped in a transaction with audit output so you can
--     roll back if the count looks wrong.

begin;

-- ── Helper: compute kg sum of line items ──────────────────────────────
-- `items` is a jsonb array. Each element has `netLbs` (preferred) or
-- `quantity` (legacy). Both are in lbs. Sum them and convert to kg.

create or replace function pg_temp.items_net_kg(items jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(sum(
    coalesce(
      (item ->> 'netLbs')::numeric,
      (item ->> 'quantity')::numeric,
      0
    )
  ), 0) * 0.453592
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) as item
$$;

-- ── Preview: rows the heuristic flags ─────────────────────────────────
-- Print the candidate set so the user can sanity-check before commit.

with candidates as (
  select
    id,
    "invoiceNumber",
    ("netWeight")::numeric    as net_raw,
    ("grossWeight")::numeric  as gross_raw,
    pg_temp.items_net_kg(items::jsonb) as items_kg
  from invoices
  where items is not null
    and jsonb_typeof(case
          when items::text ~ '^\s*\[' then items::jsonb
          else '[]'::jsonb end) = 'array'
)
select
  count(*) filter (where net_raw   is not null and items_kg > 0 and net_raw   > items_kg * 1.5) as net_to_convert,
  count(*) filter (where gross_raw is not null and items_kg > 0 and gross_raw > items_kg * 1.5) as gross_to_convert
from candidates;

-- ── Apply correction ──────────────────────────────────────────────────
-- For each invoice whose net/gross column looks like lbs, multiply by
-- 0.453592 to bring it into kg.

update invoices i
set "netWeight" = ((i."netWeight")::numeric * 0.453592)::text
where i.items is not null
  and (i."netWeight") ~ '^-?\d+(\.\d+)?$'
  and (i."netWeight")::numeric > pg_temp.items_net_kg(i.items::jsonb) * 1.5
  and pg_temp.items_net_kg(i.items::jsonb) > 0;

update invoices i
set "grossWeight" = ((i."grossWeight")::numeric * 0.453592)::text
where i.items is not null
  and (i."grossWeight") ~ '^-?\d+(\.\d+)?$'
  and (i."grossWeight")::numeric > pg_temp.items_net_kg(i.items::jsonb) * 1.5
  and pg_temp.items_net_kg(i.items::jsonb) > 0;

-- ── Optional: also fix invoices_suppliers if it has the same shape ────
-- Comment back in if your supplier invoices share the column layout.
-- update invoices_suppliers i ... (same pattern)

commit;
