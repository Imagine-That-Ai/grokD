#!/bin/bash
# First-launch wrapper inside Grok Bot D.app. Never touches official B or C.
DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DST="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
USER_DATA="${GROK_SEAT4:-$HOME/Library/Application Support/GrokBotSeat4}"
BUNDLE_RT="$DIR/../Resources/grokbot-d"

if [ -x "$BUNDLE_RT/install-runtime.sh" ]; then
  "$BUNDLE_RT/install-runtime.sh" "$BUNDLE_RT" >/tmp/grokbot-d-install.log 2>&1 || true
elif [ -x "$HOME_DST/install-runtime.sh" ]; then
  "$HOME_DST/install-runtime.sh" "$HOME_DST" >/tmp/grokbot-d-install.log 2>&1 || true
fi

ENV_FILE="$HOME_DST/active-env.json"
MODE="local"
if [ -f "$ENV_FILE" ]; then
  MODE=$(python3 -c "import json; print(json.load(open('$ENV_FILE')).get('mode','local'))" 2>/dev/null || echo local)
fi
if [ "$MODE" = "local" ]; then
  export SAND_HOST_GATEWAY_URL="${SAND_HOST_GATEWAY_URL:-http://127.0.0.1:1337}"
  export SAND_HOST_GATEWAY_TOKEN="${SAND_HOST_GATEWAY_TOKEN:-fake-gateway-token}"
  export SAND_BACKEND_URL="${SAND_BACKEND_URL:-http://127.0.0.1:8787}"
  if [ -x "$HOME_DST/ensure-local-box.sh" ]; then
    "$HOME_DST/ensure-local-box.sh" >/tmp/grokbot-hack/ensure-local-box.log 2>&1 || true
  fi
else
  unset SAND_HOST_GATEWAY_URL
  unset SAND_HOST_GATEWAY_TOKEN
  unset SAND_BACKEND_URL
  NODE_BIN=""
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.homebrew/bin/node"; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
  if [ -n "$NODE_BIN" ] && [ -f "$HOME_DST/repair-active-box.js" ]; then
    mkdir -p "$HOME_DST/runtime"
    "$NODE_BIN" "$HOME_DST/repair-active-box.js" >>"$HOME_DST/runtime/repair.log" 2>&1 || true
  fi
fi

ASAR="$DIR/../Resources/app.asar"
if [ -f "$ASAR" ] && ! python3 - "$ASAR" "$HOME_DST" <<'PY'
import sys, pathlib
asar, root = sys.argv[1], sys.argv[2]
ok = b"profile-ui-inject.js" in pathlib.Path(asar).read_bytes()
pathlib.Path(root, "runtime").mkdir(parents=True, exist_ok=True)
pathlib.Path(root, "runtime", "overlay-status.json").write_text(
    ('{"ok": true, "hook": "present"}\n' if ok else '{"ok": false, "hook": "missing"}\n')
)
sys.exit(0 if ok else 1)
PY
then
  echo "overlay hook missing from asar — run install.sh" >>"$HOME_DST/runtime/overlay-status.log" 2>/dev/null || true
  if [ -x "$HOME_DST/repair-overlay.sh" ]; then
    "$HOME_DST/repair-overlay.sh" "$DIR/../.." >>"$HOME_DST/runtime/overlay-repair.log" 2>&1 || true
  fi
fi

EXTRA=()
if [ "${GROK_D_CDP:-9224}" != "0" ]; then
  EXTRA+=(--remote-debugging-port="${GROK_D_CDP:-9224}")
fi

exec "$DIR/Grok Bot.real" --user-data-dir="$USER_DATA" "${EXTRA[@]}" "$@"
