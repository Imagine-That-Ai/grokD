#!/bin/bash
# Keep Grok Bot D's local box, shim, exec fake, inference proxy, and routine guard alive.
set -u
DURABLE="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
HACK="${GROKBOT_HACK:-$DURABLE/hack}"
NODE="${NODE:-$(command -v node)}"
mkdir -p "$HACK/box-data/agents" "$HACK/box-data/workspace"

if [ -x "$DURABLE/install-runtime.sh" ]; then
  "$DURABLE/install-runtime.sh" "$DURABLE" >/tmp/grokbot-d-install.log 2>&1 || true
fi

# Old scripts hardcode /tmp/grokbot-hack. Recreate that path if reboot wiped /tmp.
if [ ! -e /tmp/grokbot-hack ]; then
  ln -s "$HACK" /tmp/grokbot-hack
elif [ -d /tmp/grokbot-hack ] && [ ! -L /tmp/grokbot-hack ]; then
  rsync -a /tmp/grokbot-hack/ "$HACK/" 2>/dev/null || true
fi

# Prefer durable scripts; keep a copy under /tmp for anything still pointed there.
if [ -d "$DURABLE" ]; then
  for f in proxy2.js runbox.js fakebox.js protoutil.js local-mcp.js bridge-lib.js gateway-shim.js routine-guard.js; do
    if [ -f "$DURABLE/$f" ]; then
      cp "$DURABLE/$f" "$HACK/$f" 2>/dev/null || true
      if [ -d /tmp/grokbot-hack ] && [ ! -L /tmp/grokbot-hack ]; then
        cp "$DURABLE/$f" "/tmp/grokbot-hack/$f" 2>/dev/null || true
      fi
    fi
  done
fi

is_listen() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_listen() {
  local port="$1" n=0
  while [ "$n" -lt 40 ]; do
    is_listen "$port" && return 0
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}

RUN_JS="$DURABLE"
[ -f "$DURABLE/runbox.js" ] || RUN_JS="$HACK"

# Real host on 1338; shim owns 1337 (idle-wait + broadcast retry).
if ! is_listen 1338; then
  nohup env SAND_HOST_PORT=1338 GROKBOT_HACK="$HACK" GROK_HOST_MAIN="${GROK_HOST_MAIN:-$DURABLE/host/host-main.cjs}" "$NODE" "$RUN_JS/runbox.js" >"$HACK/runbox.out" 2>&1 &
  echo "started runbox pid $! (host :1338)"
  wait_listen 1338 || echo "warn: host :1338 not up yet"
fi

if ! is_listen 1337 && [ -f "$RUN_JS/gateway-shim.js" ]; then
  nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/gateway-shim.js" >"$HACK/gateway-shim.out" 2>&1 &
  echo "started gateway-shim pid $! (:1337 -> :1338)"
fi

if ! is_listen 1340 && [ -f "$RUN_JS/fakebox.js" ]; then
  nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/fakebox.js" >"$HACK/fakebox.out" 2>&1 &
  echo "started fakebox pid $!"
fi

if ! is_listen 8787; then
  nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/proxy2.js" 8787 >"$HACK/proxy2.out" 2>&1 &
  echo "started proxy2 pid $!"
fi

if ! pgrep -f "$RUN_JS/routine-guard.js" >/dev/null 2>&1; then
  if [ -f "$RUN_JS/routine-guard.js" ]; then
    nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/routine-guard.js" >"$HACK/routine-guard.out" 2>&1 &
    echo "started routine-guard pid $!"
  fi
fi
