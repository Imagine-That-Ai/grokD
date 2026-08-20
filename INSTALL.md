# Install grok"D"

This is the custom Grok Bot. One app. Two ways to work:

1. **Local** — bots run on this Mac. No Cursor login.
2. **Cursor** — sign in with your own Cursor account. The app talks to *your* computer, not someone else’s.

You do not need extra official Grok Bot copies. Official Grok Bot on this Mac can be imported as Grok A. Grok B and Grok C are not seats in this app.

## Install

1. Install official **Grok Bot** from xAI.
2. Drag **grok"D"** (the face-tat icon) into your Applications folder.
3. Open it. The first launch builds D from the Grok Bot already on this Mac.

That drop is `drop/grok"D".app` from `./pack-drop.sh`. Node is required on PATH for that first build.

To rebuild from Terminal:

```bash
./install.sh --replace
```

## First launch

After the splash, **Seat in** walks you through a working setup:

- **This Mac** — start the local box, pick a proxy (CLI Proxy / OpenBurnBar / Vibe), pick a first model.
- **Cursor** — import an existing Grok Bot on this Mac, or sign in here.

Skip anytime. To run it again, delete `~/.grok/grokbot-d/onboarding.json` or run `onboard` from the command bus.

## Add your Cursor login

In the app: new profile → **Cursor ID** → **Sign in here (no import)** → Create → switch to it.

The official Cursor sign-in window should appear. After that, this app saves *your* box connection in `~/.grok/grokbot-d/profile-data/`. Switching away and back does not need another Grok Bot running.

If official Grok Bot is already signed in on this Mac, Grok A is offered as an import. Import copies that login. It does not change the other app. Grok B and Grok C are not imported.

## Switch

```bash
node ~/.grok/grokbot-d/switch-profile.js list
node ~/.grok/grokbot-d/switch-profile.js switch local-d
node ~/.grok/grokbot-d/switch-profile.js switch cursor-a
```

## What is yours vs the app

| Path | What |
| --- | --- |
| `Grok Bot D.app` | The app |
| `~/.grok/grokbot-d` | Profiles, scripts, local box data |
| `~/Library/Application Support/GrokBotSeat4` | This app’s live session |

Do not zip `profile-data` or `GrokBotSeat4` when you send the app to someone else. That is your login.

## Rebuild from a stock Grok Bot

```bash
# extract official asar to /tmp/grokbot-asar, then:
node ~/.grok/grokbot-d/patch-asar.js /tmp/grokbot-asar
bash ~/.grok/grokbot-d/pack-asar.sh
bash ~/.grok/grokbot-d/pack-dist.sh
```
