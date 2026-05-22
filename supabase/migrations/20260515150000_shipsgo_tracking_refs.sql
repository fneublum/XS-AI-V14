-- ShipsGo container tracking — registration cache.
--
-- ShipsGo's "TrackingHub" API has a two-phase flow: you POST a
-- containerNumber once (charges 1 credit) and get back a numeric
-- requestId; thereafter you GET against that requestId for free.
-- This table maps containerNumber → requestId so the daily ETA refresh
-- function never re-registers the same container twice (which would
-- both waste credits and be ignored by ShipsGo).
--
-- Server-side only: the daily Edge Function writes here with the
-- service-role key. Clients have no need to read it, so RLS stays on
-- with no policy (= service role only).

create table if not exists shipsgo_tracking_refs (
  container_number text primary key,
  request_id       text not null,
  shipping_line    text,
  registered_at    timestamptz default now(),
  last_seen_at     timestamptz,
  last_eta         text,
  last_etd         text
);

create index if not exists shipsgo_tracking_refs_request_id_idx
  on shipsgo_tracking_refs (request_id);

alter table shipsgo_tracking_refs enable row level security;

-- No client policies. Service role bypasses RLS, so the Edge Function
-- can still read and write.
