# Exact job: npm `openburnbar proxy` that grokD can one-click install

You are the BurnBar-side agent. GrokD (the consumer) is already wired. Do **not** redesign grokD UI. Do **not** rewrite the Swift daemon. Ship the CLI verb grokD will spawn.

Repo: **Imagine-That-Ai/BurnBar** at `~/Documents/Developer/BurnBar`.
Package: `tools/openburnbar-mcp-remote` (published name `openburnbar`, currently 0.1.2).
Entry: `src/index.ts`. Usage string is there. `app install` already exists and must keep working.

Cheap+fast: **one PR**, this theme only. Fast checks on the door. No Mac-app CI slice. Do not touch the dirty `fix/grdb-row-decode-correctness` branch — branch from latest `main`.

---

## What grokD already does (do not break this)

Consumer tree: `~/.grok/grokbot-d` (canonical) and `~/.grok/grokD-public` (export).

| Contract | Exact value |
|---|---|
| Default proxy target name | `openburnbar` |
| Probe port (lsof LISTEN) | **8320** |
| Completions URL | `http://127.0.0.1:8320/v1/chat/completions` |
| Models URL grokD will hit if you add it | `http://127.0.0.1:8320/v1/models` |
| API key grokD sends | `local-cliproxy` (Authorization: Bearer local-cliproxy) |
| Default model id | `grok-4.6` |
| Install JSON | `GET http://127.0.0.1:1337/install/openburnbar` from `openburnbar-install.js` |
| Seat-in button | `installOpenBurnBar()` in `splash/onboarding.js` |

**Today** that button still runs the Mac-app door:

```js
spawn("npx", ["-y", "openburnbar", "app", "install"], { detached: true, stdio: "ignore" }).unref();
spawn("open", ["-a", "OpenBurnBar"], { detached: true, stdio: "ignore" }).unref();
```

That is the gap. Your job is to make this argv work instead, then grokD will switch the spawn to it:

```bash
npx -y openburnbar proxy --port 8320 --allow-local-key
```

grokD spawns **detached + unref + stdio ignore**. Your process must keep listening after the parent unrefs. Long-running server in that process is correct. Do not exit 0 after “started in background” unless you actually daemonized a child that still owns :8320.

---

## Done means this demo works on a Mac with Node 22, no OpenBurnBar.app required

```bash
# 1. start
npx -y openburnbar proxy --port 8320 --allow-local-key

# 2. in another shell — must 200, not 401
curl -sS -H 'authorization: Bearer local-cliproxy' http://127.0.0.1:8320/v1/models

# 3. must accept OpenAI chat completions (SSE ok)
curl -sS -N -H 'authorization: Bearer local-cliproxy' -H 'content-type: application/json' \
  -d '{"model":"grok-4.6","messages":[{"role":"user","content":"ping"}],"stream":false}' \
  http://127.0.0.1:8320/v1/chat/completions
```

Then grokD: `node ~/.grok/grokbot-d/model-lib.js show` reports `proxyTarget: "openburnbar"` and `portOpen(8320) === true`.

---

## CLI contract (freeze this; grokD will call it)

Add verb `proxy` next to `app` in `src/index.ts`.

```
openburnbar proxy [--port 8320] [--host 127.0.0.1] [--allow-local-key] [--token <token>]
openburnbar proxy status [--port 8320]
openburnbar proxy stop  [--port 8320]
```

Flags:

- `--port` default **8320** (not 8317). grokD already lsof’s 8320.
- `--host` default `127.0.0.1`. Refuse non-loopback unless `--host` is explicit.
- `--allow-local-key` accept `Bearer local-cliproxy` (grokD’s key).
- `--token` optional extra bearer. If neither `--allow-local-key` nor `--token` nor `OPENBURNBAR_GATEWAY_TOKEN`, still accept loopback with `local-cliproxy` **or** print one line and exit 2 telling the user to pass `--allow-local-key`. Prefer accepting `local-cliproxy` on loopback so grokD works with zero extra flags. Then grokD can spawn just `npx -y openburnbar proxy --port 8320`.
- **Preferred spawn grokD will use:** `npx -y openburnbar proxy --port 8320 --allow-local-key`
- `proxy status` prints JSON `{ "listening": true, "port": 8320, "url": "http://127.0.0.1:8320/v1/chat/completions" }` or `listening: false`. Exit 0 if up, 1 if down.
- `proxy stop` SIGTERM the listener on that port if it is this process’s pid file. Do not kill the Swift daemon on 8317.

`--help` must say in one sentence: `app install` puts OpenBurnBar.app on disk; `proxy` starts the local OpenAI gateway; npm i never starts either.

No `postinstall`. No DMG. No `open -a`. No Swift.

---

## Port map (do not confuse these)

| Port | Who |
|---|---|
| **8320** | grokD `TARGETS.openburnbar`. **You bind this.** |
| 8322 | cliproxy. Leave it alone. |
| 8317 | Swift OpenBurnBar daemon (`OPENBURNBAR_GATEWAY_PORT`). Leave it alone. If 8317 is up you MAY optionally reverse-proxy to it as a mode, but grokD still talks to **8320**. |
| 1337 | grokD gateway-shim. Not yours. |

On Alberto’s machine **8320 is currently occupied** by `~/.local/share/codex-cliproxy/tools-budget-proxy.mjs` (cliproxy tool trimmer). If bind fails: exit 1, print the pid/command holding 8320, and tell them to stop that process or pass `--port`. Do not silently sit on 8317 and claim success — grokD will still see 8320 down.

---

## What the process must serve

Minimum:

- `GET /v1/models` → OpenAI list object
- `POST /v1/chat/completions` → OpenAI chat completion, **SSE when `stream: true`**
- Loopback only
- Accept `Authorization: Bearer local-cliproxy`

Routing: match `docs/ROUTED_CLIENT_GATEWAY.md` as far as you can in Node (provider-family failover). If full Swift-parity cannot land in this PR, ship **two labeled modes**:

1. **standalone** (default): env-provided provider keys, real completions on :8320
2. **forward**: if `OPENBURNBAR_UPSTREAM=http://127.0.0.1:8317` and that port is up, forward (and map grokD’s `local-cliproxy` to the daemon token if `OPENBURNBAR_GATEWAY_TOKEN` is set)

Print the mode at start: `openburnbar proxy standalone :8320` or `openburnbar proxy forward :8320 -> :8317`. Do not pretend a 20-line reverse proxy is the router.

---

## After the bin works: flip grokD’s one spawn (allowed, tiny)

Only these grokD files, and only the install command:

1. `~/.grok/grokbot-d/splash/onboarding.js` `installOpenBurnBar()` → spawn  
   `npx -y openburnbar proxy --port 8320 --allow-local-key`  
   (detached, stdio ignore, unref). Remove `open -a OpenBurnBar` from that path.
2. `~/.grok/grokbot-d/openburnbar-install.js` set `npmProxy: true` and  
   `install.proxy: "npx -y openburnbar proxy --port 8320 --allow-local-key"`. Keep `macApp` as the optional full-app door.
3. Copy those two files to `~/.grok/grokD-public/`.
4. Run `node ~/.grok/grokbot-d/test-install-openburnbar.js`.

Do not touch `profile-ui-inject.js` (seats menu). Do not retarget cliproxy.

---

## Tests (this package, no Xcode)

- Bind :8320 (or an ephemeral port in tests), `/v1/models` 200 with bearer `local-cliproxy`
- 401 without a key when `--allow-local-key` is off **and** no loopback exception — pick one policy, test it, document it. grokD needs the allow path green.
- Fixture non-stream chat completion
- Fixture stream=true has `data:` frames
- `proxy status` / EADDRINUSE message
- Existing `app install` tests still pass
- `npm test` in `tools/openburnbar-mcp-remote`

Publish is Alberto’s call. Land the PR so `npx -y openburnbar@<your version> proxy --port 8320 --allow-local-key` is the install.

---

## First commands

```bash
cd ~/Documents/Developer/BurnBar
git fetch origin && git checkout main && git pull
cd tools/openburnbar-mcp-remote
rg -n "first === \"app\"|USAGE|never touches the daemon" src
npm test
```

Do not start until you can say the argv grokD will spawn in one line.
