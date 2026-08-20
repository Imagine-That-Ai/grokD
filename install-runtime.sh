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
  # Look files the overlay reads from ~/.grok/grokbot-d: provider logos, app icon.
  # --update keeps a newer live edit; never --delete extra local assets.
  if command -v rsync >/dev/null 2>&1; then
    if [ -d "$APP_SRC/assets" ]; then
      mkdir -p "$HOME_DST/assets"
      rsync -a --update "$APP_SRC/assets/" "$HOME_DST/assets/"
    fi
    if [ -d "$APP_SRC/gallery-icons" ]; then
      mkdir -p "$HOME_DST/gallery-icons"
      rsync -a --update "$APP_SRC/gallery-icons/" "$HOME_DST/gallery-icons/"
    fi
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

# Official host-main spawns sibling workers (agent-store-worker, etc).
# Copy the whole host tree — host-main alone makes "Bot failed to respond".
sync_host_tree() {
  local src dest="$HOME_DST/host"
  mkdir -p "$dest"
  for src in "$APP_SRC/host" "/tmp/grokbot-asar/dist/host"; do
    if [ -f "$src/host-main.cjs" ] && [ -f "$src/agent-isolation/agent-store-worker.cjs" ]; then
      rsync -a "$src/" "$dest/"
      return 0
    fi
  done
  local asar=""
  for asar in \
    "$HOME/Applications/grok\"D\".app/Contents/Resources/app.asar" \
    "$HOME/Applications/Grok Bot D.app/Contents/Resources/app.asar" \
    "/Applications/grok\"D\".app/Contents/Resources/app.asar" \
    "/Applications/Grok Bot D.app/Contents/Resources/app.asar"
  do
    [ -f "$asar" ] || continue
    if command -v npx >/dev/null 2>&1; then
      mkdir -p "$dest/agent-isolation" "$dest/extensions/box-store-sync" "$dest/extensions/content-search"
      [ -f "$dest/host-main.cjs" ] || npx --yes asar extract-file "$asar" dist/host/host-main.cjs "$dest/host-main.cjs" 2>/dev/null || true
      npx --yes asar extract-file "$asar" dist/host/agent-isolation/agent-store-worker.cjs "$dest/agent-isolation/agent-store-worker.cjs" 2>/dev/null || true
      npx --yes asar extract-file "$asar" dist/host/agent-isolation/transcript-mirror-worker.cjs "$dest/agent-isolation/transcript-mirror-worker.cjs" 2>/dev/null || true
      npx --yes asar extract-file "$asar" dist/host/extensions/box-store-sync/box-store-vacuum-worker.cjs "$dest/extensions/box-store-sync/box-store-vacuum-worker.cjs" 2>/dev/null || true
      npx --yes asar extract-file "$asar" dist/host/extensions/content-search/search-index-worker.cjs "$dest/extensions/content-search/search-index-worker.cjs" 2>/dev/null || true
    fi
    break
  done
}
sync_host_tree

chmod +x "$HOME_DST"/*.sh 2>/dev/null || true
echo "runtime ready $HOME_DST"
