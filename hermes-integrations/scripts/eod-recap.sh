#!/bin/zsh
# End-of-day agent recap — fires at 18:00 weekdays.
# Max queries today across his team and sends Felipe a 1-screen "what
# happened today" digest via WhatsApp.

set -u
export PATH="/Users/maxsmart/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG="$HOME/Library/Logs/hermes-eod-recap.log"
mkdir -p "$(dirname "$LOG")"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TODAY=$(date '+%Y-%m-%d')
DAY=$(date '+%a %b %d')
echo "=== $TS START ===" >> "$LOG"

PROMPT="Produce a tight end-of-day recap of what the AI team accomplished today, for Felipe.

Sources:
- Read today's daily journal note 10 Journal/Daily/${TODAY}.md (via obsidian) — pull section counts for Inbox triage, BL audits queued, Drafts queued.
- Call erp__list_bookings status=AVAILABLE limit=5 — count AVAILABLE bookings.
- Call erp__bookings_with_cutoff_in_days days=2 — count imminent cut-offs.

Format (under 1200 chars):

🌙 *End-of-Day Recap — ${DAY}*

📧 *Inbox today*
- Triage runs: N | New drafts queued: M (awaiting ✅)
- Auto-sent acks: K
- RED items flagged: L

📥 *ERP ingestion today*
- Bookings: B · Invoices: I · BLs: BL · Packing lists: P

🚢 *Shipments*
- AVAILABLE: A bookings | Imminent cut-offs (≤2d): X

🔥 *Needs Felipe by tomorrow*
- <one or two bullets ONLY if anything in RED/queue actually needs Felipe>
- If nothing pressing: \"Nothing urgent.\"

End with DONE on its own line."

/Users/maxsmart/.hermes/hermes-agent/venv/bin/hermes --profile max -z "$PROMPT" >> "$LOG" 2>&1

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) END ===" >> "$LOG"

source /Users/maxsmart/.hermes/scripts/_notify-felipe.sh
SUMMARY=$(tail -50 "$LOG" | awk "/===.*START/{f=1;next}/===.*END/{f=0}f" | head -c 1300)
[ -z "$SUMMARY" ] && exit 0
notify_felipe "Max · EOD recap" "$SUMMARY" force
