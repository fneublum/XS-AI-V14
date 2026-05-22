-- Drop the unused inbox_scan_log table.
--
-- Introduced earlier today by 20260518100000_inbox_scan_log.sql to back
-- a server-side Edge Function that polled the mailbox every 30 min via
-- pg_cron. We abandoned the server-side path — the browser scan
-- already does OCR + auto-save + dashboard notification, and the
-- manual OAuth bootstrap to populate the refresh token wasn't worth
-- the operational cost. No data was ever written here.

drop policy if exists "inbox_scan_log read" on inbox_scan_log;
drop index if exists inbox_scan_log_dedup_idx;
drop index if exists inbox_scan_log_received_idx;
drop index if exists inbox_scan_log_status_idx;
drop table if exists inbox_scan_log;
