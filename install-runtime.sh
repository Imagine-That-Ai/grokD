#!/bin/bash
# First-run / update: copy bundled scripts into ~/.grok/grokbot-d.
# Never overwrites profiles.json, profile-data, or secrets.
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DST="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
APP_SRC="${1:-}"
if [ -z "$APP_SRC" ]; then
  APP_SRC="$SCRIPT_DIR"
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
HOST_FILES=(
  "host-main.cjs"
  "agent-isolation/agent-store-worker.cjs"
  "agent-isolation/transcript-mirror-worker.cjs"
  "extensions/box-store-sync/box-store-vacuum-worker.cjs"
  "extensions/content-search/search-index-worker.cjs"
)

host_tree_complete() {
  local root="$1" rel
  for rel in "${HOST_FILES[@]}"; do
    [ -s "$root/$rel" ] || return 1
  done
  return 0
}

missing_host_files() {
  local root="$1" rel missing=""
  for rel in "${HOST_FILES[@]}"; do
    [ -s "$root/$rel" ] || missing="${missing}${missing:+, }$rel"
  done
  printf '%s\n' "$missing"
}

find_app_asar() {
  local candidate
  if [ -n "${GROK_D_APP_ASAR:-}" ]; then
    if [ -f "$GROK_D_APP_ASAR" ] && [ ! -L "$GROK_D_APP_ASAR" ]; then
      case "$GROK_D_APP_ASAR" in
        */Contents/Resources/app.asar|*/app.asar)
          printf '%s\n' "$GROK_D_APP_ASAR"
          return 0
          ;;
        *)
          echo "install-runtime: untrusted GROK_D_APP_ASAR path rejected: $GROK_D_APP_ASAR" >&2
          return 1
          ;;
      esac
    else
      echo "install-runtime: specified GROK_D_APP_ASAR does not exist or is a symlink: $GROK_D_APP_ASAR" >&2
      return 1
    fi
  fi

  for candidate in \
    "$APP_SRC/../app.asar" \
    "$HOME/Applications/grok\"D\".app/Contents/Resources/app.asar" \
    "$HOME/Applications/Grok Bot D.app/Contents/Resources/app.asar" \
    "/Applications/grok\"D\".app/Contents/Resources/app.asar" \
    "/Applications/Grok Bot D.app/Contents/Resources/app.asar"
  do
    if [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_node() {
  local candidate
  if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
    printf '%s\n' "$NODE"
    return 0
  fi
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.local/bin/node" \
    "$HOME/.homebrew/bin/node"
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  command -v node 2>/dev/null || return 1
}

resolve_asar_helper() {
  local candidate
  for candidate in "$APP_SRC/asar-file.js" "$SCRIPT_DIR/asar-file.js" "$HOME_DST/asar-file.js"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

sync_host_tree() {
  local src="$APP_SRC/host" dest="$HOME_DST/host" asar="" node_bin="" helper="" entry="" i
  mkdir -p "$dest"

  if host_tree_complete "$src"; then
    if [ "$src" != "$dest" ]; then
      rsync -a "$src/" "$dest/"
    fi
    if ! host_tree_complete "$dest"; then
      echo "install-runtime: bundled host tree became incomplete: $(missing_host_files "$dest")" >&2
      return 1
    fi
    return 0
  fi

  if asar="$(find_app_asar)"; then
    if ! node_bin="$(resolve_node)"; then
      echo "install-runtime: Node.js is required to recover the local host from app.asar" >&2
      return 1
    fi
    if ! helper="$(resolve_asar_helper)"; then
      echo "install-runtime: asar-file.js is missing from the packaged runtime" >&2
      return 1
    fi
    mkdir -p "$dest/agent-isolation" "$dest/extensions/box-store-sync" "$dest/extensions/content-search"
    for i in "${!HOST_FILES[@]}"; do
      entry="dist/host/${HOST_FILES[$i]}"
      if ! "$node_bin" "$helper" extract-file "$asar" "$entry" "$dest/${HOST_FILES[$i]}"; then
        echo "install-runtime: failed to extract $entry from $asar" >&2
        return 1
      fi
    done
  elif host_tree_complete "$dest"; then
    return 0
  else
    echo "install-runtime: no usable app.asar and no complete local host tree" >&2
    return 1
  fi

  if ! host_tree_complete "$dest"; then
    echo "install-runtime: local host tree is incomplete: $(missing_host_files "$dest")" >&2
    return 1
  fi
  return 0
}

if ! sync_host_tree; then
  echo "install-runtime: runtime is NOT ready at $HOME_DST" >&2
  exit 1
fi

chmod +x "$HOME_DST"/*.sh 2>/dev/null || true
echo "runtime ready $HOME_DST"
