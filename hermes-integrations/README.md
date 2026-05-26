# HERMES ↔ XS-AI ERP Integrations

Three integrations that connect the HERMES messaging gateway to the ERP's Supabase database.

## 1. Supabase MCP (`supabase_mcp_config.yaml`)

Gives Max, Lara, Matt, and all other HERMES agents **live read access** to the ERP database directly from WhatsApp conversations.

**Install on Mac mini:**
```bash
# Requires Node.js
npm install -g @supabase/mcp-server-supabase

# Add to your HERMES MCP config (see supabase_mcp_config.yaml)
# Set env var:
export SUPABASE_SERVICE_ROLE_KEY=<your service role key from Supabase dashboard>
```

**What agents can answer after this:**
- "What's the cut-off for booking 271230293?"
- "Show me EC4's outstanding balance"
- "Which bookings have ETD this week?"
- "Is invoice INV-2026-xxx paid?"

---

## 2. WhatsApp PDF → Booking OCR (`whatsapp_pdf_booking_handler.py`)

Forward any booking confirmation PDF to WhatsApp → booking automatically saved to ERP.

**Install on Mac mini:**
```bash
pip install httpx
cp whatsapp_pdf_booking_handler.py ~/.hermes/hermes-agent/hermes_integrations/
```

**Wire into `gateway/run.py`:**
```python
from hermes_integrations.whatsapp_pdf_booking_handler import handle_pdf_attachment

# Inside your inbound message handler:
if message.has_attachment and message.attachment.mime == "application/pdf":
    caption = (message.caption or message.attachment.filename or "").lower()
    if "booking" in caption or "confirmation" in caption:
        reply = handle_pdf_attachment(message.attachment.data, message.attachment.filename)
        await send_whatsapp(message.from_number, reply)
```

**Environment variables needed:**
```bash
VITE_SUPABASE_URL=https://qfskvevighylzzmyiwre.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
GEMINI_API_KEY=<gemini key>
```

---

## 3. Daily Cut-off Briefing (`daily_cutoff_briefing.py`)

Sends a WhatsApp summary of upcoming cargo cut-offs every morning at 08:00.

**Install on Mac mini:**
```bash
pip install httpx
cp daily_cutoff_briefing.py ~/.hermes/hermes-agent/hermes_integrations/
```

**Register in HERMES cron config:**
```yaml
cron:
  - name: daily_cutoff_briefing
    schedule: "0 8 * * *"
    handler: hermes_integrations.daily_cutoff_briefing:run
    args:
      to: "+19044399343"
```

**Test manually:**
```bash
cd ~/.hermes/hermes-agent
python -m hermes_integrations.daily_cutoff_briefing
```

**Sample output:**
```
☀️ Cut-off briefing — 25 May 2026

⚠️ OVERDUE CUT-OFFS
  • #271051138 · EC4 ENTERPRISES LLC
    USCHS→BRPEC · 3 x 40 DRY
    Cut-off: 2026-05-22  ⚠️ 3d overdue

📅 UPCOMING (next 7 days)
  • #271230293 · EC4 ENTERPRISES LLC
    USHOU→BRMAO · ETD 2026-06-06
    Cut-off: 2026-06-01  🟢 7d

Total AVAILABLE: 9
```

---

## Environment Setup (Mac mini)

Add to `~/.hermes/.env` or HERMES config:

```bash
VITE_SUPABASE_URL=https://qfskvevighylzzmyiwre.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GEMINI_API_KEY=<your key from .env.local on M5>
FELIPE_WHATSAPP=+19044399343
HERMES_SEND_URL=http://localhost:9119/send   # adjust to your gateway send endpoint
```
