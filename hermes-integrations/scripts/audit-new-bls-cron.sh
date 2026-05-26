#!/bin/zsh
# Cron wrapper for audit-new-bls.py — runs every hour via launchd.
# Fires the python script, captures its stdout one-line summary, and
# (when non-empty) pings Felipe via the shared notifier so any newly
# audited BLs that landed in 🔴 red surface in WhatsApp immediately.

set -u
export PATH="/Users/maxsmart/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG="$HOME/Library/Logs/hermes-audit-new-bls.log"
mkdir -p "$(dirname "$LOG")"

# The python script writes ONE summary line to stdout, all logging to stderr.
SUMMARY=$(/opt/homebrew/bin/python3 /Users/maxsmart/.hermes/scripts/audit-new-bls.py 2>>"$LOG")

# Echo summary into the log for grep-ability, then exit silently when empty.
if [ -n "$SUMMARY" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) summary: $SUMMARY" >> "$LOG"
  source /Users/maxsmart/.hermes/scripts/_notify-felipe.sh
  notify_felipe "Logan · new BL audits" "$SUMMARY"
fi
