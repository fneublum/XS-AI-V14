# Runbook · Onboard a new customer

**Owner:** Felipe (sales-ops) · **Frequency:** As needed, ~1–4×/month
**Last verified:** 2026-05-26 against V14 v14.40

## Purpose

Get a new buyer fully usable inside V14 the same day they're approved:
record in the `customers` table with correct payment terms, credit
limit, port-of-discharge defaults, broker info, and company-scope
visibility so every downstream module (RFQs, proformas, invoices,
bookings, AR) treats them correctly from the first transaction.

## When to use

- A new customer signs a first contract or is ready to receive a first
  proforma.
- An existing prospect graduates from "negotiation" to "transacting".
- You're consolidating a customer record that's been sitting in email
  threads / spreadsheets / Sal's head into the ERP.

Do NOT use this runbook for:
- Updating an existing customer's payment terms or credit limit — that
  has its own approval path.
- Onboarding a *cargo agent* (different role) — they go in the
  `cargo_agents` table via the Cargo Agents screen.

## Prerequisites

- [ ] V14 access, logged in to the company scope where the customer
      belongs (e.g. EC4 ENTERPRISES LLC). Wrong company = invisible
      record everywhere else.
- [ ] Decision made on **credit limit (USD)** and **payment terms**
      (e.g. NET30, CIA, 50/50). Don't guess — chase the answer before
      the record exists, otherwise the agents will treat the first
      RFQ on the wrong baseline.
- [ ] Customer's full legal name, tax ID, primary email + at least one
      backup email, phone, and shipping address.
- [ ] Default **port of discharge (POD)** — most invoices and freight
      quotes pre-fill from this.
- [ ] Broker name + email if any.

## Steps

### 1. Open the Customers screen

Sidebar → **System → Data → Customers** (or `?v2=1` route id
`customers`). The list view loads from Supabase table `customers`
scoped to the current company.

**Expected:** the table renders; the **+ New customer** button is
visible top-right.

**If it fails:** "control-plane unreachable" banner means a different
problem and is not this runbook. A blank table usually means the
company scope changed — check the top-bar company switcher.

### 2. Open the create drawer

Click **+ New customer** (`v2/routes/CustomersV2.tsx:120`). The
**CustomerDrawer** slides in from the right
(`v2/components/CustomerDrawer.tsx`).

### 3. Fill the required fields

| Field | Notes |
|---|---|
| `name` | Legal company name. Used on invoices and proformas verbatim. |
| `taxId` | Country-format tax id. Required for invoice compliance in BR/US. |
| `contactPerson` | Primary AP / commercial contact. |
| `email` | Primary inbox. Cite this when calling out who Lara should email. |
| `phone` | Include country code. |
| `city` / `state` / `country` | Used by Logan to suggest freight rates. |
| `pod` | Default port of discharge. Pre-fills new proformas. |
| `creditLimit` | USD. Matt and Sal both gate proposals against this. |
| `paymentTerms` | e.g. `NET30`, `CIA`, `50/50`. |
| `status` | `ACTIVE` for go-live, `PROSPECT` if not yet transacting. |

Optional but recommended: `nickname` (used in agent chat — short is
better), `email2` / `email3` (CC list for Lara's drafts),
`brokerName` / `brokerEmail`, `sharedWith` (array of other company
ids that can see this customer).

### 4. Save

Click **Save**. The insert goes through `useEntityMutations.ts:62` →
Supabase `.insert()` on the `customers` table; the auto-generated id
will be prefixed `CUST`.

**Expected:** toast confirms the save, drawer closes, the new row
appears at the top of the list.

**If it fails:** the toast surfaces the Supabase error. Most common:
duplicate `taxId` (DB unique constraint). Resolve before retrying —
don't suppress the validation.

### 5. (Optional) Set agent autonomy for this customer's first months

If you want the agents to be conservative on a brand-new account,
open **Agents → Console → Autonomy** and tighten any tiers that
might fire on first transactions. For new customers, sensible
defaults:

- `ar.send_followup` → `QUEUE_HIGH` until first invoice clears
- `rfq.send_proforma` → `QUEUE_HIGH` until you've sent the first one
  manually and confirmed pricing
- `shipment.notify_eta_change` → `AUTO` is fine (informational only)

The `allowed_customer_ids` constraint isn't exposed in the Autonomy
UI yet — if you want per-customer scoping, set it in the
control-plane `thresholds` table directly until that UI lands.

### 6. (Optional) Sanity-check via Gem

In **Dashboard → Team chat**, ask:

```
@gem list all customers
```

The new record should appear in the response. This confirms the
control-plane sees the same Supabase row V14 just wrote, which is
the round-trip every agent depends on.

## Verification

- [ ] New row visible in **Customers** list, scoped to the right
      company.
- [ ] `@gem list all customers` shows the new entry.
- [ ] Try creating a draft proforma for this customer (Sales Orders →
      New) — POD and payment terms pre-fill from the customer record.

## Edge cases

- **Same legal name, different country / tax id**: create separately;
  don't merge. Invoicing rules differ.
- **Customer visible to multiple of your companies (EC4 + XSolution
  + UP8)**: use `sharedWith` array — don't create three records.
- **You don't have the credit limit yet**: set `status: PROSPECT` and
  `creditLimit: 0`. Don't make one up — the agents will gate against
  whatever's there, and a wrong number is worse than zero.

## Current automation gaps

These would let an agent do step 3-4 directly. They aren't wired today
and are flagged here so it's obvious when they should be:

- No `customer.create` capability exists in the XS-agentic
  capability registry. Gem only has `list_customers` (read), not a
  write tool — verified in
  `/Users/felipeneublum/Desktop/XS-agentic/services/control-plane/src/lib/erp-tools.mjs`.
- `suggestions.mjs` advertises the prompt
  *"@gem add a new customer 'ACME LTDA' …"* but the tool path
  doesn't exist, so Gem will fall back to `propose_action` (generic)
  and leave the work in your queue rather than creating the row.
  Either wire a real `customer.create` tool or remove that
  suggestion to avoid the false promise.

## Rollback

Within the same session you can delete the row from the **Customers**
list (row action → Delete). After invoices or proformas reference it,
deletion is no longer safe — change `status: ARCHIVED` instead.
Hard-deleting a referenced customer will leave orphan rows in
`sales_orders` / `invoices` / `bookings`.

## Escalation

| Situation | Contact | Method |
|---|---|---|
| Supabase write fails with permission error | Felipe (RLS check) | Look at the policy on `customers` for the user's role. |
| Tax id triggers compliance flag | Ana Paula (Beth's principal) | Confirm registration status before activating. |
| Credit-limit decision blocked | The customer's account exec | No automation. Get the answer first; don't ship a placeholder. |
