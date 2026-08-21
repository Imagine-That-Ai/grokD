# Notes: Alberto's Grok "D" Infrastructure & Target Environment

## Topology & Machines
- **Development Host**: Alberto's MacBook Pro (local workspace at `/Users/albertonunez`, project repo at `/Users/albertonunez/.grok/grokbot-d`).
- **Target Verification Device**: Apple Silicon Mac Mini (`dewclaw@mini`).
  - SSH target: `dewclaw@mini`
  - App install destination: `/Users/dewclaw/Applications/Grok Bot D.app`
  - Runtime & data root: `/Users/dewclaw/.grok/grokbot-d`
  - User Data Dir: `~/Library/Application Support/GrokBotSeat4`
  - Remote Debugging CDP Port: `9224`

## Ports & Daemon Architecture
- **Port 1337**: `gateway-shim.js` — Gateway router forwarding to `:1338`, with local fallback, request normalization, broadcast retries, and instant 200 OK responses for health/status checks.
- **Port 1338**: `runbox.js` -> `host/host-main.cjs` — Local box host orchestrating agent state, transcripts, and SQLite `store.db`.
- **Port 8787**: `proxy2.js` — In-flight reverse proxy & tool execution bridge translating cursorvm/cloud calls into local shell/filesystem/MCP tool executions and Ollama inference (`deepseek-v4-pro:cloud`).
- **Port 1340**: `fakebox.js` — Emulated cloud container endpoint responding to daemon requests.
- **Port 11434**: `ollama` — Local LLM provider hosting `deepseek-v4-pro:cloud`.

## Security & Signing
- **Codesigning Identity**: `Developer ID Application: Imagine That AI Limited Liability Company (4Y367DF25B)`
- **Fallback**: Ad-hoc signature (`codesign -s -`) if keychain is inaccessible.
- **Keychain**: `~/Library/Keychains/login.keychain-db`

## Key Failure Patterns & Regression Invariants
1. **Cloud False-Alarms**: "Couldn't reach computer", "Recover Grok Bot", and "Reconnecting" modals must be blocked/purged in local mode.
2. **UI Stability**: Fixed buttons (e.g. `#gd-scheme-toggle`) must not float over chat, and DOM text modifications must not trigger row-flickering loops.
3. **Deduplicated Handoffs**: Multi-round tool loops must only execute a handoff (`SendToAgent`) once per turn.
4. **Instant Start**: Clean launch must seed default `Local D` agent immediately, skipping the cloud "Getting your team ready..." spinner.
5. **Deterministic Inference**: Prompts must stream from local Ollama back into the UI and SQLite transcript.
