# HERMES ↔ XS-AI ERP Integrations

Three integrations that connect the HERMES messaging gateway (Mac mini) to the ERP's Supabase database. All deployed and verified live on 2026-05-25.

---

## 1. `erp` MCP Server (one server, six tools)

Drop-in MCP server installed at `/Users/maxsmart/mcp-servers/erp-mcp/server.mjs`. Gives every HERMES agent (Max, Lara, Matt, Logan, Sal, Beth) direct access to ERP data.

### Tools exposed

| Tool | Purpose |
|---|---|
| `list_bookings(status?, customer?, limit?)` | List bookings with optional status/customer filters |
| `lookup_booking(bookingNumber)` | Full details for one booking |
| `bookings_with_cutoff_in_days(days)` | Split AVAILABLE bookings into overdue and upcoming buckets — used by the daily briefing cron |
| `customer_outstanding(customerName)` | Open (unpaid) invoices + total USD for one customer |
| `recent_invoices(customerName?, limit?)` | Recent invoices, optional customer filter |
| `ocr_and_save_booking(pdf_base64, source?)` | Gemini OCR a booking PDF and insert as new AVAILABLE row — auto-attaches if booking# already exists |

### Files

- **Source**: `hermes-integrations/erp-mcp/server.mjs` (this repo)
- **Deployed**: `/Users/maxsmart/mcp-servers/erp-mcp/server.mjs` on Mac mini
- **Credentials**: `/Users/maxsmart/mcp-credentials/erp-credentials.json` (chmod 600)
- **Registered in**: all 6 profile configs (`~/.hermes/profiles/{max,lara,matt,logan,sal,beth}/config.yaml`)

### Verification

```bash
hermes mcp test erp
# ✓ Connected (136ms)
# ✓ Tools discovered: 6
```

### Re-deploy after editing

```bash
scp hermes-integrations/erp-mcp/server.mjs maxsmart@100.114.73.44:/Users/maxsmart/mcp-servers/erp-mcp/server.mjs
# No restart needed — MCP servers spawn per-call.
```

---

## 2. Daily Cargo Cut-off Briefing (cron)

Scheduled HERMES job that runs daily at 08:00 local. Calls `erp.bookings_with_cutoff_in_days(7)` and sends Felipe a WhatsApp summary.

### Job details

- **ID**: `4a611a649b53`
- **Schedule**: `0 8 * * *`
- **Profile**: `max`
- **Delivery**: `whatsapp:19044399343@s.whatsapp.net`
- **Stored at**: `~/.hermes/profiles/max/cron/jobs.json`
- **Outputs**: `~/.hermes/profiles/max/cron/output/4a611a649b53/<timestamp>.md`

### Sample output

```
📋 CUT-OFF BRIEFING — May 26, 2026

⚠️ OVERDUE (4 bookings)
WARN #270999154 · EC4 ENTERPRISES LLC · USHOU→BRMAO · Cargo cut-off: May 21
WARN #270650706 · EC4 ENTERPRISES LLC · USHOU→BRMAO · Cargo cut-off: May 22
...

✅ UPCOMING (3 bookings, next 7 days)
UPCOMING #271230293 · EC4 ENTERPRISES LLC · USHOU→BRMAO · Cargo cut-off: June 1 (ETD: June 6)
...

Overdue: 4 · Upcoming 7d: 3
```

### Manage

```bash
# Trigger an immediate run (for testing)
hermes cron run 4a611a649b53

# Show schedule and last/next runs
hermes cron list

# Edit delivery target, schedule, name, etc.
hermes cron edit 4a611a649b53 --deliver whatsapp:<jid>

# Pause/resume
hermes cron pause 4a611a649b53
hermes cron resume 4a611a649b53
```

---

## 3. WhatsApp PDF → Booking (no extra wiring needed)

The `ocr_and_save_booking` tool in the `erp` MCP is what powers this. When Felipe forwards a booking PDF via WhatsApp:

1. The HERMES gateway delivers the message + PDF to the active agent (Logan handles shipments).
2. The agent sees the PDF attachment and the description of `ocr_and_save_booking` in the tool list.
3. The agent calls `erp.ocr_and_save_booking(pdf_base64=...)`.
4. The tool: runs Gemini 2.5 Flash OCR, normalizes dates via `toIsoDateString()`, looks up POL/POD against `ports`, inserts the row, and returns `{action: "inserted", bookingNumber, summary}`.
5. The agent replies with a confirmation, e.g. *"✅ Booking 271230293 saved — EC4, USHOU→BRMAO, ETD 2026-06-06, cut-off 2026-06-01."*

**No additional setup — this works the moment the `erp` MCP is registered.**

---

## Profile config layout (FYI)

```
~/.hermes/
  active_profile         # current profile name
  config.yaml            # default profile config
  profiles/
    max/config.yaml      # has its own mcp_servers, platforms, cron
    lara/config.yaml
    matt/config.yaml
    logan/config.yaml
    sal/config.yaml
    beth/config.yaml
```

The `erp` MCP entry was inserted into every profile's `mcp_servers` block.

---

## Credentials file format

`/Users/maxsmart/mcp-credentials/erp-credentials.json` (chmod 600):

```json
{
  "SUPABASE_URL":      "https://qfskvevighylzzmyiwre.supabase.co",
  "SUPABASE_ANON_KEY": "<anon key>",
  "GEMINI_API_KEY":    "<gemini key>",
  "FELIPE_WHATSAPP":   "+19044399343"
}
```

To rotate, just edit this file — no restart needed (MCP server reads it on each spawn).
