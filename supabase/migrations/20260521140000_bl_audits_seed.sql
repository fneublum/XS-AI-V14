-- Seed Document Audit menu with a representative variety of rows so
-- the UI has something to render before Hermes starts feeding live
-- audits in. Safe to re-run: every row uses `on conflict do nothing`
-- so production rows from Hermes are never overwritten.

insert into bl_audits (
  bl_number, deal_name, company, status, audited_at,
  hold_risk_count, warn_count, correction_carrier,
  correction_authorized, correction_dismissed, issues_json
) values
  -- The reference example from the brief § 9
  ('KE1121', 'EC4 - BEATRIZ - CI 3399', 'EC4', 'red',
   '2026-05-22T00:14:04.926Z'::timestamptz, 1, 3, 'KappaLog',
   false, false,
   '[
      {"severity":"red","field":"hs_code","ci":"5202.9100","pl":"5202.9100","bl":null,"note":"BL missing HS code — required for SISCOMEX. Carrier must add before final issue."},
      {"severity":"yellow","field":"ci_bl_date_gap","ci":"2026-04-29","pl":null,"bl":"2026-05-19","note":"20-day gap between CI and BL issue date. Normal for post-shipment BL; no action required."},
      {"severity":"yellow","field":"net_weight","ci":"50817.73 kg","pl":null,"bl":null,"note":"Net weight not extractable from BL; manual confirmation needed."},
      {"severity":"yellow","field":"incoterm","ci":"EXW","pl":null,"bl":null,"note":"Incoterm not visible on the BL — verify with carrier."}
    ]'::jsonb),

  -- 2 hold-risk issues, multiple containers
  ('HNCGL260020', 'EC4 - DALIECO - CI 014324', 'EC4', 'red',
   '2026-05-21T18:42:11Z'::timestamptz, 2, 1, 'CMA CGM',
   false, false,
   '[
      {"severity":"red","field":"container_number","ci":null,"pl":"CMAU7794910","bl":"CMAU7794911","note":"BL container number differs by 1 digit from PL. Likely typo."},
      {"severity":"red","field":"net_weight","ci":"34625.00 kg","pl":"34625.00 kg","bl":"36625.00 kg","note":"BL net weight is 2000 kg higher than CI/PL."},
      {"severity":"yellow","field":"pol","ci":"Charleston","pl":"Charleston","bl":"CHARLESTON, SC","note":"Same port, slight formatting difference."}
    ]'::jsonb),

  -- Passing audit (green)
  ('MSC0098123', 'XSOLUTION - PATAMUTE - CI 8055', 'XSOLUTION', 'green',
   '2026-05-21T14:05:00Z'::timestamptz, 0, 0, null,
   false, false, '[]'::jsonb),

  -- Currently running
  ('NAM8503707', 'EC4 - FORT FLEX - CI 3404', 'EC4', 'pending',
   '2026-05-22T11:02:00Z'::timestamptz, 0, 0, null,
   false, false, '[]'::jsonb),

  -- Pre-flight failed (no matching booking / CI)
  ('UP8-DRAFT-001', 'UP8 - GREEN IND - CI pending', 'UP8', 'broken_linkage',
   '2026-05-22T08:30:00Z'::timestamptz, 0, 0, null,
   false, false,
   '[{"severity":"red","field":"linkage","ci":null,"pl":null,"bl":"UP8-DRAFT-001","note":"BL has no matching booking or commercial invoice on file. Hermes cannot audit until linkage is provided."}]'::jsonb),

  -- Was red, carrier replied, resolved
  ('CDM0181239', 'EC4 - DALIECO - CI 014286', 'EC4', 'resolved',
   '2026-05-19T16:00:00Z'::timestamptz, 0, 0, 'Hapag-Lloyd',
   true, false, '[]'::jsonb)
on conflict (bl_number) do nothing;

-- Mark a couple of fields the simple values list above can't set in
-- one statement (resolved_at + correction_email_sent_at + last_carrier_reply_at).
update bl_audits set
  correction_email_sent_at = '2026-05-18T10:30:00Z'::timestamptz,
  last_carrier_reply_at    = '2026-05-19T15:00:00Z'::timestamptz,
  resolved_at              = '2026-05-19T16:00:00Z'::timestamptz
where bl_number = 'CDM0181239' and resolved_at is null;
