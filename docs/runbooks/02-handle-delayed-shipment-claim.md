# Runbook · Handle a delayed-shipment claim

**Owner:** Felipe (with Logan agent) · **Frequency:** As needed, ~2–6×/month
**Last verified:** 2026-05-26 against V14 v14.40

## Purpose

When a container's ETA has slipped (or the customer is about to
notice), keep the customer informed proactively, decide whether a
credit / concession is warranted, and record the whole thread so the
next person to touch this account isn't blindsided.

## When to use

- A booking's tracked ETA (via ShipsGo) has shifted by more than 3
  business days.
- A customer pings asking "where's my container?" and you suspect
  the answer isn't "on the original ETA".
- Logan flags a shipment in the **Console → Stream** tab via the
  `shipment.notify_eta_change` capability.

Do NOT use this runbook for:
- Cargo damage or short-shipment claims — different (insurance) flow.
- Port-strike force-majeure announcements — broader comms, run as a
  one-off briefing, not per-customer.

## Prerequisites

- [ ] V14 access scoped to the right company.
- [ ] ShipsGo integration healthy — check `LogisticsFollowUpV2`
      loads container telemetry without errors.
- [ ] You can reach the customer (email + phone on the customer
      record).
- [ ] HERMES Mac mini is online if you want Lara to draft the
      customer email — check the team-chat connection status in
      Dashboard.

## Steps

### 1. Identify the affected booking

Sidebar → **Logistics → Bookings** (route `bookings`,
`v2/routes/BookingsV2.tsx`). Filter by the customer or paste the
booking number.

The relevant columns:

| Column | Header | What it tells you |
|---|---|---|
| `etd` | ETD | Original / current estimated departure. |
| `eta` | ETA | Original / current estimated arrival. |
| `cargoCutOff` | Cut off | Last day cargo accepted by terminal. |
| `status` | Status | `AVAILABLE` / `LOADED` / `DEPARTED` / `SHIPPED` / `CANCELLED`. |

There is no explicit `CLAIM` or `DELAYED` status today
(`v2/routes/BookingsV2.tsx:100-154`). A delay shows up as a moved
ETA + ShipsGo telemetry diverging from the original schedule.

### 2. Confirm the delay magnitude

Open **Logistics → Logistics Follow Up** (`LogisticsFollowUpV2.tsx`)
to see ShipsGo's most recent vessel position + projected ETA.

Compare:

- The original ETA (in the booking row).
- The current ETA from ShipsGo.
- Today's date.

A "delay" worth acting on usually means **current ETA - original
ETA ≥ 3 business days** AND the new ETA is in the future. If the
container has already discharged at a delayed port, the runbook
shifts to a *post-arrival* posture — same idea, different tone in
the customer email.

### 3. Check if Logan already raised it

Open **Agents → Console → Stream**. Scan the **Awaiting your
decision** card stack for the capability
`shipment.notify_eta_change`. If Logan already proposed a
notification for this booking, the payload will contain `old_eta`,
`new_eta`, and the customer id (see
`v2/routes/agents/_shared.tsx` SUMMARY_TEMPLATES for the
human-readable summary).

**If a proposal exists:**

1. Click **Show draft preview** to read what Logan would send.
2. If the draft is good as-is, click **Approve**. That POSTs to
   `/actions/{id}/decide` and HERMES queues the email.
3. If the draft needs edits, **Deny** it and write the email
   yourself (step 4 below). Don't approve a draft you'd want to
   rewrite — the audit trail will show "felipe approved" against
   prose you didn't actually like.

**If no proposal exists:** Logan hasn't seen it yet. Either wait
for the next polling pass (every 3s the Stream view refreshes), or
just do it manually (step 4).

### 4. Notify the customer (manual path, today's default)

Until `shipment.notify_eta_change` lands a real auto-execute,
notification is human-driven. Recommended:

- Email primary + secondary contacts on the customer record.
- Include: booking number, original ETA, new ETA, the reason
  (port congestion / mechanical / weather / re-routing), and what
  you're doing about it.
- For relationship-sensitive customers, also send a short WhatsApp
  via the HERMES bridge (number 9047882483) — keep the long
  details in the email.

### 5. Update the booking record

Edit the booking row in `BookingsV2.tsx` so `eta` reflects the new
forecast. Don't backfill `etd` unless the departure itself slipped.
The next time Logan or anyone reads `/bookings`, they see the
current truth.

### 6. Decide on a concession (if asked)

There's no automation for credit notes yet. If a customer asks for
compensation:

- A **fixed fee discount** on next freight charge: log a note on
  the booking and a TODO on yourself; apply manually at the next
  invoice.
- A **free demurrage extension** (when applicable): you decide,
  Logan tracks via the destination port partner — no V14 record
  for this today.
- A **full or partial credit note**: out of scope here — has its
  own runbook (planned). Document the promise on the booking row
  in the meantime.

### 7. Close the loop

Update the customer once the container is moving on its new ETA
(or has discharged). Same channel as the original notification.
Brief is better than silent.

## Verification

- [ ] The booking row's ETA matches what ShipsGo currently shows.
- [ ] An email or WhatsApp went out, and you can point to it from
      this booking when asked later this quarter.
- [ ] If a concession was agreed, there's a note on the booking that
      the AR person will see when invoicing.
- [ ] If Logan had a proposal, it's now `APPROVED` /
      `MANUALLY_EXECUTED` / `DENIED` in the action queue — not
      sitting at `AWAITING_APPROVAL`.

## Edge cases

- **ETA improves** (rare but happens — vessel skips a port): same
  flow, but the email is good news. Don't suppress the comms —
  customers trust you more after the second "we'll keep you posted"
  than after the first.
- **Two bookings for the same customer both delayed**: send one
  combined email. Don't make them parse two separate threads.
- **Customer pings before you've identified it**: don't reply
  empty-handed; run steps 1-2 first, then reply with specifics.
- **ShipsGo telemetry is stale**: trust the carrier's website
  over ShipsGo for the headline date and note in the email that
  "carrier confirmed" — sets expectation correctly.

## Current automation gaps

- `shipment.notify_eta_change` exists in the capability registry
  (`erp-tools.mjs:449` references it in the `propose_action`
  examples) but the auto-execute path through HERMES isn't fully
  wired — proposals show up in the Stream tab and need manual
  approval, then manual send.
- No `delivery.log_customer_comm` table or capability exists, so
  there's no V14 record of which customer was emailed when about
  a delay. Today the proof-of-comms lives in Outlook only. If
  this becomes important for SLAs, add a `shipment_communications`
  table + a Logan tool.
- Logan's tool list is read-only + `propose_action` + `ask_hermes`
  (`erp-tools.mjs:507`). He cannot edit the booking ETA himself
  — humans only.

## Rollback

If you sent the wrong notification (wrong booking, wrong customer,
wrong dates):

1. Send a corrective email *immediately* from the same thread —
   don't hope nobody noticed.
2. Revert the ETA on the booking row.
3. In **Audit** tab (Console), filter `action = manually_executed`
   and `actor = felipe` to find the wrong record and confirm what
   was sent.

## Escalation

| Situation | Contact | Method |
|---|---|---|
| Delay caused by carrier failure (vessel breakdown, blank sailing) | Logistics manager + the carrier rep | Phone first, email after. The carrier owes you a written reason for the customer file. |
| Customer threatens to cancel | Account exec (or Felipe direct) | Same-day call. Don't email this one. |
| Concession > $5k credit value | Felipe explicit approval | Don't pre-commit on the customer call. "Let me confirm" is fine. |
