# XS-AI Business Platform — Full System Manual for AI Agents

> **Purpose.** This file is the canonical reference for an AI agent that operates XS-AI on EC4 Enterprises' behalf. It is **self-contained** — no external links are required to do useful work. If anything contradicts what the live system does, the live system wins; tell the user so we can update this file.
>
> **How to use.** Read top-to-bottom once at the start of a session. Re-consult the **Database reference** and **Workflow recipes** as needed. When you don't recognise a screen, find the matching section here first; if it isn't documented, open the relevant drawer to see what fields the row carries.

---

## 1. System overview

XS-AI is a multi-tenant trading ERP built for EC4 Enterprises LLC and its affiliated companies (UP8 Trade Corporation, XSolution LLC, GENRYO INTERNATIONAL, TSI SERVICES). The business is **plastics + cotton import/export** — EC4 buys grades from US suppliers, consolidates into containers, sells FCA/FOB/CFR/CIF mostly to Brazilian buyers.

### Architecture

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 19 + Vite, TypeScript, Tailwind, Radix UI primitives | Two coexisting UIs: **v1** (legacy, lighter theme) and **v2** (newer dark theme). Toggle via `?v2=1` / `?v2=0` URL param. |
| Backend | Supabase (PostgreSQL + Edge Functions + Auth proxy) | Anon key in client bundle; service role in Edge Functions only. |
| Hosting | Google Cloud Run — service `xs-erp` in `us-central1` | Public URL `https://xs-erp-489872954398.us-central1.run.app`. |
| Build | Cloud Build (`cloudbuild.yaml`) → GCR image → `gcloud run deploy` | Anon key passed as substitution at build time. |
| AI | Google Gemini (extraction, chat), Anthropic Claude (Sales Agent) | Always through Edge Function proxies, never direct from client. |
| QuickBooks | OAuth refresh tokens per company in `qb_tokens` | `qb-sync` Edge Function. Tenant-scoped. |
| Dropbox | Refresh token in `system_settings.dropbox_credentials` | `dropbox-upload` Edge Function. Root folder `/EC4 COMEC - 3. SHIPPED WITH BL`. |
| WhatsApp | Twilio + Meta Cloud API | `whatsapp-webhook` (inbound, HMAC-signed), `whatsapp-send`, `twilio-send`, `twilio-webhook`. |
| Email | Outlook (MSAL) or Google Identity, user-side OAuth | Tokens in browser `localStorage`. |

### Two UIs

- **v2 is the modern, preferred UI.** Most new features land here.
- **v1 is still reachable** for screens that haven't been ported (Brain Diagnostics, some Data sub-screens, parts of PL Invoice Engine). When v2 hands off to v1, it writes the target into `sessionStorage` (`xs_pending_v1_nav` / `xs_pending_delivery_docs`) and reloads with `?v2=0`.
- Default routes you'll work with are listed under **Navigation map** below. Always prefer v2 if both exist.

---

## 2. Tenant & user model

### Companies (`companies` table)

Top-level tenant. Examples in production:
- `COMP1764818591026` EC4 ENTERPRISES LLC (default)
- `UP8 TRADE CORPORATION`
- `XSOLUTION LLC`
- `GENRYO INTERNATIONAL`
- `TSI SERVICES`

Every tenant-scoped table has a `companyId` column (camelCase). A few legacy tables use `company_id` (snake_case) instead — when a query fails with "column does not exist", check both casings.

### Users (`users` table, plus role + module gates)

```
users
├── id            text PK          e.g. "USR-mp2y2cu8-F44T" or "U1766185306346"
├── name          text             display name
├── username      text             login id (case-insensitive on login)
├── password      text             ★ plain text today (TODO: hash)
├── role          text             see roles below
├── email         text
├── phone         text
├── allowed_company_ids  text[]    tenants this user can act on
├── allowed_modules      text[]    coarse-grained gates (see Modules section)
├── linked_entity_id     text      CSV of cargo_agents.id for Cargo Agent users
└── canManageInventory   boolean
```

### Roles

`OWNER`, `ADMIN`, `MANAGER`, `FINANCE`, `USER`, `Cargo Agent`, `Sales Agent`.

- `OWNER` and `ADMIN` bypass module gates; they see everything.
- `Cargo Agent` is a **scoped role** — they get a special sidebar (`Freight Quotes` + `Bookings` only, scoped to the `cargo_agents` rows linked via `linked_entity_id`). Don't break this scope.
- `Sales Agent` is currently a label — gating is module-based.

### Modules (`allowed_modules`)

Coarse-grained access gates. Stored as `text[]`. The v1 sidebar/Dock enforces these; v2 currently doesn't enforce them at the top level (every signed-in non-CargoAgent sees the full sidebar), but stored values will be honoured when v2 enforces.

Current canonical set (see `v2/routes/AdminUsersV2.tsx`):
```
DASHBOARD, CONNECTIONS, AI_SALES_AGENT,
BUY (Purchase & cost), COST_PROFIT_AI (Order-Sale), PAPERWORK,
SALES_HUB, SALES_FORCE, COMMISSIONS,
LOGISTICS, FINANCE,
DATA, AI_UPLOAD, SETTINGS,
CUSTOMER_PORTAL, CARGO_AGENT_PORTAL
```

---

## 3. Authentication flow

1. User submits `username` + `password` on **LoginV2** (`pages/Login.tsx` for v1).
2. Client POSTs `{ username, password }` to Edge Function `auth-issue`.
3. Function looks up `users.username` with **case-insensitive `ilike`** (escaped `%`/`_`).
4. Compares `users.password` **case-sensitive, exact**, plaintext. **No hashing.**
5. On match, mints an HS256 JWT (signed with `APP_JWT_SIGNING_SECRET`) with claims:
   ```
   { sub: users.id, role: "authenticated", aud: "authenticated",
     iat, exp (12h),
     app_metadata: { allowed_company_ids, role, provider: "xs-users" },
     user_metadata: { username } }
   ```
6. Frontend stores JWT in `sessionStorage` (`xs_edge_auth_token`).
7. Every Edge Function call goes through `services/edgeAuth.ts → invokeEdgeFunction(name, opts)`, which attaches `Authorization: Bearer <jwt>` automatically.

### Security caveats

- Passwords are plain text. A read of `users` exposes them. The `users` table is currently readable by anon (no RLS). **TODO: migrate to hashed passwords + Supabase Auth.**
- JWT secret rotation is deferred. When it rotates, all sessions invalidate and Edge Function deployment must be aligned.

---

## 4. Navigation map (every entry in the v2 sidebar)

### Workspace
- **Dashboard** (`dashboard`) — KPIs, pendency cards, AI chat panel.
- **Connections** (`connections-tabs`) — Email / WhatsApp / Briefing tabs.
- **AI Sales Agent** (`ai-sales`) — Autonomous proposal drafter (Anthropic Claude).

### Trading
- **Purchase & cost** (`purchase-orders`) — Hub: Suppliers, Supplier Quotes, Inventory, Cost Calc.
- **Purchase Orders** (`purchase-orders-list`) — Formal PO documents.
- **Sales Orders (Proformas)** (`sales-orders`) — SOs with proforma PDFs.
- **Packing list & Invoice** (`pl-invoice`) — Legacy combined engine (PL + Invoice in one).
- **Invoice & docs** (`invoices`) — Modern v2 invoice list; **canonical entry point** for delivery docs and Save-to-Dropbox.
- **Trading Follow Up** (`trading-followup`) — Active shipment status board with ETA aging.

### Agent Sales (`role: 'Sales Agent'` flows)
- **Agent Sales Orders** (`sopici`) — SOs handled by external sales agents.
- **Agent Follow Up** (`agent-followup`).

### Logistics
- **Freight Quotes** (`freight-quotes`) — Quotes from cargo agents.
- **Bookings** (`bookings`) — Confirmed freight bookings (vessel/voyage, ETD/ETA).
- **Bill of Ladings** (`bol`) — Final BL records.

### Finance
- **Payables** (`payables`) — Supplier invoices (AP). QB sync writes Bills.
- **Receivables** (`receivables`) — Customer invoices (AR). QB sync writes Invoices.
- **Customer Balances** (`customer-balances`) — AR aging by customer.

### System (modals, not routes)
- **Data** menu → Banks, Cargo Agents, Carriers, Customers, Doc Viewer, Locations, Ports, Products, Suppliers, Doc OCR.
- **Settings** menu → Users, Companies, Database Config, Branding, Email Integration, Brain Diagnostics.

### Special role-scoped
- `Cargo Agent` users see only **Freight Quotes** + **Bookings**, scoped by `linked_entity_id`.

---

## 5. Module-by-module operator guide

### 5.1 Dashboard

Cards at top (pending items, ETA aging, balances). Right panel is the **AI chat** — accepts plain English. Examples:
- "show me bookings past ETA without a BL"
- "what invoices are over 30 days outstanding"

Behind the scenes, the chat calls Anthropic via `anthropic-proxy` with tools that hit the same Supabase queries the lists use.

### 5.2 Connections

Three tabs.

- **Email** — the v2 AI Inbox: connect Outlook (MSAL) or Gmail. Inbound emails with PDF attachments auto-extract and create draft Invoice / PL / SO rows.
- **WhatsApp** — Twilio-backed conversations and Meta Cloud API both supported. Inbound media triggers same AI extraction. The 24-hour Meta session window applies — you cannot send a fresh outbound to a number that hasn't messaged in.
- **Briefing** — daily briefing summary of new activity.

Account setup (Outlook / Gmail) lives under **Settings → Connections**.

### 5.3 AI Sales Agent

Autonomous proposal generator. Inputs:
- **Audience**: Sales Reps · Customers · Prospects
- **Recipient**: drops from the chosen list
- **Channel**: Email · WhatsApp
- **Intent** (one-line plain English) — e.g. "Introduce our Q3 LDPE grades at 5% below current FOB Santos."

Buttons:
- **Draft for review** → row written to `ai_sales_proposals` with `status='pending_approval'`. Appears in the queue panel.
- **Auto-send now** → drafts and dispatches in one shot. `status='sending'` then `'sent'` or `'failed'`.

Data flow: `services/aiSalesAgentService.ts` → Edge Function `anthropic-proxy` → Claude → response normalised → row inserted. The agent persona / signature comes from `ai_agent_identities` table (rows keyed by `companyId` + `role='sales'`).

### 5.4 Purchase & cost

Composite view backed by multiple tables:
- **Suppliers** (`suppliers`)
- **Supplier Quotes** (`supplier_quotes`)
- **Supplier Offers** (`supplier_offers`)
- **Inventory** (`inventory`, `inventory_logs`)
- **Cost Calculations** (`cost_calculations`)

Workflow: supplier offer → matched cost calc → drives the unit price that flows into Sales Orders.

### 5.5 Purchase Orders

Each row is a formal PO sent to a supplier.

Columns: PO #, Supplier, Order Date, Status, Items[]. Drawer has full editor.

Actions:
- **Email PO** — sends a branded PDF via [pages/PurchaseOrders.tsx](pages/PurchaseOrders.tsx). The HTML body escapes every dynamic field (post-XSS fix).
- **Status** — Draft → Sent → Acknowledged → Received → Closed.

### 5.6 Sales Orders (Proformas)

The drawer is the workhorse for the **sales side**. Fields:
- **Header**: Customer, Notify Party (free text or pulled from customer), Payment Terms, Incoterm (FOB/CFR/CIF/EXW/DAP/DDP/FCA/CPT/CIP/FAS), Delivery Method (PORT_TO_PORT etc.), Bank picker, POD/POA.
- **Line items**: product dropdown, qty in LBS (kg mirrors automatically via `× 0.453592`), unit price `$/lb` and `$/kg` (mirrored).
- **Bank picker** (replaces legacy free-text Bank ID).
- **Notify Party** is positioned under Customer in the header (positional convention).

Actions:
- **View Proforma** → PDF preview.
- **Email** → opens the same Delivery Docs modal with the Proforma pre-selected (legacy flow uses different button).
- **Convert to Invoice** → opens the Invoice drawer pre-filled with the SO data.

### 5.7 Packing list & Invoice

Legacy `PLInvoiceEngine` (v1). Combines PL editing and Invoice editing in one page. Modern v2 splits these into the **Sales Orders / Invoice & docs** flow. Use this only when the v2 split misses a feature you need.

### 5.8 Invoice & docs (v2)

The most important operator screen. Each row is a commercial invoice.

Row actions (left to right):
- **Delivery docs (FileText icon)** — opens the Delivery Documents modal.
- **View (eye)** — read-only preview dialog.
- **Edit (pencil)** — drawer with full field editor.
- **Email (envelope)** — opens Delivery Docs with auto-email + invoice + PL pre-selected.
- **Save to Dropbox (cloud-upload)** — see workflow C below.
- **Duplicate (copy)** — opens the New Invoice drawer with all fields pre-filled except invoiceNumber + date.
- **Delete (trash)**.

#### Delivery Documents modal

The modal contains four document rows, each with checkbox + (eye preview · download · — for BOL also upload):

1. **Invoice** — generated PDF (`v2/services/pdf/invoicePdf.ts`).
2. **Packing List** — generated PDF (`v2/services/pdf/packingListPdf.ts`).
3. **Shipper's Letter of Instruction (SLI)** — auto-generated from invoice + supplier (`v2/services/pdf/sliPdf.ts`).
4. **Bill of Lading** — uploaded by user. Stored as data URL on `invoices.bolUrl`. Native v2 upload (max 5MB, PDF/PNG/JPG/WEBP). Preview opens **inline in a Dialog** (not a popup) for both PDF and image. Replaced the v1-handoff path entirely.

Footer toggles:
- **BR mode** — Brazil-specific renumbering and pricing rules:
  - Invoice number renamed to `EC<last-two-digits>` (e.g. INV-8004 → EC04)
  - BEATRIZ pricing fixed at $0.28/kg
  - PATEX / PATAMUTE applies 50% off
  - BOL excluded from emails
- **50% mode** — applies 50% off all unit prices in the generated PDFs (legacy Patex pricing override).

Bottom button: **Email selected (N)** — composes a draft through `services/emailService.sendEmail` (Outlook or Gmail). Recipient resolution: `v2/services/recipients.ts` — main email to TO, email2/email3 to CC, broker to CC if `includeBroker`, cargo agent from booking to CC.

### 5.9 Trading Follow Up

Operational dashboard: every active shipment with status badges and ETA aging. Cards show booking number, vessel/voyage, last activity, days past ETA.

### 5.10 Agent Sales Orders (sopici)

Same shape as Sales Orders but for external sales agents. Adds:
- **Commission Rate** (numeric)
- **Commission Type** (`%` of sale, fixed per kg, etc.)

These drive rows in `commission_sales_orders` (the commissions ledger).

### 5.11 Agent Follow Up

Trading Follow Up scoped to agent SOs.

### 5.12 Freight Quotes

Quotes from cargo agents for a given lane. Each row: cargo agent, origin port, destination port, rate, valid_until.

Used by Bookings — when you book a quote, the chosen quote's rate flows into the booking's `freightRate`.

### 5.13 Bookings

Confirmed freight bookings. Fields: booking #, vessel/voyage, ETD/ETA, cargo agent, container info.

Booking number is the **join key** for `cargo_agents` lookup when emailing delivery docs (recipient resolver auto-CCs the agent's email).

### 5.14 Bill of Ladings

Final BL records. Often arrive via WhatsApp/email and get OCR-extracted into `bill_landings` rows. A single BL may span multiple invoices.

### 5.15 Payables (AP)

Supplier invoices owed by EC4. Backed by `invoices_suppliers` table.

List columns: Invoice #, Supplier, Terms, Amount, Issued, Status, QB.

#### Payment status (admin-managed)

Status chips in the edit drawer (top of form):
- **UNPAID** (default for new bills) — amber clock pill
- **PAID** — emerald check pill
- **OVERDUE** — rose alert pill

Stored in `invoices_suppliers.status` (free-text column, accepts other values for legacy compat but UI only emits the three above). When a row has no stored status, the list falls back to date-derived `Due Soon` / `On Track` / `No Date` so legacy rows still get a sensible badge.

#### QB sync

Click **Send to QB** in the row. Edge Function `qb-sync` action `sync-bill`:
- Looks up vendor by supplier name (fuzzy match → create-if-missing).
- Resolves QB product/service mapping (column `qb_product_service`).
- Creates a QB Bill.
- Logs to `qb_sync_log` table with `sync_status` = `success` / `error` / `pending`.
- Tenant-scoped: caller must own `companyId`.

The drawer field set covers every editable column on the table (~22 fields grouped: Header / Parties / Quantities / Money / Banking). The `items` JSON column is **not** drawer-editable — use AI Upload to ingest new line items.

#### Drawer field schema (full list)

```
Header:       invoiceNumber, shipperName (Supplier picker), shipperAddress,
              invoiceDate, dateOrder, paymentTerms (lookup)
Routing:      soldTo, shipTo, incoterms, freightTerms, carrier,
              transportRef, customerPo
Quantities:   totalQuantity, grossWeight, netWeight, tareWeight (all kg)
Money:        subtotal, totalAmount (required), currency (default USD)
Banking:      remitTo, bankName, swiftCode, routingNumber, accountNumber
Status:       UNPAID / PAID / OVERDUE  (rendered as chips at top)
```

### 5.16 Receivables (AR)

Customer invoices owed to EC4. Backed by `invoices`.

Same QB sync pattern (action `sync-invoice` creates QB Invoice). Status lifecycle: Pending → Partial → Paid.

### 5.17 Customer Balances

Aging by customer — Current / 30 / 60 / 90 / 90+ buckets. Read-only.

### 5.18 Data menu

Reference master data:
- **Banks** — EC4's bank accounts (used for SO drawer's Bank picker).
- **Cargo Agents** — freight forwarders.
- **Carriers** — shipping lines.
- **Customers** — buyers.
- **Doc Viewer** — browse uploaded source PDFs (BOL data URLs, original PLs).
- **Locations** — saved locations / addresses.
- **Ports** — port catalog with UN/LOCODE.
- **Products** — catalog of grades. HS codes, descriptions.
- **Suppliers** — sellers.
- **Doc OCR** — manual extraction page for arbitrary PDFs.

### 5.19 Settings menu

- **Users** — admin user management with the password field (write-only, blank = keep current).
- **Companies** — tenant administration.
- **Database Config** — paste/copy the canonical schema (`services/schema.ts`). **Read-only reference** — schema.ts is sometimes ahead of the live DB.
- **Branding & Logo** — company logo (used in PDFs).
- **Email Integration** — connect Outlook / Gmail.
- **Brain Diagnostics** — internal AI tooling.

### 5.20 Customer Portal

Public-ish portal scoped to a customer for invoice + shipment visibility. Different auth path.

### 5.21 Cargo Agent Portal

Scoped sidebar that only shows Freight Quotes + Bookings for the agent's own rows. `linked_entity_id` is the CSV of `cargo_agents.id` values that this user represents.

---

## 6. Workflow recipes

### Recipe A: New sales order from a customer enquiry

1. **Sales Orders (Proformas)** → `+ New Sales Order`.
2. Customer dropdown — type to search `customers.name`. Selecting auto-fills payment terms, POD/POA, Notify Party if those fields exist on the customer record.
3. Line items: pick a product, type qty in LBS — the kg mirror updates automatically. Unit price as `$/lb` or `$/kg`.
4. Save. SO row created with id like `SO-NNNNNN` and the proforma PDF can be previewed.
5. **Email** → opens Delivery Docs modal in auto-email mode with the proforma pre-selected.

### Recipe B: Generate an invoice from a confirmed SO

1. Open the SO → action **Convert to Invoice**.
2. Invoice drawer opens pre-filled (customer, POD, items, weights, bank).
3. Type the `invoiceNumber` (manual numbering — convention `INV-NNNN`).
4. Fill `containers[]` if not auto-populated from the PL.
5. Save. Lands in **Invoice & docs**.

### Recipe C: Attach a BOL and Save to Dropbox archive

1. **Invoice & docs** → open the invoice → click **Delivery docs**.
2. In the modal, click the **Upload** icon on the BOL row → pick PDF/image (max 5MB). Row flips to **Uploaded**.
3. Close the modal. From the invoice row, click the **cloud-upload** icon (Save to Dropbox).
4. Toast: `<FIRSTWORD> CI-<inv#> · N files`.
5. Dropbox folder created at `/EC4 COMEC - 3. SHIPPED WITH BL/<FIRSTWORD> CI-<inv#>/` with:
   - `Invoice_<inv#>.pdf` (always)
   - `PLPerProduct_<plnum>.pdf` (when PL is linked)
   - `PLPerContainer_<plnum>.pdf` (when PL is linked)
   - `SupplierPL_<plnum>.<ext>` (when `packing_lists.originalDocument` is set)
   - `BOL_<inv#>.<ext>` (when `bolUrl` is set)

### Recipe D: Sync an invoice to QuickBooks

1. Open the invoice (Receivables for AR side) or supplier bill (Payables for AP).
2. For AP: set `qb_product_service` if not set.
3. Click **Send to QB** in the row.
4. Edge Function creates Bill (AP) or Invoice (AR). Toast shows the QB entity id.
5. The row's QB column flips from `—` to `Sent`.

### Recipe E: Mark a Payable as Paid

1. **Payables** → open the bill → Edit.
2. Click the **PAID** chip at the top of the drawer.
3. Save changes. List row turns emerald.
4. If QB-synced, the QB sync's reconciliation job will also flip `qb_status` later when the QB Bill is marked paid in QuickBooks.

### Recipe F: Add or change a user's password

1. **Settings → Users** → open the user.
2. Click **Edit**.
3. Type the new password into the **Password** field (placeholder: "Leave blank to keep current").
4. **Save changes**. Toast: "Saved · <name>".
5. The new password is stored plain text in `users.password`. User logs in with the new value immediately.

### Recipe G: WhatsApp customer reply with attached document

1. **Connections → WhatsApp** → open the conversation.
2. Click the paperclip / upload-document icon.
3. Drop the file. AI extracts based on document type: Invoice / PL / SO / BOL.
4. Review the draft preview → Confirm → row persists.
5. Continue the chat normally.

### Recipe H: Onboard a new customer

1. **Data → Customers** → `+ New customer`.
2. Required: name, country.
3. Optional but useful: email, email2, email3 (for CC), brokerEmail (for broker CC), CNPJ/Tax ID, default POD/POA, default payment terms.
4. Save. Now selectable in Sales Orders / Invoices.

### Recipe I: Set up Dropbox integration (one-time)

See `docs/dropbox-setup.md`. Summary:
1. Create a Dropbox app at https://www.dropbox.com/developers/apps (Scoped access, Full Dropbox).
2. Permissions: `files.content.write`, `files.metadata.{read,write}`. Submit.
3. Add redirect URI `http://localhost/oauth-noop` in Settings.
4. Run the OAuth code-flow once locally to get a refresh token.
5. Insert into `system_settings.dropbox_credentials` as JSON: `{ appKey, appSecret, refreshToken, rootPath }`.
6. Deploy `dropbox-upload` Edge Function.
7. The new "Save to Dropbox" row action just works.

---

## 7. Database reference (the tables that matter)

> Names follow camelCase column convention with double-quoted identifiers in SQL. A handful of legacy tables use snake_case — noted explicitly.

### 7.1 Tenant core

| Table | Purpose | Key columns |
|---|---|---|
| `companies` | Tenant root | `id`, `name`, `nickname`, `address`, `phone`, `ein` |
| `users` | App accounts | `id`, `username`, `password` (plain), `role`, `allowed_company_ids[]`, `allowed_modules[]`, `linked_entity_id` (CSV for Cargo Agents) |
| `companies_users` | Membership *(if present)* | join table |

### 7.2 Master data

| Table | Purpose | Notes |
|---|---|---|
| `customers` | Buyers | `email`, `email2`, `email3`, `brokerEmail`; `taxId` for CNPJ |
| `suppliers` | Sellers | `name`, `country` |
| `products` | Grade catalog | `name`, `hsCode`, `grade` |
| `ports` | UN/LOCODE catalog | `code`, `name`, `country` |
| `cargo_agents` | Freight forwarders | `name`, `email`, `email2` |
| `carriers` | Shipping lines | `name`, `scac` |
| `banks` | EC4 banks | `name`, `address`, `swift`, `routing`, `account` |
| `payment_terms` | Terms catalog | `description`, `code` |
| `saved_locations` | Address book | |

### 7.3 Buy side

| Table | Purpose |
|---|---|
| `supplier_offers` | Offers from suppliers (price + grade + quantity) |
| `supplier_quotes` | Quoted prices |
| `purchase_orders` | POs to suppliers |
| `inventory` | Current stock |
| `inventory_logs` | Stock movement audit |
| `cost_calculations` | Landed cost computations |

### 7.4 Sell side

| Table | Purpose | Important columns |
|---|---|---|
| `sales_orders` | SO/Proforma | `customerId`, `customerName`, `items` (jsonb), `paymentTerms`, `incoterm`, `pod`, `poa` |
| `proforma_invoices` | Standalone proformas | parallel to SO |
| `estimates` | Cost estimates | similar shape |
| `commission_sales_orders` | Agent SO + commission row | `commissionRate`, `commissionType`, `commissionPaymentStatus` |
| `commission_sales_contracts` | Agent contracts | |
| `commissions_proformas` | Proformas issued by agents | |

### 7.5 Packing + shipping

| Table | Purpose | Notes |
|---|---|---|
| `packing_lists` | PL per shipment | `plNumber`, `blNumber`, `containers[]`, `originalDocument` (data URL of supplier-uploaded PDF) |
| `bookings` | Freight booking | `bookingNumber`, `agentName`, `pol`, `pod`, ETD/ETA, vessel/voyage |
| `bill_landings` | BL records | one BL may span multiple invoices |
| `shipments` | High-level shipment record | |
| `freight_quotes` | Quotes from cargo agents | |

### 7.6 Invoicing & finance

| Table | Purpose | Important columns |
|---|---|---|
| `invoices` | Commercial invoice (AR) | `invoiceNumber`, `plNumber` → `packing_lists.plNumber`, `items` (jsonb-as-text), `netWeight`/`grossWeight` (kg), `bolUrl` (data URL), `containers` |
| `invoices_suppliers` | Supplier invoice (AP) | `invoiceNumber`, `shipperName`, `paymentTerms`, `status` (UNPAID/PAID/OVERDUE), `qb_status`, banking fields. **NO** `supplier` or `date` columns on the live DB despite schema.ts listing them. |
| `qb_tokens` | QB OAuth state | per-company, refreshed by qb-sync |
| `qb_sync_log` | QB sync audit | `source_id`, `source_table`, `qb_entity_id`, `sync_status`, `error_message` |

### 7.7 AI + content

| Table | Purpose |
|---|---|
| `ai_sales_proposals` | AI Sales Agent output queue |
| `ai_agent_identities` | Per-company personas / signatures |
| `agent_threads`, `agent_messages` | Chat history for the dashboard AI |
| `wa_conversations`, `wa_messages` | WhatsApp inbox |
| `prospects` | Cold leads (pre-customer) |
| `activity_logs` | Audit trail (AI-trainable events) |
| `system_settings` | Mixed: secrets + app config. **RLS-locked** on keys matching `credential|secret|token|api_key|password|client_secret|private_key`. |

---

## 8. Edge Functions catalog

All live at `https://qfskvevighylzzmyiwre.supabase.co/functions/v1/<name>`. All require `Authorization: Bearer <app-JWT>` except where noted.

| Function | Purpose | Special notes |
|---|---|---|
| `auth-issue` | Login → JWT mint | Case-insensitive `ilike` username lookup with `%`/`_` escaped. Plain-text password compare. |
| `gemini-proxy` | OCR + extraction calls to Google AI | Body-size cap by actual bytes (not Content-Length). |
| `gemini-translate` | Translation calls | Same proxy pattern. |
| `anthropic-proxy` | Claude calls for AI Sales Agent | 2 MB body cap by actual bytes. |
| `qb-auth` | QuickBooks OAuth handshake | One per company. |
| `qb-sync` | All QB write/read actions | Actions: sync-bill, sync-invoice, void-invoice, sync-status, batch-status, query-items, bulk-create-items, check-payment-status, query-customers, customer-statement. **Tenant-scoped** via `assertTenantAccess(companyId)`. No "any-token" fallback. |
| `whatsapp-webhook` | Inbound WhatsApp from Meta | **HMAC signature verified** with `META_APP_SECRET`. Fails closed (403) when signature missing or wrong. |
| `whatsapp-send` | Outbound to Meta Cloud API | |
| `twilio-send` | Outbound Twilio SMS / WhatsApp | |
| `twilio-webhook` | Inbound Twilio | |
| `dropbox-upload` | Save 3-5 files to Dropbox folder | Reads `system_settings.dropbox_credentials`. Auto-creates folder. Mode `overwrite` (re-saves replace). |

---

## 9. Integration setup

### 9.1 QuickBooks Online

Per-company OAuth. Tokens in `qb_tokens` (`company_id`, `access_token`, `refresh_token`, `token_expiry`, `realm_id`).

Setup once per company:
1. Go to **Connections** → QuickBooks section.
2. Click Connect → Intuit OAuth flow → returns to `/oauth/qb-callback`.
3. `qb-auth` Edge Function stores tokens.
4. From then on, `qb-sync` actions refresh the access token automatically.

Env vars on the Edge Function: `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_USE_SANDBOX` (`true`/`false`).

### 9.2 Dropbox

See Recipe I. Single-tenant: one EC4 Dropbox account holds the shared `/EC4 COMEC - 3. SHIPPED WITH BL/` folder; every EC4 user who hits Save sends there.

### 9.3 Twilio + Meta WhatsApp

Credentials in `system_settings.twilio_credentials` (JSON: `accountSid`, `authToken`, `phoneNumber`). Meta app secret in Edge Function env (`META_APP_SECRET`) and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

Inbound flow:
1. Meta/Twilio POSTs to `whatsapp-webhook`.
2. Function verifies HMAC signature. **Fails closed** on missing/invalid.
3. Writes to `wa_conversations`/`wa_messages`.
4. Triggers `runAgentFromWhatsApp` if the message can be auto-handled.

### 9.4 Outlook (MSAL)

User-side OAuth. Connect from **Settings → Email Integration**. Tokens stored in browser `localStorage` (not the DB). `services/emailService.ts` picks Outlook if connected, else Gmail.

### 9.5 Google Identity (Gmail)

Same flow. Both can be connected — Outlook wins if both present (configurable).

---

## 10. Security model

| Surface | Rule |
|---|---|
| `system_settings` table | RLS denies any client SELECT/INSERT/UPDATE on keys matching `(credential|secret|token|api[_-]?key|password|client[_-]?secret|private[_-]?key)`. Service role bypasses. **Never** fetch these client-side. |
| `qb-sync` | Caller's JWT must have `allowed_company_ids` containing the requested `companyId`. No fallback to "any token" — every action returns 403 on mismatch. |
| `whatsapp-webhook` | HMAC-verified, returns 403 on missing header / wrong sig / missing secret. |
| `anthropic-proxy` | Body capped at 2 MB by actual bytes (not Content-Length). |
| `gemini-proxy` | Same pattern. |
| Purchase Order email | Every dynamic field HTML-escaped at construction; `sanitizeHtml` applied at render in preview. |
| Login | Username `ilike` is escaped (`%`/`_` → literals). Password compare is strict equality. |
| JWT | HS256, 12h TTL, signed with `APP_JWT_SIGNING_SECRET` (mirrors Supabase project JWT secret). |
| Tenant scope | All tenant-scoped queries pass `companyId` to `.eq('"companyId"', currentCompanyId)`. `'ALL'` is a sentinel meaning "no filter" — only admins / cross-company views use it. |

### Things to never do

- Don't try to SELECT `system_settings` for credential rows from the client — it will fail silently with 0 rows.
- Don't send secrets through `console.log` or any path that ends up in a bundle.
- Don't bypass `assertTenantAccess` in qb-sync — every handler must call it.
- Don't pass an unescaped user string into PostgREST `.or()` — it's a wildcard injection surface (currently unescaped in v2/queries/useInvoices.ts and usePurchaseOrders.ts — known medium-sev issue).
- Don't auto-click `Delete` on any row. Confirm with the user.

---

## 11. Common errors and how to fix

| Error / symptom | Cause | Fix |
|---|---|---|
| `column invoices_suppliers.<col> does not exist` | `schema.ts` is ahead of live DB | Drop the column from the SELECT (or `ALTER TABLE` to add it). Known missing: `supplier`, `date`. |
| `401 Unauthorized` from any Edge Function | JWT expired (12h TTL) or missing | Re-login. The frontend shows a re-login prompt automatically for most flows. |
| `Forbidden — caller is not a member of this company` | qb-sync called with companyId outside JWT's `allowed_company_ids` | Switch active company in the sidebar, or add the company to the user's allow-list. |
| `Dropbox is not configured` | `system_settings.dropbox_credentials` missing | Follow Recipe I and `docs/dropbox-setup.md`. |
| `BOL too large (X MB)` | File > 5 MB | Compress or split. |
| `Upload the Bill of Lading first` | Save-to-Dropbox attempted without BOL — actually **this constraint was removed**; if you see it, the deploy is stale. | Hard-reload. |
| `Invalid username or password` after password change | Stale in-memory users array | Hard-reload. |
| Toast "Update failed" when editing a user / row | Most often RLS, sometimes a column name mismatch | Open DevTools → Network tab → look at the PostgREST response body for the real reason. |
| Empty Payables list | Schema-cache lag after a column add/drop | Run `notify pgrst, 'reload schema';` in SQL editor. |
| `Couldn't load X` red error card | Query failed at fetch time | Click Retry. If persistent, check Network tab for status + body. |

---

## 12. Conventions & invariants

- **Versioning**: `package.json.version` bumps +0.01 before every Cloud Run deploy. Current baseline: 12.95+. Visible on the Login page footer.
- **Deploy command**:
  ```bash
  gcloud builds submit --config=cloudbuild.yaml \
    --substitutions=_VITE_SUPABASE_ANON_KEY=<anon-key> --project=xs-erp .
  gcloud run deploy xs-erp --image=gcr.io/xs-erp/xs-erp-app:latest \
    --region=us-central1 --project=xs-erp --port=8080 --quiet
  ```
- **Edge Function deploy**: `supabase functions deploy <name> --project-ref qfskvevighylzzmyiwre`.
- **Weights**: `netWeight`/`grossWeight` columns are **kg**. Some legacy rows accidentally stored lbs in those columns; the PDF generator and InvoiceDrawer auto-detect (heuristic: stored > 1.5× line-item kg sum implies lbs) and convert. A migration normalized data on disk: `supabase/migrations/20260511120000_normalize_invoice_weights.sql`.
- **Decimals**: PDFs and drawer weight inputs render 2 decimals (e.g. `19,484.04 kg`). v1 InvoiceEngine container summary tables were updated to match.
- **First word of customer name** drives the Dropbox folder (e.g. `BEATRIZ TEXTIL SA` → `BEATRIZ CI-8004`). Use the legal name as known to ops.
- **CONSIGNEE / NOTIFY** labels on invoice + PL PDFs are plain (no `(bill to)` / `(ship to)` suffix).
- **BR mode**: Brazil-specific override. See section 5.8.
- **`'ALL'`** is the sentinel for "no company filter" — only admin-grade views use it.
- **Module gates** at `users.allowed_modules[]`: see section 2 for full list. Adding to the list is additive — older rows don't need migration.

---

## 13. Deploy & release flow

1. Edit code locally.
2. `npm run build` — fail fast on TypeScript errors.
3. Bump `package.json.version` +0.01.
4. Run the Cloud Build + Run deploy commands above (both in one shell).
5. Smoke-check: `curl -s -o /dev/null -w "%{http_code}\n" https://xs-erp-489872954398.us-central1.run.app/` → expect `200`.
6. Hard-reload the app (⌘⇧R) to flush bundle cache.
7. If Edge Function changes: `supabase functions deploy <name> --project-ref qfskvevighylzzmyiwre`.
8. If schema changes: run the migration in the Supabase SQL editor *before* deploying frontend.

---

## 14. Capabilities & limits

### What the agent can do

- Read any list / drawer in v2.
- Create / edit / delete most rows where the user has permission (delete only after explicit user confirmation).
- Generate Invoice / PL Per Product / PL Per Container PDFs via the existing generators.
- Upload BOL through the v2 native file picker.
- Save delivery docs bundle to Dropbox via `dropbox-upload` Edge Function.
- Trigger QB sync via `qb-sync` actions.
- Compose and send emails via Outlook / Gmail (user-side OAuth required).
- Send WhatsApp through `whatsapp-send` / `twilio-send` within the 24-hour session window.
- Run SQL via the Supabase dashboard SQL editor (ask the user to paste & run when needed).
- Bump version + deploy when authorised (read: explicit user OK).

### What the agent must not do

- Delete rows without explicit user confirmation.
- Write to `system_settings` from the client (RLS-locked for secret-shaped keys; service role only).
- Bypass `assertTenantAccess` in qb-sync.
- Send WhatsApp outside the Meta 24-hour session window.
- Log secrets to console / commit them to git.
- Rotate the JWT signing secret unannounced (it'll log every active user out).
- Auto-amend prior commits — always make new commits.
- Push directly to `main` without a build that passes.

### What the agent cannot do

- Bypass GoTrue-style email auth (the app uses custom auth, not Supabase Auth).
- Reach external services on user's local machine (the Dropbox sync is API-only, not filesystem).
- Read browser `localStorage` of a different user (each browser holds its own MSAL tokens).
- Skip the BR-mode toggles — these have to be set per-invoice if Brazil-specific rules apply.

---

## 15. When you don't know

1. Open the row's drawer — every column the row carries is in there.
2. Cross-reference `services/schema.ts` for column names and shapes (knowing that some legacy columns are out of date).
3. Ask the **AI chat** on the Dashboard — it can answer "show me X" / "where is Y" without you having to browse.
4. If a save fails with a confusing error, the **Network tab** has the real PostgREST response body.
5. For deploys / Edge Functions, follow the templates in section 13.
6. For Edge Function logs: Supabase dashboard → Functions → pick the function → Logs tab.
7. If a feature isn't in this manual, ask the user.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| AR / AP | Accounts Receivable / Payable |
| BOL / BL | Bill of Lading |
| BR mode | Brazil pricing / numbering override mode |
| CI | Commercial Invoice |
| ETD / ETA | Estimated Time of Departure / Arrival |
| FCA / FOB / CFR / CIF | Incoterm variants |
| PL | Packing List |
| POD / POA | Port of Destination / Port of Arrival |
| PO | Purchase Order |
| SO | Sales Order |
| SLI | Shipper's Letter of Instruction |
| SO-NNN / INV-NNNN | Conventional row identifiers |
| HS code | Harmonized System tariff code |
| RLS | Row Level Security (Postgres) |
| Service role | Supabase admin key that bypasses RLS |

---

**End of manual.** When the system changes materially (new module, schema migration, new integration), update this file in the same commit so it never drifts. Last updated: 2026-05-13, version 12.96.
