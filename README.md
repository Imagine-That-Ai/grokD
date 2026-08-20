# grok"D"

Custom Grok Bot for your Mac. Local bots, or your own Cursor login — one account or several.

This repo is **our overlay**. It is not official Grok Bot (that is xAI’s app). It is not a download of `Grok Bot D.app`. The installer copies the Grok Bot already on your Mac, patches it, and opens grok"D".

## You need

1. macOS
2. Official **Grok Bot** from xAI
3. **Node.js**

For local models you also need an OpenAI-compatible proxy on this Mac (CLI Proxy, OpenBurnBar, or anything you point at). Cursor-only users can skip that.

## Install

Two ways in:

**A. Clone and install** (this repo does not attach xAI’s app):

```bash
git clone https://github.com/Imagine-That-Ai/grokD.git
cd grokD
chmod +x install.sh
./install.sh
```

That writes `~/Applications/Grok Bot D.app` and opens it. `install.sh` signs with Imagine That’s Developer ID when that cert is on the Mac; otherwise it ad-hoc signs a *local* build from *your* Grok Bot. Do not email an ad-hoc `.app` — Gatekeeper will block it.

**B. Drag a notarized drop** if Imagine That gave you one (`./pack-drop.sh` on a signing Mac). Put the grok"D" icon in Applications. First open finds official Grok Bot on this Mac, builds D, and relaunches. This GitHub repo does not host that `.app`.

First launch is **Seat in**:

- **This Mac** — start the local box, pick a proxy and a first model
- **Cursor** — import official Grok Bot already on this Mac, or sign in here
- **More than one Cursor** — after the first account is in, tap **Add another account**. Each login is its own seat. Your tokens stay on your Mac.

Your chats and logins never come from this repo.

## Welcome docs

These ship in the repo so a clone has the same guide as the app:

| File | What |
| --- | --- |
| [`grokD_Welcome_Guide.pdf`](grokD_Welcome_Guide.pdf) | Print / PDF welcome guide |
| [`splash/onboarding-apple.html`](splash/onboarding-apple.html) | Interactive Seat-in onboarding |
| [`welcome_guide_source.html`](welcome_guide_source.html) | Print-template source for the PDF |

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

Provider marks (OpenAI, Anthropic, xAI, and others) and any likenesses in the welcome guide are the owners’ trademarks. This overlay is not affiliated with xAI, SpaceX, or Cursor.
