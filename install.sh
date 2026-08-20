#!/bin/bash
# Build grok"D" on this Mac from official Grok Bot + this overlay.
# Does not ship xAI's app. Does not copy anyone's chats or tokens.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC=""
DEST="$HOME/Applications/grok\"D\".app"
ROOT="$HOME/.grok/grokbot-d"
REPLACE=0
OPEN_APP=1
WORK="${TMPDIR:-/tmp}/grokD-install-$$"

usage() {
  cat <<'EOF'
Install grok"D" from official Grok Bot already on this Mac.

  ./install.sh
  ./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/grok\"D\".app"

  --src PATH     official Grok Bot.app (auto-detected if omitted)
  --dest PATH    where to write grok"D" (default grok"D".app)
  --root PATH    overlay home (default ~/.grok/grokbot-d)
  --replace      overwrite dest if it already exists
  --no-open      do not launch D when done
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    --no-open) OPEN_APP=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "install: $*" >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  die "Node is required. Install it from https://nodejs.org and run this again."
fi
if ! command -v python3 >/dev/null 2>&1; then
  die "python3 is required."
fi
if ! command -v npx >/dev/null 2>&1; then
  die "npx is required (it ships with Node)."
fi

if [ -z "$SRC" ]; then
  for c in "/Applications/Grok Bot.app" "$HOME/Applications/Grok Bot.app"; do
    if [ -d "$c" ]; then SRC="$c"; break; fi
  done
fi
[ -d "$SRC" ] || die "Official Grok Bot not found. Install it from xAI, then run this again."
[ -f "$SRC/Contents/Resources/app.asar" ] || die "That app has no app.asar — is it official Grok Bot?"
case "$SRC" in
  *"Grok Bot D.app"|*grok\"D\".app|*"Grok Bot B.app"|*"Grok Bot C.app")
    die "Use official Grok Bot.app as --src, not a seat copy."
    ;;
esac

if [ -e "$DEST" ] && [ "$REPLACE" -ne 1 ]; then
  die "dest already exists: $DEST  (pass --replace to overwrite, or pick another --dest)"
fi
if pgrep -f "Grok Bot.real --user-data-dir" >/dev/null 2>&1 && pgrep -f "GrokBotSeat4" >/dev/null 2>&1; then
  case "$DEST" in
    "$HOME/Applications/Grok Bot D.app"|/Applications/"Grok Bot D.app"|$HOME/Applications/grok\"D\".app|/Applications/grok\"D\".app)
      die 'grok"D" is running. Quit it first, or pass a different --dest.'
      ;;
  esac
fi

echo "src    $SRC"
echo "dest   $DEST"
echo "root   $ROOT"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$WORK" "$(dirname "$DEST")"

rm -rf "$DEST"
ditto "$SRC" "$DEST"

# Brand as D. User-data stays GrokBotSeat4 via launch-d.sh, not official Grok's folder.
python3 - "$DEST/Contents/Info.plist" <<'PY'
import plistlib, sys
path = sys.argv[1]
with open(path, "rb") as f:
    info = plistlib.load(f)
info["CFBundleDisplayName"] = 'grok"D"'
info["CFBundleName"] = "Grok Bot D"
info["CFBundleIdentifier"] = "com.imaginethat.grokbot.seatd"
info["LSHasLocalizedDisplayName"] = True
info["CFBundleIconFile"] = "icon.icns"
# Official Grok Bot ships CFBundleIconName → Assets.car (stock blob).
# Launchpad uses that over icon.icns, so drop it.
info.pop("CFBundleIconName", None)
with open(path, "wb") as f:
    plistlib.dump(info, f, fmt=plistlib.FMT_XML, sort_keys=False)
# Dock/Finder ignore CFBundleDisplayName unless this file exists.
import pathlib
loc = pathlib.Path(path).parent / "Resources" / "en.lproj"
loc.mkdir(parents=True, exist_ok=True)
(loc / "InfoPlist.strings").write_text(
    'CFBundleDisplayName = "grok\\"D\\"";\nCFBundleName = "grok\\"D\\"";\n',
    encoding="utf-8",
)
PY

# Dock / Finder icon: grok"D" mascot with face tats (color), not the purple seat blob.
ICON_SRC=""
for c in "$HERE/hack/grokd_icon_color.icns" "$HERE/hack/grokd_edgefill.icns" "$HERE/hack/icons/icon-D.icns"; do
  if [ -f "$c" ]; then ICON_SRC="$c"; break; fi
done
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$DEST/Contents/Resources/icon.icns"
  cp "$ICON_SRC" "$DEST/Contents/Resources/electron.icns" 2>/dev/null || true
  cp "$ICON_SRC" "$DEST/Contents/Resources/app.icns" 2>/dev/null || true
fi
# Official Grok Bot's icon catalog is the stock gray blob. Finder / Applications
# still read it even after CFBundleIconName is dropped.
rm -f "$DEST/Contents/Resources/Assets.car"

# Rename helper apps to match CFBundleName so Electron finds them
python3 - "$DEST/Contents/Frameworks" <<'PY'
import os, pathlib, plistlib, sys
fw = pathlib.Path(sys.argv[1])
helpers = [
    ("Grok Bot Helper.app", "Grok Bot D Helper.app", "Grok Bot Helper", "Grok Bot D Helper"),
    ("Grok Bot Helper (GPU).app", "Grok Bot D Helper (GPU).app", "Grok Bot Helper (GPU)", "Grok Bot D Helper (GPU)"),
    ("Grok Bot Helper (Plugin).app", "Grok Bot D Helper (Plugin).app", "Grok Bot Helper (Plugin)", "Grok Bot D Helper (Plugin)"),
    ("Grok Bot Helper (Renderer).app", "Grok Bot D Helper (Renderer).app", "Grok Bot Helper (Renderer)", "Grok Bot D Helper (Renderer)"),
]
for old_app, new_app, old_bin, new_bin in helpers:
    old_p = fw / old_app
    new_p = fw / new_app
    if old_p.exists() and old_p != new_p:
        old_p.rename(new_p)
    if new_p.exists():
        bin_dir = new_p / "Contents" / "MacOS"
        old_b = bin_dir / old_bin
        new_b = bin_dir / new_bin
        if old_b.exists() and old_b != new_b:
            old_b.rename(new_b)
        plist_path = new_p / "Contents" / "Info.plist"
        if plist_path.exists():
            with open(plist_path, "rb") as f:
                info = plistlib.load(f)
            info["CFBundleExecutable"] = new_bin
            with open(plist_path, "wb") as f:
                plistlib.dump(info, f, fmt=plistlib.FMT_XML, sort_keys=False)
PY

BIN="$DEST/Contents/MacOS/Grok Bot"
REAL="$DEST/Contents/MacOS/Grok Bot.real"
if [ ! -f "$REAL" ]; then
  mv "$BIN" "$REAL"
fi
cp "$HERE/launch-d.sh" "$BIN"
chmod +x "$BIN" "$REAL"

RT="$DEST/Contents/Resources/grokbot-d"
mkdir -p "$RT"
# Overlay only — never profile-data, secrets, hack, or host-main.
rsync -a \
  --exclude '.git/' \
  --exclude 'browser-profiles/' \
  --exclude 'profile-data/' \
  --exclude 'local-d-secrets/' \
  --exclude 'runtime/' \
  --exclude 'dist/' \
  --exclude 'hack/' \
  --exclude 'proof/' \
  --exclude 'host/' \
  --exclude 'assets/meshy_elon.glb' \
  --exclude 'assets/meshy_elon_textured.glb' \
  --exclude 'test-*.js' \
  --exclude 'active-env.json' \
  --exclude 'failover-config.json' \
  --exclude 'model-config.json' \
  --exclude 'onboarding.json' \
  --exclude 'profiles.json' \
  --exclude '*.log' \
  "$HERE/" "$RT/"

ASAR_SRC="$WORK/asar"
mkdir -p "$ASAR_SRC"
echo "extract asar…"
npx --yes asar extract "$DEST/Contents/Resources/app.asar" "$ASAR_SRC"
node "$HERE/patch-asar.js" "$ASAR_SRC"

PRELOAD="$ASAR_SRC/dist/electron-preload/preload.cjs"
if [ -f "$PRELOAD" ] && ! grep -q 'profile-ui-inject.js' "$PRELOAD"; then
  cat >> "$PRELOAD" <<'EOF'

try {
  const os = require("os");
  const path = require("path");
  const root = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  require(path.join(root, "profile-ui-inject.js"));
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[profile-ui-inject] " + e + "\n"); } catch (_) {}
}
EOF
fi

echo "pack asar…"
npx --yes asar pack "$ASAR_SRC" "$WORK/app.asar"
cp "$WORK/app.asar" "$DEST/Contents/Resources/app.asar"

python3 - "$DEST" <<'PY'
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
print("asar hash", h)
PY

mkdir -p "$ROOT/host"
if [ -d "$ASAR_SRC/dist/host" ]; then
  rsync -a "$ASAR_SRC/dist/host/" "$ROOT/host/"
fi
if [ -d "$ASAR_SRC/dist/host" ]; then
  mkdir -p "$RT/host"
  rsync -a "$ASAR_SRC/dist/host/" "$RT/host/"
fi

export GROK_PROFILE_ROOT="$ROOT"
bash "$HERE/install-runtime.sh" "$RT"

python3 - "$DEST/Contents/Resources/app.asar" <<'PY'
import pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()
if b"profile-ui-inject.js" not in data:
    raise SystemExit("install: overlay hook missing from app.asar")
print("hook ok")
PY
# Official Grok is Team DCNK4UB866. Ad-hoc outer + leftover xAI framework
# Team IDs crash ("mapped file have different Team IDs"). --deep makes
# nested binaries ad-hoc too so they match. disable-library-validation
# is a belt if anything nested stays signed. spctl will still reject.
ENTS="$WORK/ents.plist"
codesign -d --entitlements :- "$SRC" >"$ENTS" 2>/dev/null || true
python3 - "$ENTS" <<'PY'
import plistlib, sys, os
path = sys.argv[1]
info = {}
if os.path.isfile(path) and os.path.getsize(path) > 20:
    try:
        info = plistlib.loads(open(path, "rb").read())
    except Exception:
        info = {}
if not isinstance(info, dict):
    info = {}
info["com.apple.security.cs.allow-jit"] = True
info["com.apple.security.cs.disable-library-validation"] = True
open(path, "wb").write(plistlib.dumps(info, fmt=plistlib.FMT_XML, sort_keys=False))
PY
codesign --force --deep --sign - --options runtime --timestamp=none --entitlements "$ENTS" "$DEST" >>/tmp/grokD-install-codesign.out 2>&1 || \
  codesign --force --deep --sign - "$DEST" >>/tmp/grokD-install-codesign.out 2>&1 || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
xattr -cr "$DEST" 2>/dev/null || true
# Do not NSWorkspace.setIcon — that is a Finder custom icon (no macOS squircle).
# App icons come from icon.icns after CFBundleIconName is dropped.

echo "packed $DEST"
echo "overlay $ROOT"
ALIAS="$HOME/Applications/Grok Bot D.app"
if [ "$DEST" != "$ALIAS" ] && [ "$(dirname "$DEST")" = "$(dirname "$ALIAS")" ]; then
  rm -rf "$ALIAS"
  ln -s "$(basename "$DEST")" "$ALIAS"
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f -r -u "$DEST" 2>/dev/null || true
touch "$DEST"
killall Dock 2>/dev/null || true
if [ "$OPEN_APP" -eq 1 ]; then
  open -na "$DEST" || open "$DEST"
  echo "opened. Seat-in can add more than one Cursor account."
fi
