#!/bin/zsh
# Daily cargo cut-off briefing — fires at 8:00 weekdays.
# Logan agent queries the erp MCP and sends Felipe a WhatsApp summary.
#
# Companion to the other daily briefings (max-morning-briefing at 7:00,
# logan-shipment-ops at 8:00). This one is shipper-focused: which bookings
# need attention TODAY because cut-off is overdue or imminent.

set -u
export PATH="/Users/maxsmart/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG="$HOME/Library/Logs/hermes-cutoff-briefing.log"
mkdir -p "$(dirname "$LOG")"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== $TS START ===" >> "$LOG"

PROMPT="Call erp__bookings_with_cutoff_in_days with days=7. Format the JSON result as a WhatsApp message under 1500 chars. Headline: \"📋 Cut-off briefing — $(date '+%a %b %d')\". For each overdue booking: \"⚠️ #bookingNumber · customer · POL→POD · cut-off: DATE\". For each upcoming: \"📅 #bookingNumber · customer · cut-off: DATE (ETD: DATE)\". Footer: \"Overdue: N · Upcoming 7d: M\". If both lists are empty, reply \"[SILENT]\" exactly. Reply with the WhatsApp message only, no extra prose."

/Users/maxsmart/.hermes/hermes-agent/venv/bin/hermes --profile logan -z "$PROMPT" >> "$LOG" 2>&1

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) END ===" >> "$LOG"

# Notify Felipe with smart-filtered summary
source /Users/maxsmart/.hermes/scripts/_notify-felipe.sh
SUMMARY=$(tail -50 "$LOG" | awk "/===.*START/{f=1;next}/===.*END/{f=0}f" | head -c 1400)
[ -z "$SUMMARY" ] && exit 0
notify_felipe "Logan · cut-off briefing" "$SUMMARY" force
