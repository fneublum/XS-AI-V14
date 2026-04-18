-- ⚠️ DRAFT — apply via `supabase db push` when the orchestrator is ready
-- to persist telemetry. Phase 2A ships the code path; the table doesn't
-- exist yet so `v2/services/ai/telemetry.ts` swallows the insert error.

-- Telemetry row per AI call: provider/model picked, token counts,
-- latency, cache state, and any error. Drives a future dashboard +
-- lets us kill a misbehaving call site by filtering on `taskType`.

create table if not exists ai_telemetry (
  id              text primary key default (gen_random_uuid())::text,
  request_id      text not null,
  task_type       text not null,
  provider        text not null,
  model           text not null,
  latency_ms      integer not null default 0,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cached_input_tokens integer,
  cost_usd        numeric,
  cache           text not null,
  error           text,
  timestamp       timestamptz not null default now()
);

create index if not exists ai_telemetry_task_type_idx
  on ai_telemetry (task_type, timestamp desc);

create index if not exists ai_telemetry_provider_idx
  on ai_telemetry (provider, timestamp desc);

-- Retention — keep 30 days of telemetry, drop older rows nightly.
-- Implement via pg_cron once we're on Supabase Pro; for now, run
-- manually or via a scheduled Edge Function.
-- delete from ai_telemetry where timestamp < now() - interval '30 days';
