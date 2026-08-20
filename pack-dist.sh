#!/bin/bash
# Build a shareable Grok Bot D.app. Does not copy anyone's chats or tokens.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC_APP="${1:-$HOME/Applications/Grok Bot D.app}"
DEST="${2:-$ROOT/dist/Grok Bot D.app}"

if [ ! -d "$SRC_APP" ]; then
  echo "missing app: $SRC_APP" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
ditto "$SRC_APP" "$DEST"

RT="$DEST/Contents/Resources/grokbot-d"
mkdir -p "$RT"
for f in \
  paths.js box-state.js profile-store.js switch-profile.js relaunch-d.js \
  profile-auth-preload.js profile-ui-inject.js seed-cursor-box.js \
  bubble-rim.js provider-logos.js glass-theme.js \
  account-identity.js browser-login.js patch-open-external.js \
  model-lib.js model-config.json command-client.js cdp-eval.js \
  runbox.js gateway-shim.js proxy2.js fakebox.js protoutil.js \
  bridge-lib.js local-mcp.js routine-guard.js \
  onboard-accounts.js bot-pause.js failover.js failover-act.js \
  failover-watch.js fallover-ui.js clone-bot.js handoff-pack.js \
  seat-quota.js create-bot-hook.js takeover-local.js bot-chatter.js \
  space-kernel.js space-field-gl.js liquid-metal-mark.js cursor-model-bubble.js \
  plasma-selectors.js plasma-selectors.css \
  node-deps.js sqlite-ro.js \
  ensure-local-box.sh install-runtime.sh pack-asar.sh patch-asar.sh patch-asar.js \
  repair-overlay.sh \
  sync-to-tmp.sh
 do
  [ -e "$ROOT/$f" ] || continue
  cp "$ROOT/$f" "$RT/$f"
done
mkdir -p "$RT/splash"
[ -d "$ROOT/splash" ] && cp -R "$ROOT/splash/." "$RT/splash/"
if [ -d "$ROOT/host/agent-isolation" ]; then
  mkdir -p "$RT/host"
  rsync -a --exclude 'host-main.cjs' "$ROOT/host/" "$RT/host/"
fi

# Starter files only — never ship this machine's profiles or secrets.
cat > "$RT/profiles.starter.json" <<'JSON'
{
  "version": 1,
  "activeId": "local-d",
  "profiles": [
    {
      "id": "local-d",
      "name": "Local D",
      "kind": "local",
      "color": "#c4b5fd",
      "createdAt": 0,
      "desiredBots": null
    }
  ]
}
JSON
printf '%s\n' '{ "mode": "local" }' > "$RT/active-env.starter.json"
cp "$ROOT/INSTALL.md" "$DEST/../INSTALL.md" 2>/dev/null || true

# Drop debug leftovers from the copied user-data? none in the app.
chmod +x "$DEST/Contents/MacOS/Grok Bot" "$RT"/*.sh 2>/dev/null || true
codesign --force --sign - "$DEST" >/tmp/grokbot-d-dist-codesign.out 2>&1 || true

echo "packed $DEST"
echo "scripts $(ls "$RT" | wc -l | tr -d ' ')"
echo "asar $(ls -l "$DEST/Contents/Resources/app.asar" | awk '{print $5}')"
