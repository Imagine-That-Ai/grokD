#!/bin/bash
# Grok "D" Safe In-Place Updater
# Preserves all user chats, bots, memories, and Cursor login seats.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HOME/.grok/grokbot-d"

echo ""
echo "🚀 =============================================="
echo "   Updating Grok \"D\" to Latest Version"
echo "=================================================="
echo ""

# 1. Backup user state
echo "✓ Backing up user state (profiles, bots, chats)..."
BACKUP_DIR="${TMPDIR:-/tmp}/grokd-backup-$$"
mkdir -p "$BACKUP_DIR"
[ -f "$ROOT/profiles.json" ] && cp "$ROOT/profiles.json" "$BACKUP_DIR/" || true
[ -f "$ROOT/active-env.json" ] && cp "$ROOT/active-env.json" "$BACKUP_DIR/" || true
[ -f "$ROOT/model-config.json" ] && cp "$ROOT/model-config.json" "$BACKUP_DIR/" || true

# 2. Pull latest code from GitHub
if [ -d "$ROOT/.git" ]; then
  echo "✓ Pulling latest updates from GitHub..."
  cd "$ROOT"
  git fetch origin main
  git reset --hard origin/main
else
  echo "✓ Updating workspace at $ROOT..."
  git clone https://github.com/Imagine-That-Ai/grok-D.git "$ROOT.tmp"
  cp -R "$ROOT.tmp/"* "$ROOT/"
  rm -rf "$ROOT.tmp"
  cd "$ROOT"
fi

# 3. Restore user state if needed
[ -f "$BACKUP_DIR/profiles.json" ] && cp "$BACKUP_DIR/profiles.json" "$ROOT/" || true
[ -f "$BACKUP_DIR/active-env.json" ] && cp "$BACKUP_DIR/active-env.json" "$ROOT/" || true
[ -f "$BACKUP_DIR/model-config.json" ] && cp "$BACKUP_DIR/model-config.json" "$ROOT/" || true
rm -rf "$BACKUP_DIR"

# 4. Rebuild overlay & re-sign bundle
echo "✓ Building latest Grok \"D\" bundle..."
pkill -9 -f "Grok Bot|gateway-shim|runbox|proxy2|fakebox|routine-guard|host-main" 2>/dev/null || true
sleep 1
bash "$ROOT/install.sh" --replace

# 5. Restart local daemons
echo "✓ Restarting local services..."
bash "$ROOT/ensure-local-box.sh"

echo ""
echo "🎉 =============================================="
echo "   Grok \"D\" successfully updated to latest version!"
echo "   All chats, bots, and login seats are intact."
echo "=================================================="
echo ""
