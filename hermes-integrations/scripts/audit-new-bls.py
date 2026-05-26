#!/usr/bin/env python3
"""
audit-new-bls.py — scans Supabase for BL numbers that have NOT yet been
audited, and runs doc-compliance-check.sh against each one.

Sources of BL numbers (union):
  invoices.bl              (rare — only when shipper has linked it back)
  bill_landings.blNumber   (the canonical table)
  packing_lists.blNumber   (from PL OCR — sometimes the only place a BL
                            number lands first)

For each BL number NOT already present in bl_audits.bl_number:
  1. shell out to doc-compliance-check.sh <bl_number>
  2. capture exit code + stderr
  3. summary line per audit attempt

Designed to run every hour via launchd. Idempotent — once an audit row
exists for a BL, the script skips it (subsequent re-audits are handled
by detect-bl-drift.py on PDF hash change).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
ENV = HOME / ".hermes" / ".env.audit"
SCRIPTS = HOME / ".hermes" / "scripts"
CHECK = SCRIPTS / "doc-compliance-check.sh"
LOG_DIR = HOME / "Library" / "Logs"
PROCESSED_STATE = HOME / ".hermes" / "state" / "audit-new-bls.processed.json"


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}  {msg}", flush=True)


def load_env() -> tuple[str, str]:
    env = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_ANON_KEY"]


def sb_get(path: str, params: dict | None = None) -> list[dict]:
    url, key = load_env()
    full = f"{url}/rest/v1/{path}"
    if params:
        full += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(
        full,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def gather_candidate_bls() -> set[str]:
    """Union of BL numbers from invoices.bl + bill_landings.blNumber +
    packing_lists.blNumber. Filters out blanks / null / placeholder values."""
    bls: set[str] = set()

    for r in sb_get("invoices", {"select": "bl", "bl": "not.is.null", "limit": "2000"}):
        bl = (r.get("bl") or "").strip()
        if bl and bl.lower() not in {"null", "n/a", "-", "tbd", "tba"}:
            bls.add(bl)

    for r in sb_get("bill_landings", {"select": "blNumber", "blNumber": "not.is.null", "limit": "2000"}):
        bl = (r.get("blNumber") or "").strip()
        if bl and bl.lower() not in {"null", "n/a", "-", "tbd", "tba"}:
            bls.add(bl)

    for r in sb_get("packing_lists", {"select": "blNumber", "blNumber": "not.is.null", "limit": "2000"}):
        bl = (r.get("blNumber") or "").strip()
        if bl and bl.lower() not in {"null", "n/a", "-", "tbd", "tba"}:
            bls.add(bl)

    return bls


def already_audited_bls() -> set[str]:
    """All BL numbers that already have a row in bl_audits."""
    rows = sb_get("bl_audits", {"select": "bl_number", "limit": "2000"})
    return {(r.get("bl_number") or "").strip() for r in rows if r.get("bl_number")}


def load_processed() -> dict[str, str]:
    """BL numbers we already TRIED in past runs — even if the audit
    pipeline failed and didn't create a bl_audits row. Prevents us from
    re-running doc-compliance-check.sh against a BL whose PDF we couldn't
    find every single hour. Format: {bl_number: iso_timestamp}."""
    if not PROCESSED_STATE.exists():
        return {}
    try:
        return json.loads(PROCESSED_STATE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def save_processed(state: dict[str, str]) -> None:
    PROCESSED_STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = PROCESSED_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(PROCESSED_STATE)


def run_audit(bl_number: str) -> tuple[bool, str]:
    """Invoke doc-compliance-check.sh for one BL. Returns (ok, summary)."""
    if not CHECK.exists():
        return False, f"doc-compliance-check.sh not found at {CHECK}"
    try:
        proc = subprocess.run(
            [str(CHECK), bl_number],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode == 0:
            return True, "audit run completed"
        # Non-zero is typically "PDF not found" — common during the window
        # between an invoice arriving and the BL PDF being saved.
        tail = (proc.stderr or proc.stdout or "")[-200:].strip().replace("\n", " | ")
        return False, f"exit={proc.returncode} · {tail}"
    except subprocess.TimeoutExpired:
        return False, "timeout after 5min"
    except Exception as e:
        return False, f"error: {e}"


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log("=== audit-new-bls.py START ===")

    candidates = gather_candidate_bls()
    audited = already_audited_bls()
    processed = load_processed()

    # New = in candidates but not yet audited AND not already tried in the
    # last 24h (avoid re-running against missing-PDF cases every hour).
    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc).timestamp() - 86_400)
    fresh_tries = {
        bl for bl, ts in processed.items()
        if datetime.fromisoformat(ts).timestamp() > cutoff
    }
    todo = sorted(candidates - audited - fresh_tries)

    log(f"candidates={len(candidates)} already_audited={len(audited)} fresh_skip={len(fresh_tries)} to_run={len(todo)}")

    if not todo:
        log("nothing new to audit — done")
        return 0

    successes = []
    failures = []
    for bl in todo:
        ok, summary = run_audit(bl)
        processed[bl] = now_iso
        if ok:
            successes.append(bl)
            log(f"  ✓ {bl} — {summary}")
        else:
            failures.append((bl, summary))
            log(f"  ✗ {bl} — {summary}")

    save_processed(processed)

    log(f"=== END · ok={len(successes)} failed={len(failures)} ===")
    # Print final summary line to stdout for the wrapper script to forward
    # to Felipe via _notify-felipe.sh (only when something non-zero happened).
    if successes or failures:
        parts = []
        if successes:
            parts.append(f"audited {len(successes)} new BL(s): {', '.join(successes[:5])}")
            if len(successes) > 5:
                parts.append(f"+{len(successes) - 5} more")
        if failures:
            parts.append(f"{len(failures)} skipped (PDF missing / errors)")
        print(" · ".join(parts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
