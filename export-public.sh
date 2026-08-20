#!/bin/bash
# Copy a sanitized public tree. Never copies secrets, seats, or official binaries.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/.grok/grokD-public}"

rm -rf "$DEST"
mkdir -p "$DEST"
cd "$SRC"
git ls-files -z | rsync -a --from0 --files-from=- ./ "$DEST"/
for f in onboard-accounts.js test-onboard-accounts.js install.sh launch-d.sh export-public.sh; do
  [ -f "$SRC/$f" ] || continue
  cp "$SRC/$f" "$DEST/$f"
done
chmod +x "$DEST/install.sh" "$DEST/launch-d.sh" "$DEST/export-public.sh"

python3 - "$DEST" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])

p = root / "proxy2.js"
t = p.read_text(encoding="utf-8")
t = t.replace(
    "Environment: LOCAL rig on Alberto's Mac. Shell/ExternalShell run live on this machine (projects under /Users/albertonunez, gh/npm/git/Brew available).",
    "Environment: LOCAL rig on this Mac. Shell/ExternalShell run live on this machine (projects under the home folder).",
)
t = t.replace(
    'sub: "alberto-local", email: "alberto@local"',
    'sub: "grokbot-local", email: "local@grokbot"',
)
t = t.replace(
    'const out = Buffer.concat([pbStr(1, "local-auth-0001"), pbStr(3, "alberto@local"), pbStr(4, "Alberto"), pbStr(5, "Nunez-Garcia")]);\n      console.log(`[${id}] FAKE GetMe -> alberto@local`);',
    'const os = require("os"); const u = os.userInfo(); const localName = u.username || "local";\n      const out = Buffer.concat([pbStr(1, "local-auth-0001"), pbStr(3, localName + "@local"), pbStr(4, localName), pbStr(5, "User")]);\n      console.log(`[${id}] FAKE GetMe -> ` + localName + "@local");',
)
p.write_text(t, encoding="utf-8")

p = root / "profile-auth-preload.js"
t = p.read_text(encoding="utf-8")
old = '''const LOCAL_STATUS = {
  kind: "logged-in",
  authId: "google-oauth2|user_01KX4ZNEM0JA0VXBG7EEG5FBQ7",
  email: "alberto@local",
  name: "Alberto",
  isAnysphereUser: false,
};'''
new = '''const LOCAL_STATUS = (function () {
  const os = require("os");
  const u = os.userInfo();
  const localName = u.username || "local";
  return {
    kind: "logged-in",
    authId: "local|" + localName,
    email: localName + "@local",
    name: localName,
    isAnysphereUser: false,
  };
})();'''
if old not in t:
    raise SystemExit("profile-auth-preload.js: local identity block missing")
p.write_text(t.replace(old, new), encoding="utf-8")

p = root / "pack-asar.sh"
t = p.read_text(encoding="utf-8")
t = t.replace(
    'p="/Users/albertonunez/Applications/Grok Bot D.app/Contents/Resources/app.asar"',
    'p=os.path.expanduser("~/Applications/Grok Bot D.app/Contents/Resources/app.asar")',
)
p.write_text(t, encoding="utf-8")
print("sanitized", root)
PY

cat > "$DEST/README.md" <<'EOF'
# grok"D"

Custom Grok Bot for your Mac. Local bots, or your own Cursor login — one account or several.

This repo is **our overlay**. It does not include official Grok Bot (that is xAI’s app). The installer copies the Grok Bot already on your Mac, patches it, and opens grok"D".

## You need

1. macOS
2. Official **Grok Bot** from xAI
3. **Node.js**

For local models you also need an OpenAI-compatible proxy on this Mac (CLI Proxy, OpenBurnBar, or anything you point at). Cursor-only users can skip that.

## Install

```bash
git clone https://github.com/Imagine-That-Ai/grokD.git
cd grokD
chmod +x install.sh
./install.sh
```

That writes `~/Applications/Grok Bot D.app` and opens it. First launch is **Seat in**:

- **This Mac** — start the local box, pick a proxy and a first model
- **Cursor** — import a Grok Bot already on this Mac, or sign in here
- **More than one Cursor** — after the first account is in, tap **Add another account**. Each login is its own seat. Your tokens stay on your Mac.

Your chats and logins never come from this repo.

## What you get

Stop / resume per seat, quota hover, auto failover (off until you turn it on), local box, profile switch. Official Grok A / B / C are left alone.

## License

Our overlay is MIT. Official Grok Bot stays xAI’s. We do not redistribute it.
EOF

cat > "$DEST/INSTALL.md" <<'EOF'
# Install grok"D"

1. Install official Grok Bot from xAI.
2. Install Node from https://nodejs.org
3. Run `./install.sh`

`install.sh` copies official Grok Bot to `~/Applications/Grok Bot D.app`, applies the overlay, and extracts the local-box host from *your* app. It does not upload or download xAI’s binary.

```bash
./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/Grok Bot D.app"
./install.sh --dest /tmp/Grok-Bot-D-test.app --root /tmp/grokD-runtime --no-open
```

`--replace` overwrites dest if it already exists. Without it, an existing dest is left alone.

First open: Seat in can sign in **more than one** Cursor account. Skip anytime.

Do not zip `~/.grok/grokbot-d/profile-data` or `~/Library/Application Support/GrokBotSeat4` when you send the app to someone else. That is your login.
EOF

cat > "$DEST/LICENSE" <<'EOF'
MIT License

Copyright (c) 2026 Imagine That AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

# Public tree must not contain kitchen leftovers
rm -f "$DEST/profiles.json" "$DEST/active-env.json" "$DEST/model-config.json" \
  "$DEST/onboarding.json" "$DEST/failover-config.json"
rm -rf "$DEST/browser-profiles" "$DEST/profile-data" "$DEST/local-d-secrets" \
  "$DEST/runtime" "$DEST/dist" "$DEST/hack" "$DEST/proof" "$DEST/host"

echo "public tree $DEST"
find "$DEST" -type f | wc -l
