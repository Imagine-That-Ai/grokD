# grok"D" profiles

D is the one app. A profile is **who you are** (local box or a Cursor identity) plus the bots that come with that seat.

First-run **Seat in** can add **more than one** Cursor login (sign in again, or import another official Grok Bot). Each login is its own seat. Secrets stay in `profile-data/<id>/`.

## Built-in

| Profile | Kind | What it opens |
| --- | --- | --- |
| Local D | local | The local box on `:1337` |
| Grok A | cursor | Optional import of official Grok Bot on this Mac |
| Grok B / C | — | Not seats in D |
| (new Cursor) | cursor | Sign in here — no other Grok Bot required |

## CLI

```bash
node ~/.grok/grokbot-d/switch-profile.js list
node ~/.grok/grokbot-d/switch-profile.js switch local-d
node ~/.grok/grokbot-d/switch-profile.js switch local-d --takeover
node ~/.grok/grokbot-d/switch-profile.js switch cursor-a
node ~/.grok/grokbot-d/switch-profile.js add --name "My Cursor" --kind cursor
node ~/.grok/grokbot-d/switch-profile.js add --name "Work" --kind cursor --from A
```

Plain `switch local-d` restores the local box (bots, secrets, chats, `openburnbar` / `grok-4.6` unless that seat saved another proxy). It also drops any leftover Cursor VM connection so the sidebar is the local roster.

`--takeover` (seat menu: **Continue this chat on Local D**) keeps the open Cursor thread and settings, points the computer at `:1337`, and seeds a local agent that continues that thread on local models.

Switching the same profile is a no-op (does not replay a stale snapshot over live box-data).

Removing a profile deletes `profile-data/<id>/`. Cursor apply fails if that seat’s `sand-secrets.json` is missing.

Official Grok Bot B/C apps stay on the Mac. They are not seats in D.

## Stop / Resume (per seat)

The seat chip stop square toggles **this seat only**. Each identity row in the seat menu has its own stop switch.

Stop parks that seat’s routines and interrupts its in-flight turns. Resume turns back on only what that seat’s Stop parked. Does not kill official Grok Bot apps.

```bash
node ~/.grok/grokbot-d/bot-pause.js status
node ~/.grok/grokbot-d/bot-pause.js pause cursor-a
node ~/.grok/grokbot-d/bot-pause.js pause cursor-a
node ~/.grok/grokbot-d/bot-pause.js resume cursor-a
```

`proxy2.js` will not fire **local** routines while Local D is paused. Cursor pauses do not park the local box.

## Fall over

Toggles in the same seat menu. Short labels; full mechanics on hover. All off until you turn them on.

1. **Auto Failover** — master quota switch.
2. **Next Account** — switch to a seat that still has quota.
3. **Locally · Chief Handoff** — delegate to the local chief.
4. **Locally · Continue** — copy the bot onto this Mac when a local `store.db` exists. Official Cursor chats cannot keep the same cloud thread; D seeds a local agent with the last captured turns and continues on this Mac.

When the paying seat is spent, that seat is stopped first, then the first enabled path runs.

```bash
node ~/.grok/grokbot-d/failover.js evaluate
node ~/.grok/grokbot-d/failover-watch.js once
```

Fall over stays **off** until the master switch is on. Evaluate never switches by itself; `failover-act.js` is the only writer, and it always pauses the spent seat first.

Tests: `test-profiles.js`, `test-profile-switch-live.js`, `test-models.js`, `test-edges.js`, `test-bot-pause.js`, `test-failover.js`, `test-failover-act.js`, `test-quota-hover.js`, `test-clone-handoff.js`.

## Models

The official picker tries to save the default model on the computer. When the local box transport is down, that save fails and the composer shows **Will send when reconnected**.

D writes the pick to `model-config.json` (OpenBurnBar `:8320` by default, falling back to cliproxy `:8322` if that target is down) and flushes a queued composer send through `sendPrompt`. The Profiles bar has a MODEL menu that applies immediately.

The published `openburnbar` npm package does **not** start this proxy. It installs the Mac app (`npx -y openburnbar app install`). The OpenAI gateway is the app daemon (`127.0.0.1:8317`). grokD’s `openburnbar` target currently talks to `:8320`. First-run Seat in lists OpenBurnBar first, with **Install & use** when it is down. Same JSON at `GET http://127.0.0.1:1337/install/openburnbar`.

```bash
node ~/.grok/grokbot-d/model-lib.js show
node ~/.grok/grokbot-d/model-lib.js set grok-4.6 openburnbar
```

## Live Cursor chats

Switching to Grok A relaunches D on that seat’s Cursor identity (copies `sand-secrets` + chats into Seat4, unsets `:1337`). The in-window command bus can send a real composer turn.

Tests: `test-profiles.js`, `test-profile-switch-live.js`, `test-models.js`, `test-edges.js`.
