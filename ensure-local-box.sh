#!/bin/bash
# Keep Grok Bot D's local box, shim, exec fake, inference proxy, and routine guard alive.
set -u
DURABLE="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
HACK="${GROKBOT_HACK:-$DURABLE/hack}"
NODE="${NODE:-$(command -v node)}"
mkdir -p "$HACK/box-data/agents" "$HACK/box-data/workspace"

if [ -z "$(ls -A "$HACK/box-data/agents" 2>/dev/null)" ]; then
  DEFAULT_ID="d0000000-0000-0000-0000-000000000001"
  mkdir -p "$HACK/box-data/agents/$DEFAULT_ID/memory/log"
  cat > "$HACK/box-data/agents/$DEFAULT_ID/profile.json" <<'EOF'
{
  "name": "Local D",
  "description": "Your local AI companion powered by OpenBurnBar",
  "origin": "user"
}
EOF
  echo "{}" > "$HACK/box-data/agents/$DEFAULT_ID/settings.json"
fi

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
  for f in proxy2.js runbox.js fakebox.js protoutil.js local-mcp.js bridge-lib.js gateway-shim.js routine-guard.js openburnbar-proxy.mjs node-deps.js sqlite-ro.js clone-bot.js paths.js; do
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

# host-main.cjs needs tree-sitter from the unpacked Electron app, not a global npm tree.
resolve_node_deps() {
  if [ -n "${GROK_D_NODE_PATH:-}" ] && [ -d "$GROK_D_NODE_PATH" ]; then
    printf '%s\n' "$GROK_D_NODE_PATH"
    return 0
  fi
  local app unpacked
  for app in \
    "$HOME/Applications/grok\"D\".app" \
    "$HOME/Applications/Grok Bot D.app" \
    "$DURABLE/dist/grok\"D\".app" \
    "$DURABLE/dist/Grok Bot D.app" \
    "$DURABLE/dist/Grok Bot.app" \
    "/Applications/Grok Bot D.app" \
    "/Applications/Grok Bot.app" \
    "$HOME/Applications/Grok Bot.app"
  do
    unpacked="$app/Contents/Resources/app.asar.unpacked/dist/deps"
    if [ -d "$unpacked/tree-sitter" ] || [ -d "$unpacked/web-tree-sitter" ]; then
      printf '%s\n' "$unpacked"
      return 0
    fi
  done
  return 1
}

if NODE_DEPS="$(resolve_node_deps)"; then
  if [ -n "${NODE_PATH:-}" ]; then
    export NODE_PATH="$NODE_DEPS:$NODE_PATH"
  else
    export NODE_PATH="$NODE_DEPS"
  fi
fi

if [ "${1:-}" = "--print-node-path" ]; then
  if [ -n "${NODE_PATH:-}" ]; then
    printf '%s\n' "$NODE_PATH"
    exit 0
  fi
  echo "warn: tree-sitter deps not found" >&2
  exit 1
fi

# Real host on 1338; shim owns 1337 (idle-wait + broadcast retry).
# NODE_PATH is exported above so host-main can load tree-sitter.
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

if ! is_listen 8320; then
  if [ -f "$RUN_JS/openburnbar-proxy.mjs" ]; then
    nohup "$NODE" "$RUN_JS/openburnbar-proxy.mjs" --port 8320 >"$HACK/openburnbar-proxy.out" 2>&1 &
    echo "started openburnbar-proxy pid $! (:8320)"
  elif command -v npx >/dev/null 2>&1; then
    nohup npx -y openburnbar@latest proxy --port 8320 --allow-local-key >"$HACK/openburnbar-proxy.out" 2>&1 &
    echo "started openburnbar proxy via npx pid $! (:8320)"
  fi
else
  # Port is taken — make sure it's actually OUR hub, not some other local service.
  IDENTITY="$(curl -s --max-time 1 http://127.0.0.1:8320/api/openburnbar-identity 2>/dev/null || true)"
  case "$IDENTITY" in
    *openburnbar-hub*) : ;; # ours (or a compatible OpenBurnBar install) — all good
    *)
      WHO="$(lsof -nP -iTCP:8320 -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $1" pid "$2}' | head -1)"
      echo "⚠️  WARN: port 8320 is held by ${WHO:-unknown} — NOT the Grok D gateway. Prompts will bypass provider routing." | tee -a "$HACK/openburnbar-proxy.out"
      echo "   Fix: free the port (e.g. TOOLS_BUDGET_PORT=8321 for tools-budget-proxy) or set OPENBURNBAR_PORT, then re-run ensure-local-box.sh." | tee -a "$HACK/openburnbar-proxy.out"
      FALLBACK=8330
      while is_listen "$FALLBACK"; do FALLBACK=$((FALLBACK + 1)); done
      if [ -f "$RUN_JS/openburnbar-proxy.mjs" ]; then
        nohup "$NODE" "$RUN_JS/openburnbar-proxy.mjs" --port "$FALLBACK" >"$HACK/openburnbar-proxy-$FALLBACK.out" 2>&1 &
        echo "started openburnbar-proxy pid $! (fallback :$FALLBACK — point clients here until 8320 is freed)"
      fi
    ;;
  esac
fi

if ! ps aux | grep -q "[r]outine-guard.js"; then
  if [ -f "$RUN_JS/routine-guard.js" ]; then
    nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/routine-guard.js" >"$HACK/routine-guard.out" 2>&1 &
    echo "started routine-guard pid $!"
  fi
fi
