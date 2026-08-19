#!/bin/bash
# Build grok"D" on this Mac from official Grok Bot + this overlay.
# Does not ship xAI's app. Does not copy anyone's chats or tokens.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC=""
DEST="$HOME/Applications/Grok Bot D.app"
ROOT="$HOME/.grok/grokbot-d"
REPLACE=0
OPEN_APP=1
WORK="${TMPDIR:-/tmp}/grokD-install-$$"

usage() {
  cat <<'EOF'
Install grok"D" from official Grok Bot already on this Mac.

  ./install.sh
  ./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/Grok Bot D.app"

  --src PATH     official Grok Bot.app (auto-detected if omitted)
  --dest PATH    where to write Grok Bot D.app
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
  *"Grok Bot D.app"|*"Grok Bot B.app"|*"Grok Bot C.app")
    die "Use official Grok Bot.app as --src, not a seat copy."
    ;;
esac

if [ -e "$DEST" ] && [ "$REPLACE" -ne 1 ]; then
  die "dest already exists: $DEST  (pass --replace to overwrite, or pick another --dest)"
fi
if pgrep -f "Grok Bot D.app/Contents/MacOS/Grok Bot.real --user-data-dir" >/dev/null 2>&1; then
  case "$DEST" in
    "$HOME/Applications/Grok Bot D.app"|/Applications/"Grok Bot D.app")
      die "Grok Bot D is running. Quit it first, or pass a different --dest."
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
with open(path, "wb") as f:
    plistlib.dump(info, f, sort_keys=False)
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
  --exclude 'host/host-main.cjs' \
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
  require(require("os").homedir() + "/.grok/grokbot-d/profile-ui-inject.js");
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[profile-ui-inject] " + e + "\n"); } catch (_) {}
}
EOF
fi

echo "pack asar…"
npx --yes asar pack "$ASAR_SRC" "$WORK/app.asar"
cp "$WORK/app.asar" "$DEST/Contents/Resources/app.asar"

python3 - "$DEST" <<'PY'
import hashlib, re, sys
app = sys.argv[1]
dest = app + "/Contents/Resources/app.asar"
plist = app + "/Contents/Info.plist"
h = hashlib.sha256(open(dest, "rb").read()).hexdigest()
c = open(plist, encoding="utf-8").read()
c2, n = re.subn(
    r'(<key>ElectronAsarIntegrity</key>\s*<dict>\s*<key>Resources/app\.asar</key>\s*<dict>\s*<key>algorithm</key>\s*<string>SHA256</string>\s*<key>hash</key>\s*<string>)[^<]+(</string>)',
    r'\g<1>' + h + r'\g<2>',
    c,
    count=1,
)
if n != 1:
    raise SystemExit("could not update ElectronAsarIntegrity")
open(plist, "w", encoding="utf-8").write(c2)
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

codesign --force --deep --sign - "$DEST" >/tmp/grokD-install-codesign.out 2>&1 || true
xattr -cr "$DEST" 2>/dev/null || true

echo "packed $DEST"
echo "overlay $ROOT"
if [ "$OPEN_APP" -eq 1 ]; then
  open -na "$DEST" || open "$DEST"
  echo "opened. Seat-in can add more than one Cursor account."
fi
