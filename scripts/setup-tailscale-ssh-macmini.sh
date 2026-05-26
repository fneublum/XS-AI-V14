#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-tailscale-ssh-macmini.sh
# Run this on the Mac mini to enable Tailscale SSH so the M5 can connect.
# Usage:  bash setup-tailscale-ssh-macmini.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        Tailscale SSH Setup — Mac Mini                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Check Tailscale is installed ──────────────────────────────────────────
if ! command -v tailscale &>/dev/null; then
  echo "❌  Tailscale is not installed."
  echo "    Install it from: https://tailscale.com/download/mac"
  exit 1
fi
echo "✅  Tailscale found: $(tailscale version | head -1)"

# ── 2. Check Tailscale is running and connected ───────────────────────────────
STATUS=$(tailscale status 2>&1)
if echo "$STATUS" | grep -q "Tailscale is stopped"; then
  echo "⚠️   Tailscale is stopped. Starting..."
  sudo tailscale up
fi
echo "✅  Tailscale is connected"
echo "$STATUS" | head -5

# ── 3. Enable Tailscale SSH ───────────────────────────────────────────────────
echo ""
echo "🔐  Enabling Tailscale SSH..."
sudo tailscale up --ssh --accept-risk=lose-ssh
echo "✅  Tailscale SSH enabled"

# ── 4. Verify SSH is active ───────────────────────────────────────────────────
echo ""
SSH_STATE=$(tailscale debug prefs 2>/dev/null | grep -i '"RunSSH"' || echo "unknown")
echo "SSH state: $SSH_STATE"

# ── 5. Print connection info ──────────────────────────────────────────────────
HOSTNAME=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))" 2>/dev/null || hostname)
IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
USER=$(whoami)

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅  Tailscale SSH is ready!                         ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  From M5, connect with:                              ║"
echo "║                                                      ║"
printf  "║    tailscale ssh %s@%s\n" "$USER" "$IP"
echo "║                                                      ║"
echo "║  Or using hostname:                                  ║"
printf  "║    tailscale ssh %s@%s\n" "$USER" "$HOSTNAME"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
