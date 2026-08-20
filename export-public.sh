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
# Welcome HTML stays in the public tree. The stale brochure PDF does not.
rm -f "$STAGE/export-public.sh" \
  "$STAGE/PROMPT-npm-openburnbar-proxy.md" \
  "$STAGE/live-cursor-chat.js" \
  "$STAGE/sync-to-tmp.sh" \
  "$STAGE/test-export-public.js" \
  "$STAGE/.github/workflows/check.yml"

mkdir -p "$STAGE/.github/workflows"
cat > "$STAGE/.github/workflows/check.yml" <<'EOF'
name: check
on:
  push:
    branches: [main]
  pull_request:
jobs:
  door:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: unit door
        run: |
          node test-unit.js
          node test-profiles.js
          node test-box-state.js
          node test-computer-cover.js
          node test-paths.js
          node test-patch-asar.js
          node test-account-identity.js
          node test-bot-pause.js
          node test-failover.js
          node test-failover-act.js
          node test-onboarding.js
          node test-clone-handoff.js
          node test-space-holes.js
          node test-install-look.js
      - name: no kitchen leftovers
        run: |
          python3 - <<'PY'
          import subprocess, sys
          needles = [
              "Imagine-That-Ai/grok" + "-D",
              "Pending " + "Elon",
              "Elon " + "Musk",
              "funding " + "frontier",
              "google-oauth2|user_",
          ]
          proc = subprocess.run(
              ["git", "grep", "-I", "-n", "-e", "."],
              capture_output=True, text=True,
          )
          hits = []
          for line in (proc.stdout or "").splitlines():
              if line.split(":", 1)[0].startswith(".git"):
                  continue
              for n in needles:
                  if n in line:
                      hits.append(line)
                      break
          if hits:
              print("kitchen leftover", file=sys.stderr)
              print("\n".join(hits[:50]), file=sys.stderr)
              sys.exit(1)
          PY
EOF

for f in onboard-accounts.js test-onboard-accounts.js install.sh launch-d.sh; do
  [ -f "$SRC/$f" ] || continue
  cp "$SRC/$f" "$STAGE/$f"
done
chmod +x "$STAGE/install.sh" "$STAGE/launch-d.sh"

python3 - "$STAGE" <<'PY'
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
    t = t.replace('KEYCHAIN_ACCOUNT = "alberto-local"', 'KEYCHAIN_ACCOUNT = "grokbot-local"')
    t = t.replace(
        '{ key: "alberto8793", service: X_TOKEN_SERVICE }',
        '{ key: "x-1", service: X_TOKEN_SERVICE }',
    )
    t = t.replace(
        '{ key: "alberto8793", service: `${GOOGLE_TOKEN_SERVICE}-1` }',
        '{ key: "gmail-1", service: `${GOOGLE_TOKEN_SERVICE}-1` }',
    )
    t = t.replace(
        '{ key: "cubelove.ai", service: `${X_TOKEN_SERVICE}-4` }',
        '{ key: "x-4", service: `${X_TOKEN_SERVICE}-4` }',
    )
    if "alberto8793" in t:
        raise SystemExit("local-mcp.js: alberto8793 slot still present")
    p.write_text(t, encoding="utf-8")

p = root / "pack-drop.sh"
if p.is_file():
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        'OUT="${1:-$HERE/drop/grok\\"D\\".app}"',
        'OUT="${1:-$HERE/drop/Grok Bot D.app}"',
    )
    p.write_text(t, encoding="utf-8")

# Blanket leftover identity tokens (JWT fakes, comments).
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".glb", ".pdf", ".svg", ".icns", ".woff", ".woff2"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    text2 = text.replace("alberto-local", "grokbot-local").replace("alberto@local", "local@grokbot")
    text2 = text2.replace("Alberto · Personal", "You · Personal").replace("alberto@example.com", "user@example.com")
    text2 = text2.replace("https://github.com/Imagine-That-Ai/grok-D", "https://github.com/Imagine-That-Ai/grokD")
    text2 = text2.replace("Imagine-That-Ai/grok-D", "Imagine-That-Ai/grokD")
    text2 = text2.replace("Liquid Metal Hub", "Cursor seats")
    text2 = text2.replace("BurnBar Hub", "BurnBar")
    if text2 != text:
        p.write_text(text2, encoding="utf-8")

pdf_old = b"https://github.com/Imagine-That-Ai/grok-D"
pdf_new = b"https://github.com/Imagine-That-Ai/grokD/"
if len(pdf_old) != len(pdf_new):
    raise SystemExit("pdf url rewrite length mismatch")
for p in root.rglob("*.pdf"):
    b = p.read_bytes()
    if pdf_old in b:
        p.write_bytes(b.replace(pdf_old, pdf_new))

needles = (
    "albertonunez",
    "alberto@local",
    "alberto-local",
    "Nunez-Garcia",
    "Alberto's Mac",
    "Alberto · Personal",
    "alberto@example.com",
    "alberto8793",
    "Pending Elon",
    "Elon Musk",
    "funding frontier",
    "Imagine-That-Ai/grok-D",
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
alberto_re = re.compile(r"alberto", re.I)
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".glb", ".pdf", ".svg", ".icns", ".woff", ".woff2"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    if alberto_re.search(text.replace("alberto@imagine-that.ai", "")):
        hits.append(f"{p.relative_to(root)}: alberto")
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
    "sync-to-tmp.sh",
    "test-export-public.js",
):
    if (root / banned).exists():
        raise SystemExit(f"export included kitchen leftover: {banned}")
print("sanitized", root)
PY

cat > "$STAGE/README.md" <<'EOF'
<p align="center">
  <img src="assets/grokd-icon.png" width="168" alt='grok"D"'>
</p>

# Prepare to get grok"D"!

A custom Grok Bot for your Mac. Run bots locally, or sign in with your Cursor account. You can add more than one Cursor login.

This repo is the overlay. Official Grok Bot is xAI’s. `install.sh` copies the Grok Bot already on your Mac, patches it, and opens grok"D". xAI’s binary is not in here.

Need macOS, official Grok Bot, and Node. Local models also need a proxy on this Mac (OpenBurnBar, CLI Proxy, or Vibe). Cursor-only users can skip the proxy.

```bash
git clone https://github.com/Imagine-That-Ai/grokD.git
cd grokD
chmod +x install.sh
./install.sh
```

That writes `~/Applications/Grok Bot D.app` and opens it. If this Mac has Imagine That’s Developer ID, it signs with that. Otherwise it ad-hoc signs a local build from *your* Grok Bot. Do not email an ad-hoc `.app`. Gatekeeper will block it.

If you were given a notarized drop (`./pack-drop.sh` on a signing Mac), drag that icon into Applications. First open finds official Grok Bot, builds D, and relaunches. GitHub does not host that `.app`.

First launch is Seat in. Pick This Mac (local box), Cursor (import or sign in), or add another Cursor after the first one. Skip anytime. Tokens stay on your Mac.

[CubeLove](https://cubelove.ai) is live on iPhone. grok"D" on the phone is not yet. Want the TestFlight alpha when it is? Email [alberto@imagine-that.ai](mailto:alberto@imagine-that.ai).

Guides: [`splash/onboarding-apple.html`](splash/onboarding-apple.html), [`welcome_guide_source.html`](welcome_guide_source.html).

Dock name is grok"D". Folder is `Grok Bot D.app`. Apple menu and keychain stay `Grok Bot` so renderer secrets stay on the official keychain. Do not rename the folder to `grok"D".app` — quotes in the path crash Electron.

You start on Local D. Grok A is an optional import of official Grok Bot on this Mac. Official Grok B and C are not seats.

Cursor allows one computer. If official Grok already owns this Mac, grok"D" may show no computer until you Recover or sign in. The overlay will not click Recover for you.

Do not zip `~/.grok/grokbot-d/profile-data` or `~/Library/Application Support/GrokBotSeat4` when you send the app to someone else. That is your login.

Overlay is MIT. Official Grok Bot stays xAI’s. Provider marks in the welcome guide belong to their owners. Not affiliated with xAI, SpaceX, or Cursor.
EOF

cat > "$STAGE/INSTALL.md" <<'EOF'
# Install grok"D"

1. Install official Grok Bot from xAI.
2. Install Node from https://nodejs.org
3. From this repo:

```bash
./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/Grok Bot D.app"
./install.sh --dest /tmp/Grok-Bot-D-test.app --root /tmp/grokD-runtime --no-open
```

`install.sh` copies official Grok Bot to `~/Applications/Grok Bot D.app`, stamps the face-tat mascot (`assets/grokd-icon.icns`), applies the space-kernel overlay (event horizons, nebulas, orbiting provider logos, light/dark), and extracts the local-box host from *your* app. It does not upload or download xAI’s binary. The script `open`s the app it just built.

`--replace` overwrites dest if it already exists. Without it, an existing dest is left alone. Do not point `--dest` at a running grok"D".

A notarized drag-into-Applications drop is built with `./pack-drop.sh` on a Mac that has Imagine That’s Developer ID, then notarized. This repo does not attach that `.app` (it would include xAI’s binary). If you already have the drop, drag the grok"D" icon into Applications; first open builds D from official Grok Bot.

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
