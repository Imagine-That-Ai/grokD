#!/bin/bash
# Pack unpacked asar (with disk-eval hook) into Grok Bot D.app.
set -euo pipefail
ASAR_SRC=/tmp/grokbot-asar
PRELOAD="$ASAR_SRC/dist/electron-preload/preload.cjs"
APP="$HOME/Applications/grok\"D\".app"
[ -d "$APP" ] || APP="$HOME/Applications/Grok Bot D.app"
DEST="$APP/Contents/Resources/app.asar"
HOOK='require(require("os").homedir() + "/.grok/grokbot-d/profile-ui-inject.js")'

node "$(dirname "$0")/patch-asar.js" "$ASAR_SRC"

if ! grep -q 'profile-ui-inject.js' "$PRELOAD"; then
  cat >> "$PRELOAD" <<'EOF'

// Disk-loaded Profiles + model picker + command bus.
try {
  require(require("os").homedir() + "/.grok/grokbot-d/profile-ui-inject.js");
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[profile-ui-inject] " + e + "\n"); } catch (_) {}
}
EOF
  echo "appended disk-eval hook"
else
  echo "disk-eval hook already present"
fi

npx --yes asar pack "$ASAR_SRC" /tmp/grokbot-hack/app.asar
cp /tmp/grokbot-hack/app.asar "$DEST"

# Update ElectronAsarIntegrity in Info.plist
python3 - <<'PY'
import hashlib, re, os
app_path = os.path.expanduser('~/Applications/grok"D".app')
if not os.path.isdir(app_path):
    app_path = os.path.expanduser("~/Applications/Grok Bot D.app")
dest = os.path.join(app_path, "Contents/Resources/app.asar")
plist = os.path.join(app_path, "Contents/Info.plist")
with open(dest, "rb") as f:
    h = hashlib.sha256(f.read()).hexdigest()
with open(plist, "r", encoding="utf-8") as f:
    c = f.read()
c = re.sub(r'(<key>ElectronAsarIntegrity</key>\s*<dict>\s*<key>Resources/app\.asar</key>\s*<dict>\s*<key>algorithm</key>\s*<string>SHA256</string>\s*<key>hash</key>\s*<string>)[^<]+(</string>)', rf'\g<1>{h}\g<2>', c)
with open(plist, "w", encoding="utf-8") as f:
    f.write(c)
PY

codesign --force --deep --sign - "$APP" >/tmp/grokbot-hack/codesign.out 2>&1 || true
echo "packed $DEST"
# prove hook landed
python3 - <<'PY'
p="/Users/albertonunez/Applications/Grok Bot D.app/Contents/Resources/app.asar"
data=open(p,"rb").read()
print("HOOK_OK" if b"profile-ui-inject.js" in data else "HOOK_MISSING")
PY
