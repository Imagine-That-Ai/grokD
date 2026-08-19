#!/bin/bash
# First-run / update: copy bundled scripts into ~/.grok/grokbot-d.
# Never overwrites profiles.json, profile-data, or secrets.
set -u
HOME_DST="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
APP_SRC="${1:-}"
if [ -z "$APP_SRC" ]; then
  APP_SRC="$(cd "$(dirname "$0")" && pwd)"
  # When launched from the .app, pass Resources/grokbot-d as $1.
fi

mkdir -p "$HOME_DST/hack/box-data/agents" "$HOME_DST/hack/box-data/workspace" "$HOME_DST/host" "$HOME_DST/runtime"
export GROK_PROFILE_ROOT="$HOME_DST"

if [ -d "$APP_SRC" ] && [ "$APP_SRC" != "$HOME_DST" ]; then
  for f in "$APP_SRC"/*.js "$APP_SRC"/*.sh; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in
      test-*.js|live-cursor-chat.js) continue ;;
    esac
    # Never stomp a newer file in ~/.grok (dev + live edits).
    if [ ! -e "$HOME_DST/$base" ] || [ "$f" -nt "$HOME_DST/$base" ]; then
      cp -f "$f" "$HOME_DST/$base"
    fi
  done
  if [ -d "$APP_SRC/splash" ]; then
    mkdir -p "$HOME_DST/splash"
    # Same newer-wins rule as *.js — never stomp a live splash edit.
    for f in "$APP_SRC/splash/"*; do
      [ -e "$f" ] || continue
      base="$(basename "$f")"
      dest="$HOME_DST/splash/$base"
      if [ ! -e "$dest" ] || [ "$f" -nt "$dest" ]; then
        cp -f "$f" "$dest"
      fi
    done
  fi
  if [ ! -f "$HOME_DST/model-config.json" ] && [ -f "$APP_SRC/model-config.json" ]; then
    cp "$APP_SRC/model-config.json" "$HOME_DST/model-config.json"
  fi
fi

if [ ! -f "$HOME_DST/profiles.json" ]; then
  python3 - <<PY
import json, os
from pathlib import Path
p = Path(os.environ.get("GROK_PROFILE_ROOT", Path.home()/".grok"/"grokbot-d")) / "profiles.json"
p.write_text(json.dumps({
  "version": 1,
  "activeId": "local-d",
  "profiles": [{
    "id": "local-d",
    "name": "Local D",
    "kind": "local",
    "color": "#c4b5fd",
    "createdAt": 0,
    "desiredBots": None
  }]
}, indent=2) + "\n")
PY
fi

if [ ! -f "$HOME_DST/active-env.json" ]; then
  printf '%s\n' '{ "mode": "local" }' > "$HOME_DST/active-env.json"
fi

# Keep /tmp/grokbot-hack pointing at durable data after reboot.
if [ ! -e /tmp/grokbot-hack ]; then
  ln -s "$HOME_DST/hack" /tmp/grokbot-hack
elif [ -d /tmp/grokbot-hack ] && [ ! -L /tmp/grokbot-hack ]; then
  rsync -a /tmp/grokbot-hack/ "$HOME_DST/hack/" 2>/dev/null || true
fi

# Extract host-main once so the local box does not depend on /tmp/grokbot-asar.
HOST_DST="$HOME_DST/host/host-main.cjs"
if [ ! -f "$HOST_DST" ]; then
  if [ -f /tmp/grokbot-asar/dist/host/host-main.cjs ]; then
    cp /tmp/grokbot-asar/dist/host/host-main.cjs "$HOST_DST"
  fi
fi

chmod +x "$HOME_DST"/*.sh 2>/dev/null || true
echo "runtime ready $HOME_DST"
