"""
HERMES cron job: Daily cargo cut-off briefing via WhatsApp
──────────────────────────────────────────────────────────
Runs every morning (default 08:00) and sends Felipe a WhatsApp
summary of bookings with cargo cut-offs in the next 7 days, plus
any that are already overdue (still AVAILABLE).

Register in HERMES cron config:
  cron:
    - name: daily_cutoff_briefing
      schedule: "0 8 * * *"          # every day at 08:00
      handler: hermes_integrations.daily_cutoff_briefing:run
      args:
        to: "+19044399343"            # Felipe's WhatsApp number

Or call manually:
  python -m hermes_integrations.daily_cutoff_briefing
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import httpx

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL   = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY   = os.environ["VITE_SUPABASE_ANON_KEY"]
WHATSAPP_TO    = os.environ.get("FELIPE_WHATSAPP", "+19044399343")

# How to send WhatsApp — fill in whichever method HERMES uses internally.
# This calls the HERMES internal send endpoint; adjust to match your gateway.
HERMES_SEND_URL = os.environ.get("HERMES_SEND_URL", "http://localhost:9119/send")


# ── Supabase query ────────────────────────────────────────────────────────────

def _sb_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }


def fetch_available_bookings() -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/bookings"
        f"?status=eq.AVAILABLE"
        f"&select=bookingNumber,customer,pol,pod,equipment,etd,cargoCutOff,vgmCutOff"
        f"&order=cargoCutOff.asc.nullslast"
    )
    resp = httpx.get(url, headers=_sb_headers(), timeout=10)
    resp.raise_for_status()
    return resp.json()


# ── Message builder ───────────────────────────────────────────────────────────

def _days_label(cut_str: str | None, today: date) -> str | None:
    if not cut_str:
        return None
    try:
        cut = date.fromisoformat(cut_str[:10])
        delta = (cut - today).days
        if delta < 0:
            return f"⚠️ {abs(delta)}d overdue"
        if delta == 0:
            return "🚨 TODAY"
        if delta == 1:
            return "🔴 tomorrow"
        if delta <= 3:
            return f"🟠 {delta}d"
        return f"🟢 {delta}d"
    except ValueError:
        return None


def build_briefing(bookings: list[dict]) -> str:
    today = date.today()
    horizon = today + timedelta(days=7)

    urgent: list[dict]  = []
    upcoming: list[dict] = []
    ok: list[dict]       = []

    for b in bookings:
        co = b.get("cargoCutOff")
        if not co:
            ok.append(b)
            continue
        try:
            cut = date.fromisoformat(co[:10])
        except ValueError:
            ok.append(b)
            continue

        if cut <= horizon:
            if cut < today:
                urgent.append(b)
            else:
                upcoming.append(b)
        else:
            ok.append(b)

    if not urgent and not upcoming:
        return (
            f"☀️ *Morning briefing — {today.strftime('%d %b %Y')}*\n\n"
            f"✅ No cut-offs in the next 7 days.\n"
            f"All {len(bookings)} AVAILABLE booking(s) are on track."
        )

    lines = [f"☀️ *Cut-off briefing — {today.strftime('%d %b %Y')}*\n"]

    if urgent:
        lines.append("*⚠️ OVERDUE CUT-OFFS*")
        for b in urgent:
            label = _days_label(b.get("cargoCutOff"), today)
            lines.append(
                f"  • #{b['bookingNumber']} · {b.get('customer','?')}\n"
                f"    {b.get('pol','?')}→{b.get('pod','?')} · {b.get('equipment','?')}\n"
                f"    Cut-off: {b.get('cargoCutOff','—')}  {label}"
            )
        lines.append("")

    if upcoming:
        lines.append("*📅 UPCOMING (next 7 days)*")
        for b in upcoming:
            label = _days_label(b.get("cargoCutOff"), today)
            lines.append(
                f"  • #{b['bookingNumber']} · {b.get('customer','?')}\n"
                f"    {b.get('pol','?')}→{b.get('pod','?')} · ETD {b.get('etd','—')}\n"
                f"    Cut-off: {b.get('cargoCutOff','—')}  {label}"
            )
        lines.append("")

    lines.append(f"_Total AVAILABLE: {len(bookings)}_")
    return "\n".join(lines)


# ── WhatsApp sender ───────────────────────────────────────────────────────────

def send_whatsapp(to: str, message: str) -> None:
    """
    Calls the HERMES internal send endpoint.
    Adjust the payload format to match your gateway's /send API.
    """
    try:
        resp = httpx.post(
            HERMES_SEND_URL,
            json={"to": to, "message": message, "channel": "whatsapp"},
            timeout=10,
        )
        resp.raise_for_status()
        print(f"[cutoff-briefing] Sent to {to} ✅")
    except Exception as e:
        print(f"[cutoff-briefing] Send failed: {e}")
        # Fallback: print to stdout so HERMES can pipe it elsewhere
        print(f"\n{'='*60}\nTO: {to}\n{message}\n{'='*60}")


# ── Entry point ───────────────────────────────────────────────────────────────

def run(to: str = WHATSAPP_TO) -> None:
    print(f"[cutoff-briefing] Running at {datetime.now(timezone.utc).isoformat()}")
    bookings = fetch_available_bookings()
    print(f"[cutoff-briefing] {len(bookings)} AVAILABLE bookings fetched")
    message  = build_briefing(bookings)
    print(message)
    send_whatsapp(to, message)


if __name__ == "__main__":
    run()
