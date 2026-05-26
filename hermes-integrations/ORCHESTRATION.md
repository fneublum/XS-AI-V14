# Autonomous Agent Orchestration — XS-AI ERP × HERMES

How the 6 HERMES agents on the Mac mini act as autonomous employees, with full coverage of email management, document management, and ERP data ingestion.

---

## Agent roles

| Agent  | Role                                  | Inbox/Data Access |
|---|---|---|
| **Max**   | Orchestrator. Morning briefing, EOD recap. | outlook_max, gcal_felipe, gcontacts |
| **Lara**  | Felipe's executive assistant.          | outlook_ec4 + outlook_xsolution + outlook_up8 + gmail_felipe |
| **Matt**  | Finance / QB / AR-AP.                  | quickbooks |
| **Logan** | Shipments / BLs / containers / cut-offs. | container_tracking, bl_eta, vessel_tracker |
| **Sal**   | RFQs, proformas, pricing.              | xs_ai_ec4 |
| **Beth**  | Ana Paula's personal (gmail + gcal).   | gmail_ana, gcal_ana |

All 6 agents share: `erp`, `xs_ai_ec4`, `dropbox`, `obsidian_personal`.

---

## Cron schedule (full timeline)

### Real-time loops

| Interval   | Agent         | Job                               |
|---|---|---|
| every 5 min  | system  | Apply approved BL audit corrections |
| every 15 min | system  | Detect BL drift                    |
| every 30 min | system  | Ingest PL/CI drafts (GDrive → ERP) |
| every 1 hr   | Lara    | Triage 3 business inboxes          |

### Daily timeline (weekdays)

| Time  | Agent  | Job                                  |
|---|---|---|
| 00:30 | system  | Rebuild vault indexes (BLs/Containers/PLs) |
| 01:15 | system  | Nightly cleanup                      |
| 04:30 | system  | GC pending drafts                    |
| 06:00 | system  | Sync Dropbox → Vault                 |
| 06:45 | Logan  | Update shipment ETAs from carriers   |
| 07:00 | Max    | Morning briefing — daily journal     |
| 08:00 | Logan  | Shipment ops                         |
| **08:05** | **Logan** | **Cargo cut-off briefing → WhatsApp ⭐NEW** |
| 09:00 | Beth   | Ana Paula inbox (1st pass)           |
| 09:30 | Lara   | Felipe personal Gmail                |
| **18:00** | **Max**   | **End-of-Day recap → WhatsApp ⭐NEW** |
| 18:00 | Beth   | Ana Paula inbox (2nd pass)           |
| 18:30 | Lara   | Felipe personal Gmail (eod)          |
| 21:00 | system | Email-to-vault dump                  |

---

## Data flow — email → ERP

Lara is the entry point. Every hour she:

1. Scans 3 Outlook inboxes for new mail.
2. Categorizes (CUSTOMER / SUPPLIER / FORWARDER / CUSTOMS / INTERNAL / PERSONAL / SPAM).
3. Saves PDF attachments to Google Drive via `scan-outlook-attachments.py` (pre-step).
4. **NEW (STEP 5.7):** For each PDF that's clearly a booking, invoice, BL, or packing list, calls the `erp` MCP to push it into the ERP:
   - Booking PDF → `erp.ocr_and_save_booking`
   - Invoice PDF → `erp.ocr_and_save_invoice`
   - BL PDF → `erp.ocr_and_save_bl`
   - Packing list → `erp.ocr_and_save_packing_list`
5. Drafts polite replies (auto-sent for low-risk; queued via WhatsApp for medium/high).
6. Flags 🔴 RED items to Felipe via WhatsApp.

**Fallback:** the existing `ingest-pl-ci-drafts.py` (every 30 min) catches PL+CI docs that come through the file-based pipeline. Booking + BL are now also covered by Lara's inline ingestion.

---

## `erp` MCP tools (9 total, available to all agents)

| Tool | Used by |
|---|---|
| `list_bookings`, `lookup_booking` | All agents — read access |
| `bookings_with_cutoff_in_days(N)` | Logan — daily briefing |
| `customer_outstanding`, `recent_invoices` | Matt — AR/AP queries |
| `ocr_and_save_booking` | Lara (STEP 5.7), any agent on PDF arrival |
| `ocr_and_save_invoice` | Lara, Matt |
| `ocr_and_save_bl` | Lara, Logan |
| `ocr_and_save_packing_list` | Lara, Logan |

Source: `hermes-integrations/erp-mcp/server.mjs` (deployed to `/Users/maxsmart/mcp-servers/erp-mcp/`)

---

## Scheduling philosophy

- **Everything is launchd** (15 LaunchAgents). HERMES cron (a parallel system) is unused — the cargo cut-off briefing was migrated from hermes cron to launchd so management lives in one place.
- All briefings filter through `_notify-felipe.sh` which suppresses no-op summaries (zero-counts only → no WhatsApp).
- Weekday-only schedules use 5 calendar entries (Mon=1 ... Fri=5).
- All scripts log to `~/Library/Logs/hermes-*.log`.

---

## Verified on 2026-05-25

✅ erp MCP — 9 tools register and respond live (`hermes mcp test erp`)
✅ cutoff-briefing.sh — produces correct briefing from live Supabase data
✅ eod-recap LaunchAgent loaded
✅ Lara prompt — STEP 5.7 inserted, summary block updated to track ERP ingestion counters

⚠️ WhatsApp delivery — the gateway's WhatsApp bridge is currently disconnected (pre-existing issue, unrelated to this work). When reconnected (`hermes whatsapp` to pair), all `notify_felipe` calls start delivering automatically.
