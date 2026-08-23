#!/bin/bash
# Keep Grok Bot D's local box, shim, exec fake, inference proxy, and routine guard alive.
set -u
umask 077
DURABLE="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}"
HACK="${GROKBOT_HACK:-$DURABLE/hack}"
NODE="${NODE:-$(command -v node)}"
# Non-login ssh shells often lack Homebrew/local paths; resolve absolutely.
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  for cand in /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.local/bin/node" "$HOME/.homebrew/bin/node"; do
    [ -x "$cand" ] && { NODE="$cand"; break; }
  done
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "ERROR: Node.js is required to start Grok D's local host" >&2
  exit 1
fi
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
  if ! "$DURABLE/install-runtime.sh" "$DURABLE" >/tmp/grokbot-d-install.log 2>&1; then
    echo "ERROR: Grok D runtime installation is incomplete; see /tmp/grokbot-d-install.log" >&2
    exit 1
  fi
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
  local port="$1" limit="${2:-120}" n=0
  while [ "$n" -lt "$limit" ]; do
    is_listen "$port" && return 0
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}

RUN_JS="$DURABLE"
[ -f "$DURABLE/runbox.js" ] || RUN_JS="$HACK"

gateway_token() {
  if [ -n "${SAND_HOST_GATEWAY_TOKEN:-}" ]; then
    printf '%s\n' "$SAND_HOST_GATEWAY_TOKEN"
    return 0
  fi
  if [ -f "$RUN_JS/security-guard.js" ]; then
    "$NODE" -e "try{process.stdout.write(require(process.argv[1]).getGatewayToken())}catch(e){process.exit(1)}" "$RUN_JS/security-guard.js" 2>/dev/null
    return $?
  fi
  return 1
}

HOST_TOKEN="$(gateway_token 2>/dev/null || true)"

host_api_ready() {
  is_listen 1338 || return 1
  command -v curl >/dev/null 2>&1 || return 0
  [ -n "$HOST_TOKEN" ] || return 1
  curl -fsS --max-time 1 \
    -X POST \
    -H "content-type: application/json" \
    -H "authorization: Bearer $HOST_TOKEN" \
    http://127.0.0.1:1338/api/listAgents \
    -d '{}' >/dev/null 2>&1
}

shim_healthy() {
  is_listen 1337 || return 1
  command -v curl >/dev/null 2>&1 || return 0
  curl -fsS --max-time 1 http://127.0.0.1:1337/health 2>/dev/null \
    | grep -Eq '"service"[[:space:]]*:[[:space:]]*"grok-d-gateway-shim"'
}

wait_ready() {
  local kind="$1" limit="${2:-120}" n=0
  while [ "$n" -lt "$limit" ]; do
    if [ "$kind" = "host" ]; then
      host_api_ready && return 0
    else
      shim_healthy && return 0
    fi
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}

stop_stale_listener() {
  local port="$1" kind="$2" pid cmd n=0
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -n "$pid" ] || return 0
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$kind:$cmd" in
    host:*host-main.cjs*|shim:*gateway-shim.js*)
      echo "restarting stale Grok D $kind listener on :$port (pid $pid)"
      kill "$pid" 2>/dev/null || true
      while [ "$n" -lt 30 ] && is_listen "$port"; do
        sleep 0.1
        n=$((n + 1))
      done
      if is_listen "$port"; then
        echo "ERROR: stale Grok D $kind listener on :$port did not stop" >&2
        return 1
      fi
      ;;
    *)
      echo "ERROR: port $port is occupied by an unhealthy non-Grok-D process: ${cmd:-unknown}" >&2
      return 1
      ;;
  esac
}

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
if is_listen 1338 && ! host_api_ready; then
  stop_stale_listener 1338 host || exit 1
fi
if ! is_listen 1338; then
  nohup env SAND_HOST_PORT=1338 GROKBOT_HACK="$HACK" GROK_HOST_MAIN="${GROK_HOST_MAIN:-$DURABLE/host/host-main.cjs}" "$NODE" "$RUN_JS/runbox.js" >"$HACK/runbox.out" 2>&1 &
  echo "started runbox pid $! (host :1338)"
fi
if ! wait_listen 1338 "${GROK_D_HOST_WAIT_TICKS:-120}" \
  || ! wait_ready host "${GROK_D_HOST_API_WAIT_TICKS:-40}"; then
  echo "ERROR: local host :1338 did not become API-ready" >&2
  tail -n 80 "$HACK/runbox.out" >&2 2>/dev/null || true
  exit 1
fi

if is_listen 1337 && ! shim_healthy; then
  stop_stale_listener 1337 shim || exit 1
fi
if ! is_listen 1337; then
  if [ ! -f "$RUN_JS/gateway-shim.js" ]; then
    echo "ERROR: gateway-shim.js is missing" >&2
    exit 1
  fi
  nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/gateway-shim.js" >"$HACK/gateway-shim.out" 2>&1 &
  echo "started gateway-shim pid $! (:1337 -> :1338)"
fi
if ! wait_listen 1337 "${GROK_D_SHIM_WAIT_TICKS:-120}" \
  || ! wait_ready shim "${GROK_D_SHIM_HEALTH_WAIT_TICKS:-40}"; then
  echo "ERROR: gateway shim :1337 did not become healthy" >&2
  tail -n 80 "$HACK/gateway-shim.out" >&2 2>/dev/null || true
  exit 1
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
    nohup npx -y openburnbar@0.2.0 proxy --port 8320 --allow-local-key >"$HACK/openburnbar-proxy.out" 2>&1 &
    echo "started openburnbar proxy via npx pid $! (:8320)"
  fi
else
  # Port is taken — make sure it's actually OUR hub, and a CURRENT one.
  IDENTITY="$(curl -s --max-time 1 http://127.0.0.1:8320/api/openburnbar-identity 2>/dev/null || true)"
  case "$IDENTITY" in
    *openburnbar-hub*) : ;; # current hub already serving — all good
    *)
      OWNER_PID="$(lsof -ti:8320 -sTCP:LISTEN 2>/dev/null | head -1)"
      OWNER_CMD="$(ps -p "$OWNER_PID" -o command= 2>/dev/null || true)"
      case "$OWNER_CMD" in
        *openburnbar-proxy*)
          # It's an outdated copy of our own hub: converge it to the shipped code.
          echo "restarting outdated openburnbar hub (pid $OWNER_PID) -> current code"
          kill "$OWNER_PID" 2>/dev/null || true
          sleep 1
          nohup "$NODE" "$RUN_JS/openburnbar-proxy.mjs" --port 8320 >"$HACK/openburnbar-proxy.out" 2>&1 &
          echo "restarted openburnbar-proxy pid $! (:8320)"
        ;;
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
    ;;
  esac
fi

if ! ps aux | grep -q "[r]outine-guard.js"; then
  if [ -f "$RUN_JS/routine-guard.js" ]; then
    nohup env GROKBOT_HACK="$HACK" "$NODE" "$RUN_JS/routine-guard.js" >"$HACK/routine-guard.out" 2>&1 &
    echo "started routine-guard pid $!"
  fi
fi
