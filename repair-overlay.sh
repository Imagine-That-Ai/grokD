#!/bin/bash
# Re-apply disk-eval hook if an xAI update replaced app.asar. Best-effort.
set -u
APP="${1:-$HOME/Applications/Grok Bot D.app}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ASAR="$APP/Contents/Resources/app.asar"
[ -f "$ASAR" ] || exit 0
if python3 -c "import pathlib,sys; sys.exit(0 if b'profile-ui-inject.js' in pathlib.Path(sys.argv[1]).read_bytes() else 1)" "$ASAR"; then
  exit 0
fi
command -v node >/dev/null || exit 1
command -v npx >/dev/null || exit 1
WORK="${TMPDIR:-/tmp}/grokD-repair-$$"
mkdir -p "$WORK"
npx --yes asar extract "$ASAR" "$WORK/asar" || exit 1
node "$HERE/patch-asar.js" "$WORK/asar" || true
if ! python3 -c "import pathlib,sys; sys.exit(0 if b'profile-ui-inject.js' in pathlib.Path('$WORK/asar/dist/electron-preload/preload.cjs').read_bytes() else 1)"; then
  rm -rf "$WORK"
  exit 1
fi
npx --yes asar pack "$WORK/asar" "$WORK/app.asar" || exit 1
cp "$WORK/app.asar" "$ASAR"
python3 - "$APP" <<'PY'
import hashlib, re, sys
app = sys.argv[1]
dest = app + "/Contents/Resources/app.asar"
plist = app + "/Contents/Info.plist"
h = hashlib.sha256(open(dest, "rb").read()).hexdigest()
c = open(plist, encoding="utf-8").read()
c2, n = re.subn(
    r'(<key>ElectronAsarIntegrity</key>\s*<dict>\s*<key>Resources/app\.asar</key>\s*<dict>\s*<key>algorithm</key>\s*<string>SHA256</string>\s*<key>hash</key>\s*<string>)[^<]+(</string>)',
    r'\g<1>' + h + r'\g<2>',
    c, count=1,
)
if n == 1:
    open(plist, "w", encoding="utf-8").write(c2)
PY
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true
rm -rf "$WORK"
echo "repaired overlay hook in $APP"
