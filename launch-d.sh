#!/bin/bash
# First-launch wrapper inside Grok Bot D.app. Never touches official B or C.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DST="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
USER_DATA="${GROK_SEAT4:-$HOME/Library/Application Support/GrokBotSeat4}"
BUNDLE_RT="$DIR/../Resources/grokbot-d"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
export GROK_PROFILE_ROOT="$HOME_DST"

INSTALL_LOG="${GROK_D_INSTALL_LOG:-/tmp/grokbot-d-install.log}"
if mkdir -p "$HOME_DST/runtime" 2>/dev/null; then
  STARTUP_LOG="${GROK_D_STARTUP_LOG:-$HOME_DST/runtime/startup.log}"
  ENSURE_LOG="${GROK_D_ENSURE_LOG:-$HOME_DST/runtime/ensure-local-box.log}"
else
  STARTUP_LOG="${GROK_D_STARTUP_LOG:-/tmp/grokbot-d-startup.log}"
  ENSURE_LOG="${GROK_D_ENSURE_LOG:-/tmp/grokbot-d-ensure-local-box.log}"
fi

startup_fail() {
  local reason="$1" source_log="${2:-}"
  {
    printf '\n[%s] STARTUP FAILED: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$reason"
    if [ -n "$source_log" ] && [ -f "$source_log" ]; then
      printf '%s\n' "--- ${source_log} (last 100 lines) ---"
      tail -n 100 "$source_log"
    fi
  } >>"$STARTUP_LOG" 2>&1
  printf 'grok"D" could not start: %s\nDiagnostics: %s\n' "$reason" "$STARTUP_LOG" >&2
  if [ "${GROK_D_NO_ALERT:-0}" != "1" ] && [ -x /usr/bin/osascript ]; then
    /usr/bin/osascript - "$reason" "$STARTUP_LOG" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set reasonText to item 1 of argv
  set logPath to item 2 of argv
  display alert "grok\"D\" could not start" message (reasonText & return & return & "Quit the app, verify Node.js is installed, then reinstall or update grok\"D\"." & return & "Diagnostics: " & logPath) as critical buttons {"Quit"} default button "Quit"
end run
APPLESCRIPT
  fi
  exit 1
}

NODE_BIN=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node" "$HOME/.homebrew/bin/node"; do
  if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
done
[ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1 && NODE_BIN="$(command -v node)"
export NODE="$NODE_BIN"

if [ -x "$BUNDLE_RT/install-runtime.sh" ]; then
  if ! "$BUNDLE_RT/install-runtime.sh" "$BUNDLE_RT" >"$INSTALL_LOG" 2>&1; then
    startup_fail "The local runtime could not be installed completely." "$INSTALL_LOG"
  fi
elif [ -x "$HOME_DST/install-runtime.sh" ]; then
  if ! "$HOME_DST/install-runtime.sh" "$HOME_DST" >"$INSTALL_LOG" 2>&1; then
    startup_fail "The local runtime could not be repaired completely." "$INSTALL_LOG"
  fi
else
  startup_fail "The packaged runtime installer is missing."
fi

ENV_FILE="$HOME_DST/active-env.json"
MODE="local"
if [ -f "$ENV_FILE" ]; then
  if [ -n "$NODE_BIN" ]; then
    MODE=$("$NODE_BIN" -e "try{const m=require(process.argv[1]).mode;console.log(m||'local')}catch(e){console.log('local')}" "$ENV_FILE" 2>/dev/null || echo local)
  elif [ -x /usr/bin/python3 ]; then
    MODE=$(/usr/bin/python3 -c "import json; print(json.load(open('$ENV_FILE')).get('mode','local'))" 2>/dev/null || echo local)
  else
    MODE=$(grep -o '"mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    [ -z "$MODE" ] && MODE="local"
  fi
fi
if [ "$MODE" = "local" ]; then
  if [ -z "$NODE_BIN" ]; then
    startup_fail "Node.js is required for This Mac mode."
  fi
  export SAND_HOST_GATEWAY_URL="${SAND_HOST_GATEWAY_URL:-http://127.0.0.1:1337}"
  export SAND_HOST_GATEWAY_TOKEN="${SAND_HOST_GATEWAY_TOKEN:-fake-gateway-token}"
  export SAND_BACKEND_URL="${SAND_BACKEND_URL:-http://127.0.0.1:8787}"
  if [ ! -f "$HOME_DST/ensure-local-box.sh" ]; then
    startup_fail "The local-box startup script is missing."
  fi
  if ! bash "$HOME_DST/ensure-local-box.sh" >"$ENSURE_LOG" 2>&1; then
    startup_fail "The local host or gateway did not become ready." "$ENSURE_LOG"
  fi
else
  unset SAND_HOST_GATEWAY_URL
  unset SAND_HOST_GATEWAY_TOKEN
  unset SAND_BACKEND_URL
  if [ -n "$NODE_BIN" ] && [ -f "$HOME_DST/repair-active-box.js" ]; then
    mkdir -p "$HOME_DST/runtime"
    "$NODE_BIN" "$HOME_DST/repair-active-box.js" >>"$HOME_DST/runtime/repair.log" 2>&1 || true
  fi
fi

ASAR="$DIR/../Resources/app.asar"
HOOK_OK=1
if [ -f "$ASAR" ]; then
  if command -v grep >/dev/null && grep -a -q -F "profile-ui-inject.js" "$ASAR"; then
    HOOK_OK=1
  elif command -v python3 >/dev/null && python3 - "$ASAR" <<'PY'
import sys, pathlib
sys.exit(0 if b"profile-ui-inject.js" in pathlib.Path(sys.argv[1]).read_bytes() else 1)
PY
  then
    HOOK_OK=1
  else
    HOOK_OK=0
  fi
  mkdir -p "$HOME_DST/runtime" 2>/dev/null || true
  if [ "$HOOK_OK" -eq 1 ]; then
    printf '%s\n' '{"ok": true, "hook": "present"}' >"$HOME_DST/runtime/overlay-status.json" 2>/dev/null || true
  else
    printf '%s\n' '{"ok": false, "hook": "missing"}' >"$HOME_DST/runtime/overlay-status.json" 2>/dev/null || true
    echo "overlay hook missing from asar — run install.sh" >>"$HOME_DST/runtime/overlay-status.log" 2>/dev/null || true
    if [ -x "$HOME_DST/repair-overlay.sh" ]; then
      "$HOME_DST/repair-overlay.sh" "$DIR/../.." >>"$HOME_DST/runtime/overlay-repair.log" 2>&1 || true
    fi
  fi
fi

CDP="${GROK_D_CDP:-}"
if [ -z "$CDP" ] && [ -f "$HOME_DST/runtime/cdp.port" ]; then
  CDP=$(tr -d '[:space:]' <"$HOME_DST/runtime/cdp.port")
fi

if [ ! -x "$DIR/Grok Bot.real" ]; then
  startup_fail "The Grok Bot executable is missing from this app."
fi

if [ -n "$CDP" ] && [ "$CDP" != "0" ]; then
  exec "$DIR/Grok Bot.real" --user-data-dir="$USER_DATA" --remote-debugging-port="$CDP" "$@"
fi
exec "$DIR/Grok Bot.real" --user-data-dir="$USER_DATA" "$@"
