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

OVERLAY_SRC="$ROOT"
CLEAN_DIR=""
if [ -x "$ROOT/export-public.sh" ]; then
  CLEAN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/grokD-dist-src.XXXXXX")"
  bash "$ROOT/export-public.sh" "$CLEAN_DIR"
  OVERLAY_SRC="$CLEAN_DIR"
fi
trap 'if [ -n "$CLEAN_DIR" ]; then rm -rf "$CLEAN_DIR"; fi' EXIT

RT="$DEST/Contents/Resources/grokbot-d"
mkdir -p "$RT"
chmod 0700 "$RT"
for f in \
  paths.js box-state.js profile-store.js switch-profile.js relaunch-d.js \
  profile-auth-preload.js profile-ui-inject.js seed-cursor-box.js \
  bubble-rim.js provider-logos.js glass-theme.js \
  account-identity.js browser-login.js patch-open-external.js \
  model-lib.js security-guard.js command-client.js cdp-eval.js \
  runbox.js gateway-shim.js proxy2.js fakebox.js protoutil.js \
  bridge-lib.js local-mcp.js routine-guard.js \
  onboard-accounts.js bot-pause.js failover.js failover-act.js \
  failover-watch.js fallover-ui.js clone-bot.js handoff-pack.js \
  seat-quota.js create-bot-hook.js takeover-local.js bot-chatter.js \
  space-kernel.js space-field-gl.js liquid-metal-mark.js cursor-model-bubble.js \
  plasma-selectors.js plasma-selectors.css \
  node-deps.js sqlite-ro.js \
  asar-file.js asar-cli.sh \
  ensure-local-box.sh install-runtime.sh launch-d.sh pack-asar.sh patch-asar.sh patch-asar.js \
  repair-overlay.sh \
  sync-to-tmp.sh
 do
  [ -e "$OVERLAY_SRC/$f" ] || continue
  cp "$OVERLAY_SRC/$f" "$RT/$f"
done
mkdir -p "$RT/splash"
[ -d "$OVERLAY_SRC/splash" ] && cp -R "$OVERLAY_SRC/splash/." "$RT/splash/"
if [ -d "$OVERLAY_SRC/assets" ]; then
  mkdir -p "$RT/assets"
  rsync -a \
    --exclude 'meshy_elon.glb' \
    --exclude 'meshy_elon_textured.glb' \
    "$OVERLAY_SRC/assets/" "$RT/assets/"
fi
if [ -d "$OVERLAY_SRC/gallery-icons" ]; then
  mkdir -p "$RT/gallery-icons"
  rsync -a "$OVERLAY_SRC/gallery-icons/" "$RT/gallery-icons/"
fi
if [ -f "$ROOT/assets/grokd-icon.icns" ]; then
  cp "$ROOT/assets/grokd-icon.icns" "$DEST/Contents/Resources/icon.icns"
  cp "$ROOT/assets/grokd-icon.icns" "$DEST/Contents/Resources/app.icns" 2>/dev/null || true
fi
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
cat > "$RT/model-config.starter.json" <<'JSON'
{
  "proxyTarget": "openburnbar",
  "apiKey": "",
  "model": "grok-4.6",
  "cursorAccount": "Primary Cursor Account"
}
JSON
printf '%s\n' '{ "mode": "local" }' > "$RT/active-env.starter.json"
chmod 0600 "$RT"/*.json 2>/dev/null || true
cp "$ROOT/INSTALL.md" "$DEST/../INSTALL.md" 2>/dev/null || true

# Sanity check: ensure no private secrets or live model-config.json exist in RT
if [ -f "$RT/model-config.json" ]; then
  echo "ERROR: live model-config.json found in dist runtime directory!" >&2
  exit 1
fi

for required in asar-file.js asar-cli.sh install-runtime.sh ensure-local-box.sh launch-d.sh; do
  if [ ! -f "$RT/$required" ]; then
    echo "ERROR: packaged runtime is missing $required" >&2
    exit 1
  fi
done
BIN="$DEST/Contents/MacOS/Grok Bot"
REAL="$DEST/Contents/MacOS/Grok Bot.real"
if [ ! -x "$REAL" ]; then
  echo "ERROR: source app is not an installed Grok D app (missing Grok Bot.real)" >&2
  exit 1
fi
cp "$RT/launch-d.sh" "$BIN"
node - "$RT/asar-file.js" "$DEST/Contents/Resources/app.asar" <<'NODE'
const helper = require(process.argv[2]);
const archive = process.argv[3];
for (const entry of [
  "dist/host/host-main.cjs",
  "dist/host/agent-isolation/agent-store-worker.cjs",
  "dist/host/agent-isolation/transcript-mirror-worker.cjs",
  "dist/host/extensions/box-store-sync/box-store-vacuum-worker.cjs",
  "dist/host/extensions/content-search/search-index-worker.cjs",
]) {
  const data = helper.readFile(archive, entry);
  if (!data.length) throw new Error(`empty ASAR host entry: ${entry}`);
}
console.log("verified packaged ASAR host recovery");
NODE

# Drop debug leftovers from the copied user-data? none in the app.
chmod +x "$DEST/Contents/MacOS/Grok Bot" "$RT"/*.sh 2>/dev/null || true
CS_LOG="${CLEAN_DIR:-/tmp}/grokbot-d-dist-codesign.out"
if ! codesign --force --sign - "$DEST" >"$CS_LOG" 2>&1; then
  cat "$CS_LOG" >&2
  exit 1
fi

echo "packed $DEST"
echo "scripts $(ls "$RT" | wc -l | tr -d ' ')"
echo "asar $(ls -l "$DEST/Contents/Resources/app.asar" | awk '{print $5}')"
