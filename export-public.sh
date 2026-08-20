#!/bin/bash
# Copy a sanitized public tree. Never copies secrets, seats, or official binaries.
# Never deletes DEST/.git.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/.grok/grokD-public}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/grokD-export.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

cd "$SRC"
git rev-parse --is-inside-work-tree >/dev/null
git ls-files -z | rsync -a --from0 --files-from=- ./ "$STAGE"/

# Kitchen-only — not a public product. The export script itself holds
# search strings for Alberto's identity; it must not ship.
rm -f "$STAGE/export-public.sh" \
  "$STAGE/PROMPT-npm-openburnbar-proxy.md" \
  "$STAGE/live-cursor-chat.js" \
  "$STAGE/welcome_guide_source.html" \
  "$STAGE/sync-to-tmp.sh" \
  "$STAGE/test-export-public.js"

for f in onboard-accounts.js test-onboard-accounts.js install.sh launch-d.sh; do
  [ -f "$SRC/$f" ] || continue
  cp "$SRC/$f" "$STAGE/$f"
done
chmod +x "$STAGE/install.sh" "$STAGE/launch-d.sh"

python3 - "$STAGE" <<'PY'
import pathlib, sys
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
t = t.replace('pbStr(2, "alberto-local")', 'pbStr(2, "grokbot-local")')
old_getme = (
    'const out = Buffer.concat([pbStr(1, "local-auth-0001"), pbStr(3, "alberto@local"), pbStr(4, "Alberto"), pbStr(5, "Nunez-Garcia")]);\n'
    '      console.log(`[${id}] FAKE GetMe -> alberto@local`);'
)
new_getme = (
    'const os = require("os"); const u = os.userInfo(); const localName = u.username || "local";\n'
    '      const out = Buffer.concat([pbStr(1, "local-auth-0001"), pbStr(3, localName + "@local"), pbStr(4, localName), pbStr(5, "User")]);\n'
    '      console.log(`[${id}] FAKE GetMe -> ` + localName + "@local");'
)
if old_getme not in t:
    raise SystemExit("proxy2.js: FAKE GetMe block missing")
t = t.replace(old_getme, new_getme)
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

p = root / "install.sh"
t = p.read_text(encoding="utf-8")
t = t.replace(
    'DEST="$HOME/Applications/grok\\"D\\".app"',
    'DEST="$HOME/Applications/Grok Bot D.app"',
)
p.write_text(t, encoding="utf-8")

p = root / "pack-asar.sh"
t = p.read_text(encoding="utf-8")
t = t.replace(
    'p="/Users/albertonunez/Applications/Grok Bot D.app/Contents/Resources/app.asar"',
    'p=os.path.expanduser("~/Applications/Grok Bot D.app/Contents/Resources/app.asar")',
)
t = t.replace(
    'APP="$HOME/Applications/grok\\"D\\".app"',
    'APP="$HOME/Applications/Grok Bot D.app"',
)
t = t.replace(
    """app_path = os.path.expanduser('~/Applications/grok"D".app')""",
    'app_path = os.path.expanduser("~/Applications/Grok Bot D.app")',
)
p.write_text(t, encoding="utf-8")

p = root / "local-mcp.js"
if p.is_file():
    t = p.read_text(encoding="utf-8")
    p.write_text(t.replace('KEYCHAIN_ACCOUNT = "alberto-local"', 'KEYCHAIN_ACCOUNT = "grokbot-local"'), encoding="utf-8")

# Blanket leftover identity tokens (JWT fakes, comments).
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".glb", ".pdf", ".svg", ".icns", ".woff", ".woff2"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    text2 = text.replace("alberto-local", "grokbot-local").replace("alberto@local", "local@grokbot")
    if text2 != text:
        p.write_text(text2, encoding="utf-8")

needles = (
    "albertonunez",
    "alberto@local",
    "alberto-local",
    "Nunez-Garcia",
    "Alberto's Mac",
    "google-oauth2|user_01KX4ZNEM0JA0VXBG7EEG5FBQ7",
    "/Users/albertonunez",
)
hits = []
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".glb", ".pdf", ".svg", ".icns", ".woff", ".woff2"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    for n in needles:
        if n in text:
            hits.append(f"{p.relative_to(root)}: {n}")
if hits:
    raise SystemExit("export leaked identity:\n" + "\n".join(hits))

for banned in (
    "profiles.json",
    "active-env.json",
    "host/host-main.cjs",
    "local-d-secrets",
    "browser-profiles",
    "profile-data",
    "export-public.sh",
    "PROMPT-npm-openburnbar-proxy.md",
    "live-cursor-chat.js",
    "welcome_guide_source.html",
    "sync-to-tmp.sh",
    "test-export-public.js",
):
    if (root / banned).exists():
        raise SystemExit(f"export included kitchen leftover: {banned}")
print("sanitized", root)
PY

cat > "$STAGE/README.md" <<'EOF'
# grok"D"

Custom Grok Bot for your Mac. Local bots, or your own Cursor login — one account or several.

This repo is **our overlay**. It is not official Grok Bot (that is xAI’s app). It is not a download of `Grok Bot D.app`. The installer copies the Grok Bot already on your Mac, patches it, and opens grok"D".

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

Run that from Terminal. Finder / a downloaded `.app` is blocked on an ad-hoc signature. There is no notarized installer yet.

That writes `~/Applications/Grok Bot D.app` and opens it. First launch is **Seat in**:

- **This Mac** — start the local box, pick a proxy and a first model
- **Cursor** — import official Grok Bot already on this Mac, or sign in here
- **More than one Cursor** — after the first account is in, tap **Add another account**. Each login is its own seat. Your tokens stay on your Mac.

Your chats and logins never come from this repo.

## Names

| What | Value |
| --- | --- |
| Display (Dock / window) | grok"D" |
| Folder | `Grok Bot D.app` |
| Apple menu / keychain | `Grok Bot` (keeps renderer secrets on the official keychain) |

Do not rename the folder to `grok"D".app`. Quotes in the path crash Electron.

## Seats

You start on **Local D**. Optional **Grok A** is an import of official Grok Bot on this Mac. Official Grok B and Grok C are not seats and are not imported. They stay the stock xAI apps.

Cursor allows one computer. If official Grok already owns this Mac, grok"D" may show no computer until you Recover or sign in. The overlay will not click Recover for you.

Stop / resume per seat, quota hover, auto failover (off until you turn it on), local box, profile switch.

Do not zip `~/.grok/grokbot-d/profile-data` or `~/Library/Application Support/GrokBotSeat4` when you send the app to someone else. That is your login.

## License

Our overlay is MIT. Official Grok Bot stays xAI’s. We do not redistribute it.
EOF

cat > "$STAGE/INSTALL.md" <<'EOF'
# Install grok"D"

1. Install official Grok Bot from xAI.
2. Install Node from https://nodejs.org
3. Run `./install.sh` from Terminal.

`install.sh` copies official Grok Bot to `~/Applications/Grok Bot D.app`, stamps the face-tat mascot (`assets/grokd-icon.icns`), applies the space-kernel overlay (event horizons, nebulas, orbiting provider logos, light/dark), and extracts the local-box host from *your* app. It does not upload or download xAI’s binary. Finder will not open a downloaded copy; the script `open`s the app it just built.

```bash
./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/Grok Bot D.app"
./install.sh --dest /tmp/Grok-Bot-D-test.app --root /tmp/grokD-runtime --no-open
```

`--replace` overwrites dest if it already exists. Without it, an existing dest is left alone. Do not point `--dest` at a running grok"D".

First open: Seat in can sign in **more than one** Cursor account. Skip anytime. Official Grok B and C are not imported.

Do not zip `~/.grok/grokbot-d/profile-data` or `~/Library/Application Support/GrokBotSeat4` when you send the app to someone else. That is your login.
EOF

# LICENSE and SECURITY.md are already in STAGE from git ls-files.
# Rewrite them so a kitchen drift cannot ship the wrong text.
cat > "$STAGE/LICENSE" <<'EOF'
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
IMPLIED, INCLUDING WITHOUT LIMITATION THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

cat > "$STAGE/SECURITY.md" <<'EOF'
# Security

This repository is the grok"D" overlay (MIT). It does not include official Grok Bot.

Do not open issues with logs from `~/Library/Application Support/GrokBotSeat4`,
`~/.grok/grokbot-d/profile-data`, or `*-secrets.json`.

Report overlay bugs via GitHub issues on Imagine-That-Ai/grokD.
EOF

# Public tree must not contain kitchen leftovers (if they were ever tracked).
rm -f "$STAGE/profiles.json" "$STAGE/active-env.json" "$STAGE/model-config.json" \
  "$STAGE/onboarding.json" "$STAGE/failover-config.json"
rm -rf "$STAGE/browser-profiles" "$STAGE/profile-data" "$STAGE/local-d-secrets" \
  "$STAGE/runtime" "$STAGE/dist" "$STAGE/hack" "$STAGE/proof" "$STAGE/host"

mkdir -p "$DEST"
rsync -a --delete --exclude '.git/' --exclude '.git' "$STAGE"/ "$DEST"/
echo "public tree $DEST"
find "$DEST" -type f | wc -l
