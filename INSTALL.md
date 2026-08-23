# Install grok"D"

1. Install official Grok Bot from xAI.
2. Install Node from https://nodejs.org
3. From this repo:

```bash
./install.sh --src "/Applications/Grok Bot.app" --dest "$HOME/Applications/Grok Bot D.app"
./install.sh --dest /tmp/Grok-Bot-D-test.app --root /tmp/grokD-runtime --no-open
```

`install.sh` copies official Grok Bot to `~/Applications/Grok Bot D.app`, stamps the face-tat mascot (`assets/grokd-icon.icns`), applies the space-kernel overlay (event horizons, nebulas, orbiting provider logos, light/dark), and extracts the local-box host from *your* app. It does not upload or download xAI’s binary. The script `open`s the app it just built.

For This Mac mode, first launch extracts the five required host files from the installed `app.asar` without npm or network access, verifies their SHA-256 integrity, and waits for both local services before opening the renderer. It does not construct Cursor auth or read Cursor’s Keychain item; local secrets use a random per-seat 256-bit key with owner-only permissions. If bootstrap fails, the app exits with an actionable alert and writes diagnostics under `~/.grok/grokbot-d/runtime/` instead of showing an endless setup screen.

When an official bot runs out of quota, click **Local copy** in its bottom-left account chip. D creates or resumes one temporary local continuation of the exact selected bot. The official bot is never edited. **Back to official** creates a reviewable packet but does not send it; choose **Keep** or **Discard & return** for the local copy.

Every local startup verifies all existing bot databases before launching the host. Older two-column transcript stores are repaired without dropping readable duplicate-ID rows, and new UUID bot directories become visible only after their complete contents are ready. An unknown store stops startup with a diagnostic instead of opening a stuck bot.

The canonical app is `~/Applications/Grok Bot D.app`. `~/Applications/grok"D".app` is a compatibility symlink to it.

`--replace` overwrites dest if it already exists. Without it, an existing dest is left alone. Do not point `--dest` at a running grok"D".
