# Grok "D" — Local-First Autonomous AI Companion

Local bots on your Mac, seamless multi-account Cursor switching, offline Ollama/LM Studio models, and OpenBurnBar OpenAI-compatible gateway.

---

## 🛠 Development (Alberto's machines)

The **dev checkout** lives in `~/Documents/Developer/grok-D`. The **installed runtime** stays at `~/.grok/grokbot-d` (daemons + chat SQLite live there; macOS TCC makes `~/Documents` a bad runtime home).

```bash
cd ~/Documents/Developer/grok-D
./deploy.sh          # push tracked files into the local runtime (~/.grok/grokbot-d)
./deploy.sh --fleet  # also sync code to mini + m1pro and refresh their daemons
```

`deploy.sh` uses `git archive`, so it can only ever copy tracked repo files — user chats, seats, and keys are untouchable.

---

## ⚡ Instant 1-Liner Install (For any Mac)

Paste this into Terminal on any Mac with `/Applications/Grok Bot.app` installed:

```bash
git -c credential.helper= clone --depth=1 https://github.com/Imagine-That-Ai/grokD.git ~/.grok/grokbot-d && bash ~/.grok/grokbot-d/install.sh --replace
```

*(If you already cloned the repo, simply run `bash install.sh --replace` inside the folder).*

---

## 🚀 Use Your Existing AI Subscriptions (No API Keys Needed)

Grok "D" and OpenBurnBar (:8320) support **1-Click OAuth Browser Logins** so you can use your existing monthly subscriptions without paying for separate API credits:

### 1. ⚡ 1-Click OAuth Subscriptions
Open **"⚡ AI Subscriptions & Provider Hub"** in the seat menu:
* 🤖 **ChatGPT Plus & Pro (Codex OAuth)**: Tap **"Login with ChatGPT"** to authenticate via browser. Grok D routes GPT-4o, o3-mini, and o1 through your monthly ChatGPT subscription!
* 🧠 **Claude Pro / Team (Claude OAuth)**: Tap **"Login with Claude"** to use Claude 3.7 Sonnet and Opus using your Claude subscription.
* 🚀 **xAI / Grok Subscription**: Tap **"Login with xAI"** for Grok 2 & Grok Beta.
* 🌐 **OpenRouter OAuth**: Tap **"Connect OpenRouter"** for 1-click access to DeepSeek R1, Llama 3.3, and all frontier models.
* ✨ **Cursor Multi-Seat**: Fast switch between multiple Cursor accounts in the bottom-left menu.

### 2. 🔑 Direct API Keys (Optional)
If you prefer standard API keys, you can also paste keys for **OpenAI** (`sk-...`), **xAI** (`xai-...`), **Anthropic** (`sk-ant-...`), **DeepSeek** (`sk-...`), **MiniMax** (`sk-cp-...`), and **Google Gemini** (`AIzaSy...`).

### 3. 💻 Offline Local AI (Ollama & LM Studio)
Run [Ollama](https://ollama.com) (`ollama run llama3.2`) or LM Studio on your Mac. OpenBurnBar auto-detects them on `:11434` / `:1234` instantly.

---

## 🔄 Safe In-Place Update (Never Breaks Chats or Logins)

Update Grok D to the latest version while preserving all your bots, transcripts, and Cursor seats:

```bash
bash ~/.grok/grokbot-d/update.sh
```

*(You can also click the **"Update Grok D"** button inside the app's bottom-left seat menu).*

---

# Local Architecture & Services

Local mode runs entirely on your Mac, routing prompts through the local OpenBurnBar OpenAI gateway:

| Port | Service | Role |
| --- | --- | --- |
| **8320** | `openburnbar-proxy` | Local loopback OpenAI-compatible completions gateway (Ollama / xAI / OpenAI) |
| **1337** | `gateway-shim.js` | Sand agent dispatch, broadcast retries, and local prompt routing |
| **1338** | `runbox.js` | Local host process and sand coordinator |
| **8787** | `proxy2.js` | Bridge between Connect protobuf and local inference stream |
| **1340** | `fakebox.js` | Sand host mock for offline seat validation |
| — | `routine-guard.js` | Routine sync and offline cron management |

> **If another app owns port 8320:** `ensure-local-box.sh` verifies the port's identity at startup. If a foreign service (e.g. another local proxy) holds it, you'll see a loud `WARN` and the gateway starts on a fallback port (`:8330+`) so nothing silently breaks. Free the port (or move the other service) and re-run `bash ~/.grok/grokbot-d/ensure-local-box.sh` to restore full provider routing on `:8320`.

Scripts are also copied to `~/.grok/grokbot-d/`. Official from-agent chrome is not exposed on `sendPrompt`; bot-to-bot still uses `[Bot-to-bot from NAME]:` on the wire. `bot-chatter.js` hides that raw text in the transcript: a run of inter-bot turns collapses to one marker (`3 messages with <Bot>`, `Messaged <marks> 3 Bots`) in each bot’s own colour, and clicking it opens their view-only chat. Outbound sends are read back out of the recipients’ `store.db`, since this box only records them there.

The seat cover draws its own sky. `space-field-gl.js` back-traces **one** event
horizon and paints the nebulae; `space-kernel.js` drifts and breathes that
horizon, then retires it for a fresh one from a different size and disk
temperature band — so succession, not quantity, is where the variety comes from.
Light mode is daybreak, and the sky is computed rather than picked: Rayleigh +
Mie single scattering with their own phase functions, Preetham's closed-form air
mass, a soft-shouldered exposure, and a sun that keeps climbing and drifting on
two periods that never line up. That is where the colour comes from — blue at
the zenith, gold along the sun's line, pale and warm toward the horizon. The
shadow is still black, behind a dark collar and a brighter photon ring; the
nebulae become lit cloud with a sunward rim, blue shade away from it, and
iridescence at the thin edges. It follows `prefers-color-scheme`, which the app
drives through Electron's `themeSource`, so it flips with the app's own theme.

To look at either without changing your theme:

```bash
node -e "require('$HOME/.grok/grokbot-d/command-client').sendCommand('cover',{mode:'light'})"   # or dark / auto
```

The left plasma orb can wear the seat's own face instead of the Grok mark: click
it, then **Seat photo on the orb**. It follows whichever seat is active — the
account photo, or that seat's mascot if the account has none — and the bubble rim
reflects it like any other orb content. The choice lives in
`runtime/ui-prefs.json`, not localStorage, so it survives a seat hop.

Two more switches live there. The button in the selector's chin **pauses the
plasma**: rim, slosh and glow stop and the orbs sit plain — press again for
plasma. And the account chip bottom-left **collapses to its avatar**; click the
puck to bring it back. Both remember across restarts (`orbStyle`,
`chipCollapsed`).

Official Grok Bot B and C are not seats in this app. Do not kill those apps.

## Checks

```bash
node /tmp/grokbot-hack/test-unit.js         # parsers, work-folder exec — no network
node /tmp/grokbot-hack/test-robust.js       # live box
node ~/.grok/grokbot-d/test-bot-chatter.js  # inter-bot markers, no DOM
node ~/.grok/grokbot-d/test-space-holes.js  # cover sky invariants, no DOM
node ~/.grok/grokbot-d/test-install-look.js # clone/install ships icon + kernel + assets
```

`bridge-lib.js` is the shared parser module. `proxy2.js` must require it.

Model picks go through `model-lib.js` so they do not wait on a reconnecting computer. Queued composer sends (“Will send when reconnected”) are flushed via `sendPrompt` in local mode. Live Cursor A chats: `node ~/.grok/grokbot-d/live-cursor-chat.js`.

## Known limits

- `broadcastToAgents` can return `{scheduled:1}` and then drop if the target is already running a turn.
- Brand-new agents are slow on the first reply. Warm agents (D, Robust Bench) are reliable.
- Forced file write/run matches `Write a file at … containing exactly:` plus `Run:` under `/tmp/grokbot-hack` or `~/Documents/Developer`. Secrets (`.ssh`, `.aws`, keychain, `/etc`) stay blocked. Pathless shell (`git --version`, `echo`) is allowed.
- The rigorous suite creates a throwaway bot via `createAgent` and deletes it on the way out.
- `/tmp/grokbot-hack` is ephemeral. Icon source of truth lives in `~/Downloads/grokD_Icon/`.
