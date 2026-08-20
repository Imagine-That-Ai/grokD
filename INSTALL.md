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
