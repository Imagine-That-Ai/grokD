# Grok Bot D

One custom Grok Bot. **Local** bots on this Mac, or **your** Cursor login. Other people install the app — they do not get your chats or tokens.

See `INSTALL.md` to pack and hand it over. Do not zip `profile-data/` or `GrokBotSeat4`.

# Local box

Local mode talks to this machine, not to a signed-in cloud box.

| Port | Process | Start |
| --- | --- | --- |
| 1337 | `gateway-shim.js` (idle-wait + broadcast retry) | `ensure-local-box.sh` |
| 1338 | `runbox.js` → host-main | same |
| 8787 | `proxy2.js` | same |
| — | `routine-guard.js` | parks resurrected joke crons |
| — | Grok Bot D.app | `SAND_HOST_GATEWAY_URL=http://127.0.0.1:1337` |

Scripts are also copied to `~/.grok/grokbot-d/`. Official from-agent chrome is not exposed on `sendPrompt`; bot-to-bot still uses `[Bot-to-bot from NAME]:`.

Do not kill **Grok Bot B**.

## Checks

```bash
node /tmp/grokbot-hack/test-unit.js     # parsers, path jail — no network
node /tmp/grokbot-hack/test-robust.js   # live box
```

`bridge-lib.js` is the shared parser module. `proxy2.js` must require it.

Model picks go through `model-lib.js` so they do not wait on a reconnecting computer. Queued composer sends (“Will send when reconnected”) are flushed via `sendPrompt` in local mode. Live Cursor A/B/C chats: `node ~/.grok/grokbot-d/live-cursor-chat.js`.

## Known limits

- `broadcastToAgents` can return `{scheduled:1}` and then drop if the target is already running a turn.
- Brand-new agents are slow on the first reply. Warm agents (D, Robust Bench) are reliable.
- Forced file write/run only matches `Write a file at /tmp/grokbot-hack/... containing exactly:` plus `Run:` with paths under that root.
- `/tmp/grokbot-hack` is ephemeral. Icon source of truth lives in `~/Downloads/grokD_Icon/`.
