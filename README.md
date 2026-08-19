# Grok Bot D

One custom Grok Bot. **Local** bots on this Mac, or **your** Cursor login. Other people install the app — they do not get your chats or tokens.

See `INSTALL.md` to pack and hand it over. Do not zip `profile-data/` or `GrokBotSeat4`.

Strangers should **clone and run `./install.sh`**. That builds D on their Mac (Gatekeeper allows a local build). Do not ship a downloaded `.app` until it is notarized. If an xAI update replaces `app.asar`, launch repairs the overlay hook when possible (`repair-overlay.sh`). Official Cursor fall-over cannot keep the same cloud thread; **Locally · Continue** seeds a local agent with the last turns.

# Local box

Local mode talks to this machine, not to a signed-in cloud box.

| Port | Process | Start |
| --- | --- | --- |
| 1337 | `gateway-shim.js` (idle-wait + broadcast retry) | `ensure-local-box.sh` |
| 1338 | `runbox.js` → host-main | same |
| 8787 | `proxy2.js` | same |
| — | `routine-guard.js` | parks resurrected joke crons |
| — | Grok Bot D.app | `SAND_HOST_GATEWAY_URL=http://127.0.0.1:1337` |

Scripts are also copied to `~/.grok/grokbot-d/`. Official from-agent chrome is not exposed on `sendPrompt`; bot-to-bot still uses `[Bot-to-bot from NAME]:` on the wire. `bot-chatter.js` hides that raw text in the transcript: a run of inter-bot turns collapses to one marker (`3 messages with <Bot>`, `Messaged <marks> 3 Bots`) in each bot’s own colour, and clicking it opens their view-only chat. Outbound sends are read back out of the recipients’ `store.db`, since this box only records them there.

The seat cover draws its own sky: `space-field-gl.js` back-traces the holes (up to
four at once, each with its own disk temperature) and the curtains, while
`space-kernel.js` decides how many there are, drifts and breathes them, and
retires one to make room for the next — so no two covers look alike.

Do not kill **Grok Bot B**.

## Checks

```bash
node /tmp/grokbot-hack/test-unit.js         # parsers, work-folder exec — no network
node /tmp/grokbot-hack/test-robust.js       # live box
node ~/.grok/grokbot-d/test-bot-chatter.js  # inter-bot markers, no DOM
node ~/.grok/grokbot-d/test-space-holes.js  # cover sky invariants, no DOM
```

`bridge-lib.js` is the shared parser module. `proxy2.js` must require it.

Model picks go through `model-lib.js` so they do not wait on a reconnecting computer. Queued composer sends (“Will send when reconnected”) are flushed via `sendPrompt` in local mode. Live Cursor A/B/C chats: `node ~/.grok/grokbot-d/live-cursor-chat.js`.

## Known limits

- `broadcastToAgents` can return `{scheduled:1}` and then drop if the target is already running a turn.
- Brand-new agents are slow on the first reply. Warm agents (D, Robust Bench) are reliable.
- Forced file write/run matches `Write a file at … containing exactly:` plus `Run:` under `/tmp/grokbot-hack` or `~/Documents/Developer`. Secrets (`.ssh`, `.aws`, keychain, `/etc`) stay blocked. Pathless shell (`git --version`, `echo`) is allowed.
- The rigorous suite creates a throwaway bot via `createAgent` and deletes it on the way out.
- `/tmp/grokbot-hack` is ephemeral. Icon source of truth lives in `~/Downloads/grokD_Icon/`.
