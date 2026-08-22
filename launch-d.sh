#!/bin/bash
# First-launch wrapper inside Grok Bot D.app. Never touches official B or C.
DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DST="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
USER_DATA="${GROK_SEAT4:-$HOME/Library/Application Support/GrokBotSeat4}"
BUNDLE_RT="$DIR/../Resources/grokbot-d"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
export GROK_PROFILE_ROOT="$HOME_DST"

NODE_BIN=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.homebrew/bin/node"; do
  if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
done
[ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1 && NODE_BIN="$(command -v node)"
export NODE="$NODE_BIN"

if [ -x "$BUNDLE_RT/install-runtime.sh" ]; then
  "$BUNDLE_RT/install-runtime.sh" "$BUNDLE_RT" >/tmp/grokbot-d-install.log 2>&1 || true
elif [ -x "$HOME_DST/install-runtime.sh" ]; then
  "$HOME_DST/install-runtime.sh" "$HOME_DST" >/tmp/grokbot-d-install.log 2>&1 || true
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
  export SAND_HOST_GATEWAY_URL="${SAND_HOST_GATEWAY_URL:-http://127.0.0.1:1337}"
  export SAND_HOST_GATEWAY_TOKEN="${SAND_HOST_GATEWAY_TOKEN:-fake-gateway-token}"
  export SAND_BACKEND_URL="${SAND_BACKEND_URL:-http://127.0.0.1:8787}"
  if [ -f "$HOME_DST/ensure-local-box.sh" ]; then
    bash "$HOME_DST/ensure-local-box.sh" >/tmp/grokbot-hack/ensure-local-box.log 2>&1 || true
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

EXTRA=()
CDP="${GROK_D_CDP:-}"
if [ -z "$CDP" ] && [ -f "$HOME_DST/runtime/cdp.port" ]; then
  CDP=$(tr -d '[:space:]' <"$HOME_DST/runtime/cdp.port")
fi
if [ -n "$CDP" ] && [ "$CDP" != "0" ]; then
  EXTRA+=(--remote-debugging-port="$CDP")
fi

exec "$DIR/Grok Bot.real" --user-data-dir="$USER_DATA" "${EXTRA[@]}" "$@"
