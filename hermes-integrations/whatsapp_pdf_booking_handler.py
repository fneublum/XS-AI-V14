"""
HERMES handler: WhatsApp PDF → OCR → Booking saved to Supabase
─────────────────────────────────────────────────────────────────
Drop this file into your HERMES handlers directory and register it
in your gateway config. It intercepts inbound WhatsApp messages that
contain a PDF attachment, runs Gemini OCR, and inserts a new booking
row into the ERP's Supabase `bookings` table.

Trigger: inbound WhatsApp message with a PDF attachment where the
         filename or caption contains "booking" (case-insensitive),
         or when the agent routes to this handler explicitly.

Usage (from WhatsApp):
  Just forward any booking confirmation PDF to the chat.
  The gateway detects it automatically and replies with a confirmation.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
from typing import Any

import httpx  # already a common HERMES dep; or use requests

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL     = os.environ["VITE_SUPABASE_URL"]          # https://qfskvevighylzzmyiwre.supabase.co
SUPABASE_KEY     = os.environ["VITE_SUPABASE_ANON_KEY"]
GEMINI_API_KEY   = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL     = "gemini-2.5-flash"

PROMPT_BOOKING = """Extract Booking Confirmation fields as JSON:
{"bookingNumber": string|null, "customer": string|null, "agentName": string|null,
 "vesselVoyage": string|null, "pol": string|null, "pod": string|null,
 "equipment": string|null, "etd": string|null, "eta": string|null,
 "cargoCutOff": string|null, "vgmCutOff": string|null, "draftCutOff": string|null,
 "freeTime": string|null, "terminal": string|null}
For pol and pod return ONLY the 5-letter UN/LOCODE (e.g. USHOU).
Return ONLY valid JSON."""


# ── Date normaliser (mirrors v2/lib/isoDate.ts) ───────────────────────────────

def to_iso_date(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    # Try Python date parsing
    from datetime import datetime
    for fmt in ("%m/%d/%Y", "%d-%b-%Y", "%b %d, %Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Fallback: strip time component if ISO-ish
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


# ── Gemini OCR ────────────────────────────────────────────────────────────────

def ocr_booking_pdf(pdf_bytes: bytes) -> dict[str, Any] | None:
    b64 = base64.b64encode(pdf_bytes).decode()
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": "application/pdf", "data": b64}},
                {"text": PROMPT_BOOKING},
            ],
        }],
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    resp = httpx.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def booking_exists(booking_number: str) -> str | None:
    """Returns existing row id if found, else None."""
    url = f"{SUPABASE_URL}/rest/v1/bookings?bookingNumber=eq.{booking_number}&select=id"
    resp = httpx.get(url, headers=_sb_headers(), timeout=10)
    rows = resp.json()
    return rows[0]["id"] if rows else None


def resolve_port_code(code: str | None) -> str | None:
    if not code:
        return None
    candidate = re.sub(r"\s*-.*$", "", code).strip().upper()
    if not re.match(r"^[A-Z]{5}$", candidate):
        return code
    url = f"{SUPABASE_URL}/rest/v1/ports?code=eq.{candidate}&select=code"
    resp = httpx.get(url, headers=_sb_headers(), timeout=5)
    rows = resp.json()
    return rows[0]["code"] if rows else candidate


def insert_booking(data: dict[str, Any], pdf_bytes: bytes) -> str:
    b64_doc = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode()
    booking_number = (data.get("bookingNumber") or "").strip() or f"BK-{int(time.time())}"

    existing_id = booking_exists(booking_number)
    if existing_id:
        # Attach updated PDF to existing row
        url = f"{SUPABASE_URL}/rest/v1/bookings?id=eq.{existing_id}"
        httpx.patch(url, headers=_sb_headers(), json={"originalDocument": b64_doc}, timeout=10)
        return f"updated_existing:{existing_id}"

    pol = resolve_port_code(data.get("pol"))
    pod = resolve_port_code(data.get("pod"))

    row = {
        "id":               f"BK{int(time.time())}",
        "bookingNumber":    booking_number,
        "companyId":        None,
        "customer":         data.get("customer"),
        "agentName":        data.get("agentName"),
        "vesselVoyage":     data.get("vesselVoyage"),
        "pol":              pol,
        "pod":              pod,
        "equipment":        data.get("equipment"),
        "etd":              to_iso_date(data.get("etd")),
        "eta":              to_iso_date(data.get("eta")),
        "cargoCutOff":      to_iso_date(data.get("cargoCutOff")),
        "vgmCutOff":        to_iso_date(data.get("vgmCutOff")),
        "draftCutOff":      to_iso_date(data.get("draftCutOff")),
        "freeTime":         data.get("freeTime"),
        "terminal":         data.get("terminal"),
        "originalDocument": b64_doc,
        "status":           "AVAILABLE",
        "createdAt":        __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
    url = f"{SUPABASE_URL}/rest/v1/bookings"
    resp = httpx.post(url, headers=_sb_headers(), json=row, timeout=15)
    resp.raise_for_status()
    return f"inserted:{row['id']}"


# ── Main handler (called by HERMES gateway) ───────────────────────────────────

def handle_pdf_attachment(pdf_bytes: bytes, filename: str = "") -> str:
    """
    Entry point for the HERMES gateway.
    Returns a human-readable WhatsApp reply string.

    Integration in gateway/run.py:
        from hermes_integrations.whatsapp_pdf_booking_handler import handle_pdf_attachment

        if message.has_attachment and message.attachment.mime == "application/pdf":
            caption = (message.caption or message.attachment.filename or "").lower()
            if "booking" in caption or "confirmation" in caption:
                reply = handle_pdf_attachment(message.attachment.data, message.attachment.filename)
                await send_whatsapp(message.from_number, reply)
    """
    print(f"[booking-handler] OCR-ing {filename!r} ({len(pdf_bytes)} bytes)")

    parsed = ocr_booking_pdf(pdf_bytes)
    if not parsed:
        return "❌ Could not extract booking fields from this PDF. Please try again or enter manually."

    booking_number = parsed.get("bookingNumber") or "?"
    result = insert_booking(parsed, pdf_bytes)

    if result.startswith("updated_existing"):
        return (
            f"📎 Booking *{booking_number}* already exists — updated PDF attached.\n"
            f"No data was overwritten."
        )

    etd  = to_iso_date(parsed.get("etd"))  or "—"
    cutoff = to_iso_date(parsed.get("cargoCutOff")) or "—"
    pol  = parsed.get("pol") or "—"
    pod  = parsed.get("pod") or "—"
    equip = parsed.get("equipment") or "—"

    return (
        f"✅ Booking *{booking_number}* saved to ERP\n\n"
        f"📦 {equip}  |  {pol} → {pod}\n"
        f"🚢 ETD: {etd}   ✂️ Cut-off: {cutoff}\n"
        f"Customer: {parsed.get('customer') or '—'}"
    )
