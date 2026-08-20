# Install grok"D"

This is the custom Grok Bot. One app. Two ways to work:

1. **Local** — bots run on this Mac. No Cursor login.
2. **Cursor** — sign in with your own Cursor account. The app talks to *your* computer, not someone else’s.

You do not need extra official Grok Bot copies. Official Grok Bot on this Mac can be imported as Grok A. Grok B and Grok C are not seats in this app.

## Install

You need official **Grok Bot.app** from xAI already on this Mac. Then clone the overlay and run the installer — that is how the face-tat icon, space kernel, orbiting provider logos, and light/dark sky land in the app. GitHub `main` is the look. `hack/` is local scratch and is **not** what users get.

```bash
git clone https://github.com/Imagine-That-Ai/grok-D.git ~/.grok/grokbot-d
cd ~/.grok/grokbot-d
./install.sh --replace
```

That writes `~/Applications/grok"D".app` (an alias `Grok Bot D.app` points at it), stamps `assets/grokd-icon.icns` as the app icon, patches the overlay hook, and opens D.

Need Node on your PATH for the local box (`node`).

If someone hands you an already-built `.app` instead: copy it to `~/Applications`, open it, first launch writes `~/.grok/grokbot-d` (scripts + assets, no one else’s chats). You start on **Local D**.

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
