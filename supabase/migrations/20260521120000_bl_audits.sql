-- Hermes BL audit results table.
--
-- The Hermes Agent (running on Felipe's Mac mini) writes one row per
-- draft Bill of Lading it receives and audits. XS-AI's Document Audit
-- menu reads from this table and writes back the user's decision
-- (authorize / dismiss / edited correction body).
--
-- See /Users/felipeneublum/Desktop/XS-AI-Document-Audit-Menu-Briefing.md
-- § 3 for the source-of-truth schema spec.

create table if not exists bl_audits (
  bl_number                   text primary key,           -- e.g. "KE1121", "HNCGL260020"
  deal_name                   text,                       -- "BEATRIZ — CI 3399"
  company                     text,                       -- 'EC4' | 'XSOLUTION' | 'UP8'

  status                      text not null,
    -- 'green'          = passed audit
    -- 'red'            = hold-risk issues found, correction draft pending
    -- 'pending'        = audit currently running
    -- 'broken_linkage' = pre-flight failed (BL not linked to Booking/Container/CI)
    -- 'resolved'       = was red, fixed, now green after carrier sent revised BL

  audited_at                  timestamptz not null,
  hold_risk_count             integer default 0,          -- count of red issues
  warn_count                  integer default 0,          -- count of yellow warnings
  issues_json                 jsonb,
    -- array of {severity, field, ci, pl, bl, note}

  correction_email_draft_id   text,                       -- Outlook draft message id
  correction_email_sent_at    timestamptz,
  correction_carrier          text,                       -- "KappaLog" / "MSC" / etc.

  correction_authorized       boolean default false,
    -- Hermes polls every 60s; when true, sends the correction email.

  correction_dismissed        boolean default false,
    -- User accepts the BL as-is despite issues. Hermes won't send.

  correction_edit_body        text,
    -- If user clicked Edit, the revised body to send instead of the draft.

  last_carrier_reply_at       timestamptz,
  resolved_at                 timestamptz,

  notes                       text,                       -- free-text user notes
  report_log_path             text                        -- pointer to Hermes log for debugging
);

create index if not exists idx_bl_audits_status     on bl_audits (status);
create index if not exists idx_bl_audits_audited_at on bl_audits (audited_at desc);
create index if not exists idx_bl_audits_company    on bl_audits (company);

-- RLS: authenticated users in XS-AI can read everything and write the
-- decision columns (authorize / dismiss / edited body / notes). Hermes
-- writes via the service-role key, bypassing RLS, so it can insert /
-- upsert without an explicit policy.
alter table bl_audits enable row level security;

drop policy if exists bl_audits_select on bl_audits;
create policy bl_audits_select on bl_audits
  for select to authenticated using (true);

drop policy if exists bl_audits_update_decisions on bl_audits;
create policy bl_audits_update_decisions on bl_audits
  for update to authenticated
  using (true)
  with check (true);
