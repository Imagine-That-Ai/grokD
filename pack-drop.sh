#!/bin/bash
# Build the thing you drag into Applications: grok"D".app with the face-tat icon.
# First open finds official Grok Bot on this Mac, builds the real D in that
# same icon, and relaunches. We do not ship xAI's binary.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/drop/grok\"D\".app}"
ICON="$HERE/assets/grokd-icon.icns"
[ -f "$ICON" ] || { echo "missing $ICON" >&2; exit 1; }
[ -f "$HERE/install.sh" ] || { echo "missing install.sh" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources/overlay"

python3 - "$OUT/Contents/Info.plist" <<'PY'
import plistlib, sys
info = {
    "CFBundleExecutable": "grokD",
    "CFBundleIdentifier": "com.imaginethat.grokbot.drop",
    "CFBundleName": 'grok"D"',
    "CFBundleDisplayName": 'grok"D"',
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "1.0",
    "CFBundleIconFile": "icon.icns",
    "LSMinimumSystemVersion": "13.0",
    "NSHighResolutionCapable": True,
}
plistlib.dump(info, open(sys.argv[1], "wb"), fmt=plistlib.FMT_XML, sort_keys=False)
PY
cp "$ICON" "$OUT/Contents/Resources/icon.icns"

# Kitchen trees still have identity. Sanitize through export-public.sh when
# that script is here. A public clone is already clean and has no exporter.
# Refuse to pack a kitchen tree if the exporter is missing.
OVERLAY_SRC="$HERE"
CLEAN=""
if [ -x "$HERE/export-public.sh" ]; then
  CLEAN="$(mktemp -d "${TMPDIR:-/tmp}/grokD-drop-src.XXXXXX")"
  bash "$HERE/export-public.sh" "$CLEAN"
  OVERLAY_SRC="$CLEAN"
elif [ -f "$HERE/PROMPT-npm-openburnbar-proxy.md" ] || [ -f "$HERE/live-cursor-chat.js" ]; then
  echo "pack-drop: kitchen tree must run export-public.sh" >&2
  exit 1
fi
trap 'if [ -n "$CLEAN" ]; then rm -rf "$CLEAN"; fi' EXIT

rsync -a \
  --exclude '.git/' \
  --exclude 'browser-profiles/' \
  --exclude 'profile-data/' \
  --exclude 'local-d-secrets/' \
  --exclude 'runtime/' \
  --exclude 'dist/' \
  --exclude 'drop/' \
  --exclude 'hack/' \
  --exclude 'proof/' \
  --exclude 'host/' \
  --exclude 'host-main.cjs' \
  --exclude '*-worker.cjs' \
  --exclude 'export-public.sh' \
  --exclude 'PROMPT-npm-openburnbar-proxy.md' \
  --exclude 'live-cursor-chat.js' \
  --exclude 'sync-to-tmp.sh' \
  --exclude 'assets/meshy_elon.glb' \
  --exclude 'assets/meshy_elon_textured.glb' \
  --exclude 'test-*.js' \
  --exclude 'active-env.json' \
  --exclude 'failover-config.json' \
  --exclude 'model-config.json' \
  --exclude 'onboarding.json' \
  --exclude 'profiles.json' \
  --exclude '*.log' \
  "$OVERLAY_SRC/" "$OUT/Contents/Resources/overlay/"

cat > "$OUT/Contents/MacOS/grokD" <<'EOF'
#!/bin/bash
# First click: build grok"D" from official Grok Bot into this icon.
# Later clicks: the real app (install.sh replaces this bundle).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$(cd "$DIR/../.." && pwd)"
REAL="$DIR/Grok Bot.real"
if [ -x "$REAL" ]; then
  exec "$DIR/Grok Bot" "$@"
fi

OVERLAY="$SELF/Contents/Resources/overlay"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
LOG="$HOME/Library/Logs/grokD-drop.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "drop $(date)"
  echo "self $SELF"
} >>"$LOG"

if [ ! -x "$OVERLAY/install.sh" ]; then
  osascript -e 'display alert "grok\"D\"" message "This drop is missing its overlay. Get a fresh copy." as critical' >/dev/null
  exit 1
fi

SRC=""
for c in "/Applications/Grok Bot.app" "$HOME/Applications/Grok Bot.app"; do
  if [ -d "$c" ] && [ -f "$c/Contents/Resources/app.asar" ]; then SRC="$c"; break; fi
done
if [ -z "$SRC" ]; then
  osascript -e 'display alert "Install Grok Bot first" message "grok\"D\" builds from the official Grok Bot already on this Mac. Install Grok Bot from xAI, then open this icon again." as critical' >/dev/null
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  osascript -e 'display alert "Node is required" message "Install Node from https://nodejs.org, then open grok\"D\" again." as critical' >/dev/null
  exit 1
fi

osascript -e 'display notification "Building grok\"D\" from your Grok Bot…" with title "grok\"D\""' >/dev/null || true

STAGE="${TMPDIR:-/tmp}/grokD-built-$$.app"
chmod +x "$OVERLAY/install.sh" "$OVERLAY/"*.sh 2>/dev/null || true
if ! "$OVERLAY/install.sh" --src "$SRC" --dest "$STAGE" --root "$HOME/.grok/grokbot-d" --replace --no-open >>"$LOG" 2>&1; then
  osascript -e 'display alert "grok\"D\" could not install" message "See ~/Library/Logs/grokD-drop.log" as critical' >/dev/null
  exit 1
fi

WATCH="${TMPDIR:-/tmp}/grokD-swap-$$.sh"
cat > "$WATCH" <<EOS
#!/bin/bash
SELF=$(printf '%q' "$SELF")
STAGE=$(printf '%q' "$STAGE")
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if ! pgrep -f "Contents/MacOS/grokD" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
rm -rf "\$SELF"
mv "\$STAGE" "\$SELF"
open "\$SELF"
EOS
chmod +x "$WATCH"
nohup "$WATCH" >>"$LOG" 2>&1 &
exit 0
EOF
chmod +x "$OUT/Contents/MacOS/grokD"

SIGN_ID=""
if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Developer ID Application: Imagine That AI'; then
  SIGN_ID="Developer ID Application: Imagine That AI Limited Liability Company (4Y367DF25B)"
fi
if [ -n "$SIGN_ID" ]; then
  codesign --force --deep --sign "$SIGN_ID" --options runtime --timestamp "$OUT"
  echo "signed drop $SIGN_ID"
else
  codesign --force --deep --sign - "$OUT"
  echo "signed drop ad-hoc"
fi
xattr -cr "$OUT" 2>/dev/null || true
echo "drop $OUT"
