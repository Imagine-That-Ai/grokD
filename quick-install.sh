#!/bin/bash
# Grok "D" Universal Zero-Friction Installer for Any Mac
# Usage: curl -fsSL https://raw.githubusercontent.com/Imagine-That-Ai/grokD/main/quick-install.sh | bash
set -euo pipefail

echo ""
echo "🚀 =============================================="
echo "   Grok \"D\" Universal Installer for macOS"
echo "   Local AI Workspace & Multi-Bot Fleet on Your Mac"
echo "=================================================="
echo ""

# 1. OS & Architecture Check
OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
  echo "❌ Error: Grok \"D\" is designed for macOS (Apple Silicon or Intel)." >&2
  exit 1
fi
ARCH="$(uname -m)"
echo "✓ macOS detected ($ARCH architecture)"

# 2. Dependency Checks: Node.js, Python3, Git
if ! command -v git >/dev/null 2>&1; then
  echo "⚠️  Git is required. Triggering Command Line Tools install..."
  xcode-select --install || true
  echo "Please complete the Apple Developer tools prompt, then re-run this installer."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ Error: python3 is required for plist and asar manipulation." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  Node.js not found in PATH. Checking standard Homebrew paths..."
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.homebrew/bin"; do
    if [ -x "$p/node" ]; then
      export PATH="$p:$PATH"
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  Node.js is required. If you have Homebrew, install via 'brew install node'."
  echo "Or download the official macOS installer from https://nodejs.org"
  exit 1
fi
echo "✓ Node.js $(node -v) & Python3 $(python3 -V 2>&1 | awk '{print $2}') verified"

# 3. Clone or Update Grok-D Workspace
GROK_ROOT="$HOME/.grok/grokbot-d"
REPO_URL="https://github.com/Imagine-That-Ai/grokD.git"
PINNED_REF="${GROK_PINNED_REF:-main}"

if [ -d "$GROK_ROOT/.git" ]; then
  echo "✓ Updating existing Grok \"D\" workspace at $GROK_ROOT..."
  cd "$GROK_ROOT"
  git fetch origin "$PINNED_REF"
  git checkout "$PINNED_REF" 2>/dev/null || git reset --hard "origin/$PINNED_REF"
else
  echo "✓ Cloning Grok \"D\" workspace to $GROK_ROOT (ref: $PINNED_REF)..."
  mkdir -p "$(dirname "$GROK_ROOT")"
  rm -rf "$GROK_ROOT" 2>/dev/null || true
  if ! git -c credential.helper= clone --depth=1 --branch "$PINNED_REF" "$REPO_URL" "$GROK_ROOT"; then
    echo "ERROR: Failed to clone ref $PINNED_REF from $REPO_URL" >&2
    exit 1
  fi
  cd "$GROK_ROOT"
fi

# 4. Check for Official Grok Bot.app Base
SRC=""
for c in "/Applications/Grok Bot.app" "$HOME/Applications/Grok Bot.app"; do
  if [ -d "$c" ]; then SRC="$c"; break; fi
done

if [ -z "$SRC" ]; then
  cat <<'EOF' >&2

========================================================================
⚠️  Whoops! You don't have Grok Bot installed yet — you need that!

Grok "D" supercharges the official desktop app with local AI models,
multi-account Cursor seats, and the OpenBurnBar AI gateway.

👉 Download the official Grok Bot app here:
   https://grok.com/
   (or https://x.ai/grok)

Once downloaded and moved to /Applications/Grok Bot.app, run this 1-liner again:
   git -c credential.helper= clone --depth=1 https://github.com/Imagine-That-Ai/grokD.git ~/.grok/grokbot-d && bash ~/.grok/grokbot-d/install.sh --replace
========================================================================

EOF
  exit 1
fi
echo "✓ Found official Grok Bot base at $SRC"

# 5. Build and Sign Grok "D"
echo "✓ Building Grok \"D\" overlay and signing bundle..."
bash "$GROK_ROOT/install.sh" --replace --src "$SRC"

# 6. Ensure Daemons & Launch App
echo "✓ Initializing local background services..."
bash "$GROK_ROOT/ensure-local-box.sh"

echo ""
echo "🎉 =============================================="
echo "   Grok \"D\" successfully installed and launched!"
echo "   App Location: $HOME/Applications/Grok Bot D.app"
echo "=================================================="
echo ""
