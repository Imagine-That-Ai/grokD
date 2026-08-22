#!/bin/bash
# Deploy this dev checkout into the installed Grok "D" runtime.
#
#   ./deploy.sh              # update ~/.grok/grokbot-d on THIS Mac
#   ./deploy.sh --fleet      # also rsync code to mini and m1pro
#
# Uses `git archive` of HEAD, so ONLY tracked files are copied — user state
# (hack/ chats, model-config.json, profiles.json) can never be touched.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HOME/.grok/grokbot-d"
FLEET=(mini m1pro)

if [ ! -d "$RUNTIME" ]; then
  echo "No runtime at $RUNTIME — run the README one-liner first."
  exit 1
fi

echo "▶ deploy $(git -C "$SRC" rev-parse --short HEAD) → $RUNTIME"
mkdir -p "$RUNTIME/assets"
git -C "$SRC" archive HEAD | tar -x -C "$RUNTIME"
chmod 600 "$RUNTIME/model-config.json" 2>/dev/null || true

if [ "${1:-}" = "--fleet" ]; then
  FILES="$(git -C "$SRC" ls-files)"
  for host in "${FLEET[@]}"; do
    echo "▶ fleet $host"
    tar -C "$SRC" -cf - $FILES | ssh "$host" 'mkdir -p ~/.grok/grokbot-d/assets/lobe && tar -xf - -C ~/.grok/grokbot-d'
    ssh "$host" 'bash ~/.grok/grokbot-d/ensure-local-box.sh' >/dev/null 2>&1 || true
  done
fi

echo "✓ deployed. Restart the app or run ensure-local-box.sh for daemons to pick it up."
