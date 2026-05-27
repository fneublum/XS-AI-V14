# Runbook · Override or revoke an agent decision

**Owner:** Felipe (only human approver in the loop today) · **Frequency:** As needed
**Last verified:** 2026-05-26 against V14 v14.40

## Purpose

Stop an agent action mid-flight, undo one that's already been
auto-approved or executed, and (when the failure is systemic)
demote the agent's trust tier so the same mistake doesn't
re-occur. The objective is **fast containment + clean audit
trail**, not blame.

## When to use

- A proposed action is wrong — don't approve, cancel it.
- An *already auto-approved* action is about to execute and
  shouldn't.
- An auto-approved action *did* execute and the result is wrong
  (customer-facing email sent, money proposed, etc.) — recovery
  + threshold tightening.
- A capability is firing too often or against the wrong cohort —
  permanent revocation.

Do NOT use this runbook for:
- Routine "I don't want this one" denials — that's just the
  **Deny** button in the Stream tab, no runbook needed.
- HERMES-only actions that bypassed the action queue (WhatsApp
  side-channel) — those leave no `action_queue` row to override.
  Different recovery path.

## Prerequisites

- [ ] V14 access; logged in as the user the control-plane knows as
      `felipe` (the Edge Function hardcodes `x-actor: felipe`, so
      whoever uses the dashboard is recorded as felipe in the
      audit log regardless).
- [ ] Control-plane reachable — Dashboard team chat status reads
      `polling · N messages`. If not, see the dashboard's
      "control-plane unreachable" banner; without the
      control-plane, none of the override endpoints below work.
- [ ] You know the **action id** OR enough context (agent +
      capability + customer) to find it in the Stream / Audit
      tabs.

## Decision tree

```
Is the action still PROPOSED or AWAITING_APPROVAL?
├── YES → Step 1 (Cancel or Deny in Stream tab)
└── NO  → Is it APPROVED / AUTO_APPROVED but not yet executed?
         ├── YES → Step 2 (Cancel + verify HERMES didn't run it)
         └── NO  → It already executed.
                   ├── Recoverable side effect? → Step 3 (Recover + log)
                   └── Pattern of mistakes?    → Step 4 (Tighten threshold)
```

## Steps

### Step 1 — Stop a not-yet-decided action

Sidebar → **Agents → Console → Stream**. Find the card in the
**Awaiting your decision** stack.

Three buttons on each pending card
(`v2/routes/agents/StreamView.tsx:225-232`):

| Button | Endpoint | Effect |
|---|---|---|
| **Approve** | `POST /actions/{id}/decide` (body `{ decision: 'APPROVED' }`) | Authorises HERMES to execute. Don't click if you're overriding. |
| **Deny** | `POST /actions/{id}/decide` (body `{ decision: 'DENIED' }`) | Records as `DENIED`. Use when the action was a bad idea on its merits. |
| **Cancel** | `POST /actions/{id}/cancel` | Records as `EXPIRED`. Use when the action is moot (e.g. customer already paid the invoice the agent wanted to chase). |

Pick **Deny** vs **Cancel** based on intent — the audit trail
remembers which one you used. Deny = "no", Cancel = "not anymore".

**Expected:** the card disappears from the Awaiting stack within
3 seconds (the Stream view polls `/actions?limit=200` every 3s).

**If it doesn't disappear:** the API call failed. Check the
toast for an error; the most common cause is a stale
`action_queue` id (already decided by someone else).

### Step 2 — Stop an action that's already APPROVED but not executed

Once decided, the card moves to **Recent activity** with status
`APPROVED` or `AUTO_APPROVED`. HERMES picks these up on its
execution loop; the gap between approval and execution can be
seconds (email send) to minutes (longer agent tool runs).

To stop it before HERMES runs it:

1. Same `POST /actions/{id}/cancel` endpoint as step 1 — the
   action_queue accepts cancel on any pre-execution state. The
   row flips to `EXPIRED`.
2. Verify HERMES didn't already start: in **Audit** tab, filter
   `action = executed` for that action id. If no row, you caught
   it.

The **Cancel** button isn't visible on `APPROVED` rows in the
Recent activity list (the UI only renders the three pending-card
buttons on `AWAITING_APPROVAL` rows). Today you call the cancel
endpoint directly with curl / Postman against the control-plane,
or — fastest path — open the Console **Stream** view, filter to
`all`, and the cancel action is still available on rows the
backend hasn't flipped to `EXECUTED` yet.

If you find yourself doing this often, that's a signal the
"Recent activity" list should grow a cancel button on
pre-execution rows. Flag it next time you do a UI sweep.

### Step 3 — Recover from an action that already EXECUTED

Once `EXECUTED`, the side effect is real (email sent, customer
charged, etc.). Override = recovery + record-keeping, not
"undo".

1. **Stop the bleeding first.** If the agent sent the wrong
   email, send a corrective one from the same thread before you
   touch the action queue. Customers care about that more than
   the audit trail.

2. **Find the action in the Audit tab.** Filter
   `action = executed` + the relevant `actor`. The detail JSON
   on each audit row has the payload + the HERMES result.

3. **Mark the recovery** — there isn't a "this was wrong"
   button. Use the **manual** action type: POST a row to the
   control-plane's audit endpoint via the dashboard's
   `propose_action` (or directly) with the same `subject` and
   a `detail.note` explaining what happened. This gives the
   next person who reads the audit a paper trail.

4. **If the executed action was a payment or invoice
   movement**: open the corresponding V14 record (Invoices →
   Receivables / Payables) and reverse there as well. Audit log
   alone isn't enough — the financial state must match.

5. Continue to **Step 4** to decide whether to tighten the
   threshold.

### Step 4 — Tighten or revoke the capability

If the executed action revealed a systemic problem (wrong
threshold, wrong reasoning), prevent recurrence:

1. Sidebar → **Agents → Console → Autonomy** tab.
2. Find the agent's card (Max / Lara / Logan / etc.); each
   tile is one `(agent, capability)` pair.
3. Click **Change** on the offending tile.
4. Pick a tighter tier:
   - **AUTO → QUEUE_LOW**: still automatic but with limits.
     Set `max_amount_usd` or `min_customer_age_days` in the
     editor.
   - **QUEUE_LOW → QUEUE_HIGH**: always ask, no exceptions.
   - **QUEUE_HIGH → NEVER_AUTO**: the agent stops proposing
     entirely. Felipe drives it manually.
5. Click **Save**. The change writes via
   `POST /thresholds` and logs an audit entry with action
   `threshold.upsert`.

To revoke a capability entirely (the agent loses access to
*propose* it at all), use the **Revoke permission** button
inside the tile editor — endpoint
`DELETE /thresholds/{agent_id}/{capability_id}`. The audit log
records `threshold.deleted`.

**Important — destructive capabilities can't sit at AUTO.** The
Autonomy editor disables the AUTO radio for any capability
flagged `destructive: true` in the registry
(`v2/routes/agents/AutonomyView.tsx`). If you're tempted to
override that, fix it in the capability registry instead
(Capabilities tab → toggle destructive) so the rule is visible
to anyone else who reviews thresholds.

## Verification

- [ ] The action_queue row shows the expected terminal status:
      `DENIED` (step 1), `EXPIRED` (steps 1-2), or — if it
      executed — an audit `manual` entry from you noting the
      override.
- [ ] **Audit** tab filtered on the relevant `actor` shows the
      override event(s) you expect — no surprises.
- [ ] If you tightened a threshold, the **Autonomy** tile reflects
      the new tier + limits; the next time that capability fires,
      it routes correctly (verify by waiting for the next real
      proposal or by watching `action_queue` after a manual
      trigger).
- [ ] If a customer was affected, the corrective comm has gone
      out and is documented somewhere a future you will find.

## Edge cases

- **Two operators decided the same action simultaneously**
  (won't happen with felipe-only, but worth knowing): the second
  decide call returns an error; the audit shows whichever
  landed first.
- **The agent re-proposes the same action after you denied it**:
  expected behaviour — Deny isn't permanent. If you don't want
  it back, tighten the threshold (step 4) rather than playing
  whack-a-mole.
- **The action is from `system` (cron) not a named agent**:
  same override paths work; the audit row will show
  `actor: system`. Threshold tightening doesn't apply (no per-
  agent tile) — fix the cron in the HERMES launchd plist or the
  control-plane's Crons tab.

## Current automation gaps

- No bulk-cancel — if you need to kill 20 pending actions
  (e.g. an agent went haywire), you click each one. A "cancel
  all by agent" or "cancel all by capability" button would help.
- No "this was wrong, retrain" feedback loop — overrides go to
  the audit log but aren't fed back to the agent's prompt. The
  same agent will propose the same thing tomorrow unless you
  tighten the threshold or change the underlying logic on the
  Mac mini.
- "Cancel" isn't surfaced on `APPROVED` rows in the Recent
  activity list — only on `AWAITING_APPROVAL` cards. Inconsistent;
  fix when you next touch the Stream view.

## Rollback

Overrides don't have a rollback — by design, you can't un-deny
or un-cancel. If you cancelled the wrong action, the agent will
typically re-propose it (Deny isn't sticky), or you can prompt
the agent directly in **Dashboard → Team chat** to re-do the
work.

For threshold changes: just edit the tile again in the Autonomy
tab and set the previous tier. The audit log keeps both
`threshold.upsert` events.

## Escalation

| Situation | Contact | Method |
|---|---|---|
| HERMES executed a money-moving action you can't undo (wire sent, etc.) | Bank operations + Felipe direct | Phone the bank in the same hour. Document timeline in the audit log. |
| Agent is rapid-firing wrong proposals and you can't keep up | Pause the agent on the Mac mini (`launchctl unload ai.xs-agentic.control-plane` then restart cleanly) | Last-resort kill switch. Notify the team after. |
| Audit reveals a capability fired against a wrong customer cohort | Yourself + log it | Tighten threshold first, investigate the agent's reasoning second — sequence matters. |
