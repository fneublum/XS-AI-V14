-- Server-side inbox scan log.
--
-- The `inbox-scan` Edge Function polls the connected mailbox every
-- 30 minutes (via pg_cron) and writes a row here per message it
-- finds. Decoupled from the browser-localStorage inbox log so the
-- server scan can keep working when no app tab is open.
--
-- The browser inbox log (`v2/services/inboxLog.ts`) remains the
-- source of truth for UI queues — when the app loads, it can pull
-- recent rows from this table and reconcile them with its local
-- log. The server doesn't try to OCR here; that stays in the
-- browser where Gemini calls already work and the per-user quota
-- applies.

create table if not exists inbox_scan_log (
  id              text primary key,
  message_id      text not null,
  source          text not null check (source in ('outlook', 'gmail')),
  from_address    text,
  from_name       text,
  subject         text,
  received_at     timestamptz,
  has_attachment  boolean not null default false,
  attachment_name text,
  attachment_mime text,
  is_read         boolean,
  -- Scan-time bookkeeping
  scanned_at      timestamptz not null default now(),
  scan_status     text not null default 'discovered'
                  check (scan_status in ('discovered', 'queued_for_ocr', 'processed_by_browser', 'ignored', 'error')),
  scan_error      text
);

-- One row per (message_id, attachment_name) so multi-attachment emails
-- get one row per attachment, matching how the browser-side log treats
-- them. Outlook/Gmail message IDs are globally unique so we don't need
-- to prefix with source.
create unique index if not exists inbox_scan_log_dedup_idx
  on inbox_scan_log (message_id, coalesce(attachment_name, ''));

create index if not exists inbox_scan_log_received_idx
  on inbox_scan_log (received_at desc);

create index if not exists inbox_scan_log_status_idx
  on inbox_scan_log (scan_status);

alter table inbox_scan_log enable row level security;

-- Authenticated app users can read the log. The Edge Function uses
-- service-role and bypasses RLS for writes.
drop policy if exists "inbox_scan_log read" on inbox_scan_log;
create policy "inbox_scan_log read"
  on inbox_scan_log for select
  using (true);
