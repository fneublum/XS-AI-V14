# V14 Runbooks

Operational playbooks for recurring tasks across the V14 ERP and the
XS-agentic control-plane that runs on the Mac mini.

Each runbook is grounded in real V14 screens, Supabase tables, and
control-plane endpoints — no invented capabilities. Where a step would
ideally be agent-driven but the capability isn't wired yet, that gap is
called out explicitly in the runbook's "Current automation gaps"
section so it's easy to find when capacity opens up.

## Index

| # | Runbook | When you reach for it |
|---|---|---|
| 1 | [Onboard a new customer](01-onboard-new-customer.md) | A new buyer signs up — get them into the ERP with payment terms, credit, brokers, and team visibility set correctly. |
| 2 | [Handle a delayed-shipment claim](02-handle-delayed-shipment-claim.md) | A container is past its ETA and the customer is asking what's going on (or about to). |
| 3 | [Override or revoke an agent decision](03-override-agent-decision.md) | An agent proposed (or auto-executed) something you want to stop, undo, or de-authorise. |

## Conventions

- **Felipe** = the human approver (only one in the loop today).
- **Agents** = Max (manager), Lara (assistant), Matt (finance, persona only),
  Logan (shipments), Sal (sales, persona only), Beth (Ana Paula's PA),
  Gem (ERP data), Hermes (Mac mini bridge).
- **Control-plane** = `xs-agentic` service on the Mac mini under launchd
  (`ai.xs-agentic.control-plane`), exposed via Tailscale Funnel at
  `https://maxs-mac-mini.tailb21dd3.ts.net` and proxied through the
  Supabase Edge Function `agentic-proxy` for prod traffic.
- **Action queue** = the `action_queue` table inside the control-plane's
  SQLite DB. Statuses: `PROPOSED`, `AWAITING_APPROVAL`, `APPROVED`,
  `AUTO_APPROVED`, `EXECUTED`, `DENIED`, `EXPIRED`, `FAILED`.
- **Tier** = trust level for an (agent, capability) pair: `AUTO`,
  `QUEUE_LOW`, `QUEUE_HIGH`, `NEVER_AUTO`. Set in **Agents → Console
  → Autonomy** tab.

## Last verified

2026-05-26 against V14 v14.40 and control-plane commit on Mac mini at
`/Users/maxsmart/xs-agentic`. Re-verify any "Current automation gaps"
section if it's been more than a quarter since these were written —
the agentic platform changes fast.
