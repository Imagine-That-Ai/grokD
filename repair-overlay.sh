#!/bin/bash
# Re-apply disk-eval hook if an xAI update replaced app.asar. Best-effort.
set -u
APP="${1:-}"
if [ -z "$APP" ]; then
  for c in "$HOME/Applications/grok\"D\".app" "$HOME/Applications/Grok Bot D.app"; do
    [ -d "$c" ] && { APP="$c"; break; }
  done
fi
APP="${APP:-$HOME/Applications/grok\"D\".app}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ASAR="$APP/Contents/Resources/app.asar"
[ -f "$ASAR" ] || exit 0
if grep -a -q -F "profile-ui-inject.js" "$ASAR" 2>/dev/null; then
  exit 0
fi
command -v node >/dev/null || exit 1
command -v npx >/dev/null || exit 1
WORK="${TMPDIR:-/tmp}/grokD-repair-$$"
mkdir -p "$WORK"
bash "$HERE/asar-cli.sh" extract "$ASAR" "$WORK/asar" || exit 1
node "$HERE/patch-asar.js" "$WORK/asar" || true
if ! grep -a -q -F "profile-ui-inject.js" "$WORK/asar/dist/electron-preload/preload.cjs" 2>/dev/null; then
  rm -rf "$WORK"
  exit 1
fi
bash "$HERE/asar-cli.sh" pack "$WORK/asar" "$WORK/app.asar" || exit 1
cp "$WORK/app.asar" "$ASAR"
python3 - "$APP" <<'PY'
import hashlib, plistlib, sys
app = sys.argv[1]
dest = app + "/Contents/Resources/app.asar"
plist_path = app + "/Contents/Info.plist"
h = hashlib.sha256(open(dest, "rb").read()).hexdigest()
info = plistlib.loads(open(plist_path, "rb").read())
block = info.setdefault("ElectronAsarIntegrity", {}).setdefault("Resources/app.asar", {})
block["algorithm"] = "SHA256"
block["hash"] = h
open(plist_path, "wb").write(plistlib.dumps(info, fmt=plistlib.FMT_XML, sort_keys=False))
PY
codesign --force --deep --sign - --options runtime --timestamp=none "$APP" >/dev/null 2>&1 || \
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true
rm -rf "$WORK"
echo "repaired overlay hook in $APP"
