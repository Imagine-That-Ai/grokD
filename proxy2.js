#!/usr/bin/env node
// Grok Bot takeover proxy v2 — pass-through + EnsureSandBox rewrite to fake box
// + quota faking. Usage: node proxy2.js [listenPort]

const http = require("http");
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const { tryParse, encode, rewriteProto } = require("./protoutil");
const localMcp = require("./local-mcp");
const bridgeLib = require("./bridge-lib");

const MODEL_CONFIG_PATH = "/tmp/grokbot-hack/model-config.json";

// ---- cron engine + automation firing (bridge-native routines) ----
function cronFieldSet(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(",")) {
    const [range, stepStr] = part.split("/");
    let step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isFinite(step) || step < 1) step = 1;
    let lo, hi;
    if (!range || range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-"); lo = parseInt(a, 10); hi = parseInt(b, 10); }
    else { lo = parseInt(range, 10); hi = stepStr ? max : lo; }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v);
  }
  return out;
}
function nextCronAfter(cron, afterMs) {
  try {
    const f = String(cron).trim().split(/\s+/);
    if (f.length < 5) return null;
    const mins = cronFieldSet(f[0], 0, 59), hrs = cronFieldSet(f[1], 0, 23);
    const doms = cronFieldSet(f[2], 1, 31), mons = cronFieldSet(f[3], 1, 12);
    const dows = cronFieldSet(f[4], 0, 7); if (dows.has(7)) { dows.add(0); dows.delete(7); }
    const domStar = f[2] === "*", dowStar = f[4] === "*";
    const d = new Date(afterMs); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      if (mons.has(d.getMonth() + 1)) {
        const domOk = doms.has(d.getDate()), dowOk = dows.has(d.getDay());
        const dayOk = domStar && dowStar ? true : domStar ? dowOk : dowStar ? domOk : (domOk || dowOk);
        if (dayOk && hrs.has(d.getHours()) && mins.has(d.getMinutes())) return d.getTime();
      }
      d.setMinutes(d.getMinutes() + 1);
    }
    return null;
  } catch { return null; }
}
function sandAutomationId(agentId, localId) { // port of host Db(): sha256 -> uuid-ish
  const n = crypto.createHash("sha256").update(`${agentId}\0${localId}`).digest("hex");
  const r = (Number.parseInt(n[16] ?? "0", 16) & 3 | 8).toString(16);
  return `${n.slice(0, 8)}-${n.slice(8, 12)}-5${n.slice(13, 16)}-${r}${n.slice(17, 20)}-${n.slice(20, 32)}`;
}
const AUTOMATION_RUNS_PATH = "/tmp/grokbot-hack/automation-runs.json";
function handleAutomationPoll(bodyBuf) {
  const out = { events: [], nextPollAfterMs: 15000 };
  try {
    try {
      const pause = require(require("os").homedir() + "/.grok/grokbot-d/bot-pause");
      if (pause && pause.shouldFireAutomation && !pause.shouldFireAutomation()) {
        return JSON.stringify(out);
      }
    } catch {}
    let acks = [];
    try { const j = JSON.parse(bodyBuf.toString() || "{}"); if (Array.isArray(j.ackRunUuids)) acks = j.ackRunUuids; } catch {}
    let runs = {};
    try { runs = JSON.parse(fs.readFileSync(AUTOMATION_RUNS_PATH, "utf8")); } catch {}
    for (const id of acks) delete runs[id];
    const now = Date.now();
    for (const k of Object.keys(runs)) if (now - runs[k].firedAt > 600000) delete runs[k];
    for (const agentId of fs.readdirSync("/tmp/grokbot-hack/box-data/agents")) {
      const autDir = `/tmp/grokbot-hack/box-data/agents/${agentId}/automations`;
      let ents = [];
      try { ents = fs.readdirSync(autDir, { withFileTypes: true }); } catch { continue; }
      for (const ent of ents) {
        if (!ent.isDirectory()) continue;
        const localId = ent.name;
        const p = `${autDir}/${localId}/automation.json`;
        let cfg;
        try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
        if (cfg.enabled === false) continue;
        const cron = typeof cfg.schedule === "string" ? cfg.schedule
          : (cfg.trigger && cfg.trigger.type === "cron" && typeof cfg.trigger.cron === "string") ? cfg.trigger.cron : null;
        if (!cron) continue;
        const last = typeof cfg.lastRunAt === "number" ? cfg.lastRunAt : (cfg.createdAt || now - 60000);
        const next = nextCronAfter(cron, last);
        if (next != null && next <= now) {
          const runId = crypto.randomUUID();
          out.events.push({ id: runId, sandAgentId: agentId, automationId: sandAutomationId(agentId, localId), timestampMs: now });
          runs[runId] = { agentId, localId, firedAt: now };
          cfg.lastRunAt = now;
          try { fs.writeFileSync(p, JSON.stringify(cfg, null, 2)); } catch {}
          console.log(`[automation] firing '${cfg.name}' agent=${agentId.slice(0, 8)} cron=${cron} run=${runId.slice(0, 8)}`);
          // Host often drops scheduled fires (user_away_paused / hash mismatch).
          // Actually run the prompt so routines produce chat, not just lastRunAt.
          const prompt = String(cfg.prompt || "").trim();
          if (prompt) {
            fetch("http://127.0.0.1:1337/api/sendPrompt", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: "Bearer fake-gateway-token" },
              body: JSON.stringify({ agentId, prompt: `[Routine: ${cfg.name}] ${prompt}`, awaitTurn: false }),
            }).then((r) => console.log(`[automation] sendPrompt '${cfg.name}' -> ${r.status}`))
              .catch((e) => console.log(`[automation] sendPrompt failed: ${e.message}`));
          }
        }
      }
    }
    try { fs.writeFileSync(AUTOMATION_RUNS_PATH, JSON.stringify(runs)); } catch {}
  } catch (e) { console.log(`[automation] poll error: ${e.message}`); }
  return JSON.stringify(out);
}

const TARGET_DEFAULT_URLS = {
  openburnbar: "http://127.0.0.1:8320/v1/chat/completions",
  cliproxy: "http://127.0.0.1:8322/v1/chat/completions",
  vibeproxy: "http://127.0.0.1:8325/v1/chat/completions",
  ollama: "http://127.0.0.1:11434/v1/chat/completions",
  podex: "http://127.0.0.1:8484/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  vercel: "https://ai-gateway.vercel.sh/v1/chat/completions",
  fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
  baseten: "https://bridge.baseten.co/v1/chat/completions",
  cloudflare: "https://api.cloudflare.com/client/v4/accounts/ai/v1/chat/completions",
  wafer: "https://api.wafer.ai/v1/chat/completions",
  modal: "https://api.modal.run/v1/chat/completions"
};

function getModelConfig() {
  try {
    const lib = require(require("os").homedir() + "/.grok/grokbot-d/model-lib.js");
    return lib.resolveConfig();
  } catch (e) {}
  try {
    if (fs.existsSync(MODEL_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8"));
      const target = cfg.proxyTarget === "vibeproxy" ? "cliproxy" : (cfg.proxyTarget || "openburnbar");
      const defaultUrl = TARGET_DEFAULT_URLS[target] || TARGET_DEFAULT_URLS.openburnbar;
      const defaultKey = (target === "openburnbar" || target === "cliproxy" || target === "vibeproxy") ? "local-cliproxy" : (process.env[`${target.toUpperCase()}_API_KEY`] || "local-cliproxy");

      return {
        proxyUrl: cfg.proxyUrl || defaultUrl,
        apiKey: cfg.apiKey || defaultKey,
        model: cfg.model || "grok-4.6",
        proxyTarget: target,
        cursorAccount: cfg.cursorAccount || "Primary Cursor Account",
        payingProfileId: cfg.payingProfileId || null,
      };
    }
  } catch (e) {}
  return {
    proxyUrl: TARGET_DEFAULT_URLS.openburnbar,
    apiKey: "local-cliproxy",
    model: "grok-4.6",
    proxyTarget: "openburnbar",
    cursorAccount: "Primary Cursor Account",
    payingProfileId: null,
  };
}

function payingHeaders(cfg) {
  const h = {};
  const id = cfg && (cfg.payingProfileId || cfg.cursorAccount);
  if (id) {
    h["x-grok-d-paying"] = String(id);
    h["x-cursor-account"] = String(cfg.cursorAccount || id);
  }
  return h;
}

// ---- connect streaming helpers ----
function connectFrame(payload) { // flags=0, len BE32
  const h = Buffer.alloc(5);
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}
function encodeVarint(value) {
  let n = BigInt(value);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return Buffer.from(out);
}

function pbString(fieldNo, s) {
  const body = Buffer.from(s, "utf8");
  return Buffer.concat([encodeVarint((fieldNo << 3) | 2), encodeVarint(body.length), body]);
}

// extract conversation from StreamUnifiedChatRequest (field1=repeated ConversationMessage{text=1,type=2(USER=2/AI=1)})
function extractConversation(reqBuf) {
  const fields = tryParse(reqBuf);
  if (!fields) return [];
  const msgs = [];
  for (const f of fields) {
    if (f.fieldNo === 1 && f.wireType === 2) {
      const sub = tryParse(f.value);
      if (!sub) continue;
      let text = null, type = null;
      for (const sf of sub) {
        if (sf.fieldNo === 1 && sf.wireType === 2) text = sf.value.toString("utf8");
        if (sf.fieldNo === 2 && sf.wireType === 0) type = Number(sf.value);
      }
      if (text != null && text.length > 0) msgs.push({ role: type === 2 ? "user" : "assistant", text });
    }
  }
  return msgs;
}

// ---- helpers for tool bridge ----
function decodeStructToJson(buf) {
  const fields = tryParse(buf);
  if (!fields) return {};
  const obj = {};
  for (const f of fields) {
    if (f.fieldNo !== 1 || f.wireType !== 2) continue;
    const ent = tryParse(f.value);
    if (!ent) continue;
    let k = null, vBuf = null;
    for (const ef of ent) {
      if (ef.fieldNo === 1 && ef.wireType === 2) k = ef.value.toString("utf8");
      if (ef.fieldNo === 2 && ef.wireType === 2) vBuf = ef.value;
    }
    if (k != null && vBuf != null) obj[k] = _decodeValue(vBuf);
  }
  return obj;
}
function _decodeValue(buf) {
  const fields = tryParse(buf);
  if (!fields || fields.length === 0) return null;
  for (const f of fields) {
    if (f.fieldNo === 1) return null;
    if (f.fieldNo === 2 && f.wireType === 1) return f.value.readDoubleLE(0);
    if (f.fieldNo === 3 && f.wireType === 2) return f.value.toString("utf8");
    if (f.fieldNo === 4 && f.wireType === 0) return Boolean(Number(f.value));
    if (f.fieldNo === 5 && f.wireType === 2) return decodeStructToJson(f.value);
    if (f.fieldNo === 6 && f.wireType === 2) {
      const lw = tryParse(f.value);
      const arr = [];
      for (const vf of (lw || [])) if (vf.fieldNo === 1) arr.push(_decodeValue(vf.value));
      return arr;
    }
  }
  return null;
}

function extractTools(reqBuf) {
  const fields = tryParse(reqBuf);
  if (!fields) return [];
  const tools = [];
  for (const f of fields) {
    if (f.fieldNo !== 2 || f.wireType !== 2) continue;
    const sub = tryParse(f.value);
    if (!sub) continue;
    let name = null, desc = null, paramsBytes = null;
    for (const sf of sub) {
      if (sf.fieldNo === 1 && sf.wireType === 2) name = sf.value.toString("utf8");
      if (sf.fieldNo === 2 && sf.wireType === 2) desc = sf.value.toString("utf8");
      if (sf.fieldNo === 3 && sf.wireType === 2) paramsBytes = sf.value;
    }
    if (!name) continue;
    let parameters = null;
    if (paramsBytes) {
      const j = decodeStructToJson(paramsBytes);
      // Box wraps JSON schema inside {jsonSchema: {...}} for some tools
      parameters = j.jsonSchema || j;
      if (!parameters || typeof parameters !== "object" || !parameters.type) parameters = null;
    }
    tools.push({ type: "function", function: { name, description: (desc || "").slice(0, 3000), parameters: parameters || { type: "object", properties: {} } } });
  }
  return tools;
}

function setThinking(state) {
  try {
    fs.writeFileSync("/tmp/grokbot-hack/is-thinking.json", JSON.stringify({ thinking: state, ts: Date.now() }));
  } catch {}
}

// InferenceService/Stream bridge: request messages(n1){role=1(1 user/2 asst/4 system), text=2}
// response text_part(tQ){text=1, is_final=2} + tool_call_part(rQ){1:id,2:name,3:args,4:is_complete} + response_info(sQ)
async function bridgeInference(reqBuf, res, id) {
  setThinking(true);
  try {
    return await _bridgeInferenceImpl(reqBuf, res, id);
  } finally {
    setThinking(false);
  }
}

async function _bridgeInferenceImpl(reqBuf, res, id) {
  // New model-selector code removed the old globals; derive per-request config
  // so this bridge path honors model-config.json (gpt-5.6-luna via cliproxy).
  const _cfg = getModelConfig();
  const CLIPROXY = _cfg.proxyUrl, CLIPROXY_KEY = _cfg.apiKey, BRIDGE_MODEL = _cfg.model;
  const fields = tryParse(reqBuf);
  if (!fields) return res.end();
  const messages = [];
  for (const f of fields) {
    if (f.fieldNo !== 1 || f.wireType !== 2) continue;
    const sub = tryParse(f.value);
    if (!sub) continue;
    let role = null, text = null;
    for (const sf of sub) {
      if (sf.fieldNo === 1 && sf.wireType === 0) role = Number(sf.value);
      if (sf.fieldNo === 2 && sf.wireType === 2) text = sf.value.toString("utf8"); // legacy flat oneof
      if (sf.fieldNo === 3 && sf.wireType === 2) {
        // n1 field3 = parts(KM) -> {1: repeated r1}; r1 field1 = text(Bv) -> {1: text string}
        const km = tryParse(sf.value);
        if (km) {
          const texts = [];
          for (const pf of km) {
            if (pf.fieldNo !== 1 || pf.wireType !== 2) continue;
            const r1 = tryParse(pf.value);
            if (!r1) continue;
            for (const rf of r1) {
              if (rf.fieldNo === 1 && rf.wireType === 2) {
                const bv = tryParse(rf.value);
                if (bv) for (const bf of bv) if (bf.fieldNo===1 && bf.wireType===2) texts.push(bf.value.toString("utf8"));
              }
            }
          }
          if (texts.length) text = texts.join("\n");
        }
      }
    }
    if (text == null) continue;
    const rmap = { 1: "user", 2: "assistant", 4: "system" };
    let content = text;
    // Box nests user input as <user_query>[t0u] Say the word pineapple ... <system_reminder>...
    // Extract the real query, strip timestamp/system wrapper
    const uq = content.match(/<user_query>\s*\n?([\s\S]*?)\n?\s*(?:<system_reminder>|<\/user_query>)/);
    if (uq) content = uq[1].replace(/^\[t0u\]\s*\n?/, "").trim();
    // Also strip leading <timestamp>...</timestamp> wrapper that sometimes precedes <user_query>
    content = content.replace(/^<timestamp>[\s\S]*?<\/timestamp>\s*\n?/, "").trim();
    if (!content || !content.trim()) continue;
    messages.push({ role: rmap[role] || "user", content: content.slice(0, 24000) });
  }
  const tools = extractTools(reqBuf);
  // Bridge-native routine tool: this fleet has NO automation tool, but the
  // host persists routines as <agent>/automations/<id>/automation.json and
  // fires them from the poll endpoint we answer. Expose creation to the model.
  const ROUTINE_TOOL = { type: "function", function: { name: "CreateRoutine", description: "Create a recurring routine (cron schedule) that automatically runs a prompt on an agent. Use for any 'every minute/hour/day' or scheduled/recurring request.", parameters: { type: "object", properties: { name: { type: "string", description: "Short routine name" }, cron: { type: "string", description: "Standard 5-field cron (minute hour day-of-month month day-of-week), timezone America/Chicago. 'every minute' = '* * * * *', daily 8:26am = '26 8 * * *'." }, prompt: { type: "string", description: "The prompt to run each fire" }, target_agent: { type: "string", description: "Agent NAME to run it on (default: yourself)" } }, required: ["name", "cron", "prompt"] } } };
  if (tools.some((t) => t.function?.name === "SendMessage")) tools.push(ROUTINE_TOOL);
  // Reconstruct answered turns: this box sends ONLY user messages to the
  // model. Replay our delivered assistant replies after their prompts so the
  // model sees coherent alternation — otherwise stale exact-reply
  // instructions (e.g. "reply with exactly pineapples") leak into every
  // later turn and get re-obeyed.
  const ANSWERED = globalThis.__grokdAnsweredTurns || (globalThis.__grokdAnsweredTurns = new Map());
  {
    const rebuilt = [];
    for (let i = 0; i < messages.length; i++) {
      rebuilt.push(messages[i]);
      const m = messages[i];
      if (m.role === "user") {
        const key = m.content.slice(0, 120);
        const ans = ANSWERED.get(key);
        const next = messages[i + 1];
        if (ans && (!next || next.role !== "assistant")) rebuilt.push({ role: "assistant", content: ans });
      }
    }
    messages.length = 0; messages.push(...rebuilt);
  }
  console.log(`[${id}] BRIDGE-infer ${messages.length} msgs, ${tools.length} tools, model=${BRIDGE_MODEL}`);
  if (messages.length) {
    const last = messages[messages.length - 1];
    console.log(`[${id}]   last(${last.role}): ${last.content.slice(0, 120).replace(/\n/g, " ")}`);
  }
  function getActivePersonaPrompt() {
    try {
      const activeProf = JSON.parse(fs.readFileSync("/tmp/grokbot-hack/active-profile.json", "utf8")).active || "grok-d";
      const personas = JSON.parse(fs.readFileSync("/tmp/grokbot-hack/personas_data.json", "utf8"));
      let customProfiles = [];
      if (fs.existsSync("/tmp/grokbot-hack/custom-profiles.json")) {
        customProfiles = JSON.parse(fs.readFileSync("/tmp/grokbot-hack/custom-profiles.json", "utf8"));
      }
      let targetPersona = personas[0]; // Bad Boi default
      const prof = customProfiles.find(p => p.id === activeProf);
      if (prof && prof.personaId) {
        const per = personas.find(p => p.id === prof.personaId);
        if (per) targetPersona = per;
      } else if (activeProf === "grok-a") targetPersona = personas[3]; // Nerd
      else if (activeProf === "grok-b") targetPersona = personas[1]; // Nice Girl
      else if (activeProf === "grok-c") targetPersona = personas[2]; // Smoker
      else if (activeProf === "grok-d") targetPersona = personas[0]; // Bad Boi

      let subBotsPrompt = "";
      if (fs.existsSync("/tmp/grokbot-hack/sub-bots.json")) {
        try {
          const subs = JSON.parse(fs.readFileSync("/tmp/grokbot-hack/sub-bots.json", "utf8"));
          if (subs.length) {
            subBotsPrompt = ` Attached Specialist Sub-Bots: ${subs.map(s => `${s.name} (${s.skills.join(', ')})`).join('; ')}.`;
          }
        } catch {}
      }

      return `\n${targetPersona.voicePrompt}\nCore System Directives: ${targetPersona.systemDescription}\nActive Specialized Skills: ${targetPersona.skills.join(', ')}.${subBotsPrompt}`;
    } catch (e) {}
    return "";
  }

  const personaVoice = getActivePersonaPrompt();
  const ENV_HINT = `Environment: LOCAL rig on Alberto's Mac. Shell/ExternalShell run live on this machine (projects under /Users/albertonunez, gh/npm/git/Brew available). Read/WebSearch/WebFetch work. GetMcpTools/CallMcpTool run via bridge. Don't claim tools are unavailable — use them. ${personaVoice}`;
  const payload = [
    { role: "system", content: ENV_HINT },
    ...messages.slice(-40),
  ];
  // The box already includes the full system prompt + kickstart in the first messages, so no extra system needed
  const pbVarint = (fieldNo, v) => {
    const out = [Buffer.from([(fieldNo << 3) | 0])];
    let n = BigInt(v);
    const b = [];
    do { let x = Number(n & 0x7fn); n >>= 7n; if (n > 0n) x |= 0x80; b.push(x); } while (n > 0n);
    out.push(Buffer.from(b));
    return Buffer.concat(out);
  };
  const callCliproxy = async (msgs, toolList, toolChoice, attempt = 0) => {
    const body2 = { model: BRIDGE_MODEL, messages: msgs, stream: true };
    if (toolList?.length) body2.tools = toolList;
    if (toolChoice) body2.tool_choice = toolChoice;
    let up2;
    try {
      up2 = await fetch(CLIPROXY, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json", authorization: `Bearer ${CLIPROXY_KEY}` }, payingHeaders(getModelConfig())),
        body: JSON.stringify(body2),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      if (attempt < 3) { const w = 1500 * (attempt + 1); console.log(`[${id}] BRIDGE cliproxy network err (${e.message}) — retry ${attempt + 1} in ${w}ms`); await new Promise((r) => setTimeout(r, w)); return callCliproxy(msgs, toolList, toolChoice, attempt + 1); }
      throw e;
    }
    if ((up2.status === 429 || up2.status >= 500) && attempt < 4) {
      const w = 2000 * (attempt + 1) * (attempt + 1); // 2s, 8s, 18s, 32s
      console.log(`[${id}] BRIDGE cliproxy ${up2.status} — retry ${attempt + 1} in ${w}ms`);
      await new Promise((r) => setTimeout(r, w));
      return callCliproxy(msgs, toolList, toolChoice, attempt + 1);
    }
    if (!up2.ok || !up2.body) throw new Error(`cliproxy ${up2.status}`);
    const reader2 = up2.body.getReader();
    const dec2 = new TextDecoder();
    let buf2 = "", full2 = "";
    const tcs2 = new Map();
    for (;;) {
      const { done, value } = await reader2.read();
      if (done) break;
      buf2 += dec2.decode(value, { stream: true });
      let nl2;
      while ((nl2 = buf2.indexOf("\n")) !== -1) {
        const line = buf2.slice(0, nl2).trim(); buf2 = buf2.slice(nl2 + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) full2 += delta.content;
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const cur = tcs2.get(idx) || { id: "", function: { name: "", arguments: "" } };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name = tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              tcs2.set(idx, cur);
            }
          }
        } catch {}
      }
    }
    return { full: full2, tcs: [...tcs2.values()] };
  };

  // Host loop semantics (verified empirically): a step whose tool calls are
  // ONLY SendMessage ends the turn after delivery, and the host build never
  // feeds tool results into a next step for these bot turns. So we run the
  // work loop HERE: execute shell-family tools locally in the bridge, feed
  // results back to the model, and deliver a single final SendMessage.
  const SHELL_TOOLS = new Set(["Shell", "ExternalShell"]);
  const READ_TOOLS = new Set(["Read", "ExternalRead"]);
  // Tools the bridge can fully execute itself. Everything else goes to the
  // host, and a SendMessage is ALWAYS emitted alongside so a turn can never
  // end silent (this build runs single-step turns: host tool results are
  // never fed back to the model, so work must complete inside the bridge).
  const LOCAL_TOOLS = new Set([...SHELL_TOOLS, ...READ_TOOLS, "TodoWrite", "AwaitExternalShell", "WebFetch", "WebSearch", "CallMcpTool", "GetMcpTools", "SendToAgent", "CreateRoutine"]);
  const isShellCall = (tc) => SHELL_TOOLS.has(tc.function?.name) && (() => { try { return typeof JSON.parse(tc.function.arguments || "{}").command === "string"; } catch { return false; } })();
  const parseArgs = (tc) => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } };
  const isLocalCall = (tc) => {
    const name = tc.function?.name;
    if (!LOCAL_TOOLS.has(name)) return false;
    const a = parseArgs(tc);
    if (SHELL_TOOLS.has(name)) return typeof a.command === "string" && a.command.trim().length > 0;
    if (READ_TOOLS.has(name)) return typeof a.path === "string" && a.path.trim().length > 0;
    if (name === "WebFetch") return typeof a.url === "string" && /^https?:\/\//i.test(a.url);
    if (name === "WebSearch") return typeof (a.search_term || a.query || a.q) === "string" && String(a.search_term || a.query || a.q).trim().length > 0;
    if (name === "CallMcpTool") return typeof a.server === "string" && typeof a.toolName === "string" && a.server.trim().length > 0 && a.toolName.trim().length > 0;
    if (name === "SendToAgent") {
      const target = a.target_id || a.agent_id || a.target || a.name;
      const msg = a.message || a.content || a.text;
      return typeof target === "string" && target.trim().length > 0 && typeof msg === "string" && msg.trim().length > 0;
    }
    if (name === "CreateRoutine") return typeof a.name === "string" && typeof a.cron === "string" && typeof a.prompt === "string";
    return true; // TodoWrite, AwaitExternalShell
  };
  const BOX_WS = "/tmp/grokbot-hack/box-data/workspace";
  const resolveReadPath = (p) => {
    let path = String(p);
    if (path.startsWith("/workspace/")) path = BOX_WS + path.slice("/workspace".length); // box-relative → real
    return path;
  };
  const runReadLocally = async (tc) => {
    const a = parseArgs(tc);
    const path = resolveReadPath(a.path);
    try {
      const fsOk = require("fs");
      const st = fsOk.statSync(path);
      if (st.isDirectory()) {
        const items = fsOk.readdirSync(path).slice(0, 200).join("\n");
        return `directory listing of ${path}:\n${items}`;
      }
      let text = fsOk.readFileSync(path, "utf8");
      const lines = text.split("\n");
      if (typeof a.offset === "number" || typeof a.limit === "number") {
        const off = Math.max(0, (a.offset || 1) - 1);
        const lim = typeof a.limit === "number" ? a.limit : 2000;
        text = lines.slice(off, off + lim).join("\n");
        text = `(lines ${off + 1}-${off + Math.min(lim, Math.max(0, lines.length - off))} of ${lines.length})\n${text}`;
      }
      const bytes = Buffer.byteLength(text);
      if (bytes > 16000) text = text.slice(0, 16000) + `\n…[truncated, file is ${bytes}B — read with offset/limit for more]`;
      console.log(`[${id}] BRIDGE read local: ${path} -> ${bytes}B`);
      return text.length ? text : "(empty file)";
    } catch (e) {
      return `error reading ${path}: ${e && e.message || e}`;
    }
  };
  const runFetchLocally = async (tc) => {
    const a = parseArgs(tc);
    const url = String(a.url);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
      const ct = r.headers.get("content-type") || "";
      if (!/text|json|xml|html/i.test(ct)) return `fetched ${url}: ${r.status} ${ct} (binary, not inlined)`;
      let text = await r.text();
      if (text.length > 12000) text = text.slice(0, 12000) + "\n…[truncated]";
      console.log(`[${id}] BRIDGE fetch local: ${url} -> ${r.status}, ${text.length}B`);
      return `HTTP ${r.status}\n${text}`;
    } catch (e) {
      return `error fetching ${url}: ${e && e.message || e}`;
    }
  };
  const searchDDG = async (term) => {
    const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(term)}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", accept: "text/html" },
    });
    if (r.status !== 200) return null; // 202/403 = throttled
    const html = await r.text();
    const picks = [];
    const re = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && picks.length < 8) {
      let url = m[1];
      if (url.startsWith("//")) url = "https:" + url;
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]); // unwrap DDG redirect
      if (!/^https?:\/\//i.test(url)) continue;
      const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
      if (!title) continue;
      picks.push({ url, title });
    }
    return picks.length ? picks : null;
  };
  const searchBingRSS = async (term) => {
    const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(term)}&format=rss`, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
    });
    if (r.status !== 200) return null;
    const xml = await r.text();
    const picks = [];
    const re = /<item><title>([\s\S]*?)<\/title><link>([\s\S]*?)<\/link>/g;
    let m;
    while ((m = re.exec(xml)) && picks.length < 8) {
      const title = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      const url = m[2].trim();
      if (title && /^https?:\/\//i.test(url)) picks.push({ url, title });
    }
    return picks.length ? picks : null;
  };
  const runSearchLocally = async (tc) => {
    const a = parseArgs(tc);
    const term = String(a.search_term || a.query || a.q || "").trim();
    const fmt = (engine, picks) => `web results for "${term}" (${engine}):\n${picks.map((p, i) => `${i + 1}. ${p.title}\n   ${p.url}`).join("\n")}`;
    try {
      // chain: DDG lite -> Bing RSS (DDG throttles bursts with HTTP 202)
      const ddg = await searchDDG(term).catch(() => null);
      if (ddg) { console.log(`[${id}] BRIDGE search local(ddg): ${JSON.stringify(term).slice(0, 90)} -> ${ddg.length} results`); return fmt("duckduckgo", ddg); }
      const bing = await searchBingRSS(term).catch(() => null);
      if (bing) { console.log(`[${id}] BRIDGE search local(bing): ${JSON.stringify(term).slice(0, 90)} -> ${bing.length} results`); return fmt("bing", bing); }
      return `no results for "${term}" — try WebFetch on a specific URL instead.`;
    } catch (e) {
      return `search failed for "${term}": ${e && e.message || e} — try WebFetch on a specific URL instead.`;
    }
  };
  const runMcpLocally = async (tc) => {
    const a = parseArgs(tc);
    try {
      const res = await localMcp.callTool(a.server, a.toolName, (a.arguments && typeof a.arguments === "object") ? a.arguments : {});
      if (res.ok) {
        console.log(`[${id}] BRIDGE mcp local: ${a.server}.${a.toolName} -> ok, ${(res.text || "").length}B`);
        return (res.text || "(empty result)").slice(0, 12000);
      }
      console.log(`[${id}] BRIDGE mcp local: ${a.server}.${a.toolName} -> error: ${String(res.error).slice(0, 120)}`);
      return `tool error: ${res.error}`;
    } catch (e) {
      return `tool error calling ${a.server}.${a.toolName}: ${e && e.message || e}`;
    }
  };
  const runGetMcpTools = async (tc) => {
    const a = parseArgs(tc);
    const server = typeof a.server === "string" && a.server.trim() ? a.server.trim() : null;
    if (!server) {
      const names = Object.entries(localMcp.SERVERS || {}).map(([k, v]) => `${k} (${v.displayName || k})`).join(", ");
      return `available bridge MCP servers: ${names}. Call GetMcpTools again with {server: "<id>"} to list that server's tools, then CallMcpTool with {server, toolName, arguments}.`;
    }
    try {
      const res = await localMcp.listServerTools(server);
      if (!res.ok) return `error listing ${server}: ${res.error}`;
      const tools = res.tools.slice(0, 60).map((t) => `- ${t.name}: ${t.description}`).join("\n");
      console.log(`[${id}] BRIDGE mcp list: ${server} -> ${res.tools.length} tools`);
      return `tools on ${server} (${res.tools.length}):\n${tools || "(none)"}`;
    } catch (e) {
      return `error listing ${server}: ${e && e.message || e}`;
    }
  };
  const AGENTS_DIR = "/tmp/grokbot-hack/box-data/agents";
  const activeAgentIdNow = () => { try { return JSON.parse(fs.readFileSync(`${AGENTS_DIR}/active-agent.json`, "utf8")).activeAgentId; } catch { return null; } };
  const resolveAgentDir = (target) => {
    try {
      const want = String(target || "").trim().toLowerCase();
      if (!want) return null;
      for (const d of fs.readdirSync(AGENTS_DIR)) {
        if (d.toLowerCase() === want) return d;
        try {
          const prof = JSON.parse(fs.readFileSync(`${AGENTS_DIR}/${d}/profile.json`, "utf8"));
          if (String(prof.name || "").toLowerCase() === want) return d;
        } catch {}
      }
    } catch {}
    return null;
  };
  const createRoutine = (tc) => {
    const a = parseArgs(tc);
    const self = activeAgentIdNow();
    const target = a.target_agent ? resolveAgentDir(a.target_agent) : self;
    if (!target) return a.target_agent ? `error: unknown agent '${a.target_agent}'.` : "error: could not resolve current agent.";
    const cron = String(a.cron).trim();
    const nxt = nextCronAfter(cron, Date.now());
    if (nxt == null) return `error: invalid cron '${cron}' — use 5 fields, e.g. '* * * * *'.`;
    const dir = `${AGENTS_DIR}/${target}/automations/${crypto.randomUUID()}`;
    fs.mkdirSync(dir, { recursive: true });
    const cfg = { name: String(a.name).slice(0, 80), prompt: String(a.prompt).slice(0, 2000), schedule: cron, enabled: true, provenance: "user", createdAt: Date.now() };
    fs.writeFileSync(`${dir}/automation.json`, JSON.stringify(cfg, null, 2));
    console.log(`[${id}] BRIDGE routine created: '${cfg.name}' cron=${cron} agent=${target.slice(0, 8)} next=${new Date(nxt).toISOString()}`);
    return `routine created: '${cfg.name}' on ${target === self ? "yourself" : a.target_agent} — cron '${cron}' (America/Chicago), next fire ${new Date(nxt).toLocaleString("en-US", { timeZone: "America/Chicago" })}. File: ${dir}/automation.json`;
  };
  let lastTodoWrite = null; // latest TodoWrite args, re-emitted to host at the end so the UI shows todos
  const runTodoWrite = (tc) => {
    const a = parseArgs(tc);
    lastTodoWrite = tc;
    const n = Array.isArray(a.todos) ? a.todos.length : 0;
    return `todos updated (${n} items${a.merge ? ", merged" : ""}). Continue with the task.`;
  };
  const runToolLocal = async (tc) => {
    const name = tc.function?.name;
    if (SHELL_TOOLS.has(name)) return await runShellLocally(tc);
    if (READ_TOOLS.has(name)) return await runReadLocally(tc);
    if (name === "WebFetch") return await runFetchLocally(tc);
    if (name === "WebSearch") return await runSearchLocally(tc);
    if (name === "CreateRoutine") return createRoutine(tc);
    if (name === "CallMcpTool") return await runMcpLocally(tc);
    if (name === "GetMcpTools") return await runGetMcpTools(tc);
    if (name === "TodoWrite") return runTodoWrite(tc);
    if (name === "AwaitExternalShell") return "no background shells pending — the bridge runs commands synchronously; their output was already returned.";
    if (name === "SendToAgent") return await runSendToAgentLocal(tc);
    return "[bridge] unsupported local tool";
  };
  const hostGateway = async (method, body) => {
    const r = await fetch(`http://127.0.0.1:1337/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fake-gateway-token" },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!r.ok) throw new Error(`${method} ${r.status}: ${text.slice(0, 300)}`);
    return json;
  };
  const resolveTeammate = bridgeLib.resolveTeammate;
  const runSendToAgentLocal = async (tc) => {
    const a = parseArgs(tc);
    const targetRaw = a.target_id || a.agent_id || a.target || a.name;
    const msg = String(a.message || a.content || a.text || "").trim();
    if (!msg) return "Message was empty; nothing was sent.";
    let agents = [];
    try { agents = await hostGateway("listAgents", {}); }
    catch (e) { return `Could not list teammates: ${e.message}`; }
    const dest = resolveTeammate(agents, targetRaw);
    if (!dest) {
      const roster = (Array.isArray(agents) ? agents : []).map((x) => `${x.name} (id: ${x.id})`).join("; ");
      return `No agent found for ${JSON.stringify(targetRaw)}. Teammates: ${roster || "(none)"}`;
    }
    const running = (Array.isArray(agents) ? agents : []).find((x) => x.isRunning || x.isComposingMessage);
    const selectedId = (() => {
      try { return JSON.parse(require("fs").readFileSync("/tmp/grokbot-hack/box-data/agents/active-agent.json", "utf8")).activeAgentId; }
      catch { return null; }
    })();
    const from = running || (Array.isArray(agents) ? agents : []).find((x) => x.id === selectedId);
    const fromName = from?.name || "a teammate Bot";
    if (from && dest.id === from.id) return "You can't message yourself with SendToAgent. Use SendMessage to talk to the user.";
    const prompt = `[Bot-to-bot from ${fromName}]: ${msg}`;
    try {
      await hostGateway("sendPrompt", { agentId: dest.id, prompt, awaitTurn: false });
      console.log(`[${id}] BRIDGE SendToAgent local: ${fromName} -> ${dest.name} (${dest.id.slice(0, 8)}) ${msg.length}B`);
      return `Sent to ${dest.name}. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.`;
    } catch (e) {
      return `Failed to send to ${dest.name}: ${e.message}`;
    }
  };
  const parseHandoffs = bridgeLib.parseHandoffs;
  const fulfillParsedHandoffs = async (alreadySent) => {
    const lastUser = [...payload].reverse().find((m) => m.role === "user");
    const plans = parseHandoffs(lastUser?.content || "");
    if (!plans.length) return { sent: [], notes: [] };
    const already = new Set((alreadySent || []).map((s) => String(s).toLowerCase()));
    const notes = [];
    const sent = [];
    for (const plan of plans) {
      const key = plan.target.toLowerCase();
      if ([...already].some((s) => s.includes(key))) continue;
      const result = await runSendToAgentLocal({
        function: { name: "SendToAgent", arguments: JSON.stringify({ target_id: plan.target, message: plan.message }) },
      });
      notes.push(`${plan.target}: ${result}`);
      if (/^Sent to /i.test(result)) sent.push(plan.target);
    }
    return { sent, notes };
  };
  const withForcedHandoffs = async (tcs) => {
    const already = [];
    for (const tc of tcs || []) {
      if (tc.function?.name !== "SendToAgent") continue;
      try {
        const a = JSON.parse(tc.function.arguments || "{}");
        already.push(a.target_id || a.agent_id || a.target || a.name || "");
      } catch {}
    }
    const { sent, notes } = await fulfillParsedHandoffs(already);
    if (!notes.length) return tcs;
    console.log(`[${id}] BRIDGE forced-handoffs: ${notes.join(" | ")}`);
    const extra = sent.length
      ? ` Sent to ${sent.join(", ")}.`
      : ` Handoff attempt: ${notes.join(" ")}`;
    const sends = (tcs || []).filter((tc) => tc.function?.name === "SendMessage");
    if (sends.length) {
      try {
        const a = JSON.parse(sends[0].function.arguments || "{}");
        a.content = `${a.content || ""}${extra}`.trim();
        sends[0].function.arguments = JSON.stringify(a);
      } catch {}
      return tcs;
    }
    return [...(tcs || []), synthSend(extra.trim())];
  };
  const allowedHackPath = bridgeLib.allowedHackPath;
  const parseFileOps = bridgeLib.parseFileOps;
  const safeRunCmd = bridgeLib.safeRunCmd;
  const fulfillFileOps = async () => {
    const lastUser = [...payload].reverse().find((m) => m.role === "user");
    const ops = parseFileOps(lastUser?.content || "");
    if (!ops.writes.length && !ops.runs.length) return { notes: [] };
    const notes = [];
    const fsOk = require("fs");
    const pathOk = require("path");
    for (const w of ops.writes) {
      try {
        fsOk.mkdirSync(pathOk.dirname(w.path), { recursive: true });
        const body = w.content.endsWith("\n") ? w.content : `${w.content}\n`;
        fsOk.writeFileSync(w.path, body);
        notes.push(`wrote ${w.path} (${body.length}B)`);
      } catch (e) {
        notes.push(`write failed ${w.path}: ${e.message}`);
      }
    }
    let lastOut = "";
    for (const cmd of ops.runs) {
      if (!safeRunCmd(cmd)) {
        notes.push(`skipped unsafe run: ${cmd.slice(0, 80)}`);
        continue;
      }
      try {
        const out = await runShellLocally({ function: { name: "Shell", arguments: JSON.stringify({ command: cmd }) } });
        lastOut = out;
        notes.push(`ran: ${cmd.slice(0, 100)}`);
      } catch (e) {
        notes.push(`run failed: ${e.message}`);
      }
    }
    if (ops.stdoutPath && lastOut) {
      try {
        const m = String(lastOut).match(/stdout:\n([\s\S]*?)(?:\nstderr:|$)/);
        const stdout = m ? m[1] : lastOut;
        fsOk.mkdirSync(pathOk.dirname(ops.stdoutPath), { recursive: true });
        fsOk.writeFileSync(ops.stdoutPath, stdout.endsWith("\n") ? stdout : `${stdout}\n`);
        notes.push(`stdout -> ${ops.stdoutPath}`);
      } catch (e) {
        notes.push(`stdout write failed: ${e.message}`);
      }
    }
    return { notes };
  };
  const withForcedFileOps = async (tcs) => {
    const { notes } = await fulfillFileOps();
    if (!notes.length) return tcs;
    console.log(`[${id}] BRIDGE forced-fileops: ${notes.join(" | ")}`);
    const extra = ` ${notes.join("; ")}.`;
    const sends = (tcs || []).filter((tc) => tc.function?.name === "SendMessage");
    if (sends.length) {
      try {
        const a = JSON.parse(sends[0].function.arguments || "{}");
        a.content = `${a.content || ""}${extra}`.trim();
        sends[0].function.arguments = JSON.stringify(a);
      } catch {}
      return tcs;
    }
    return [...(tcs || []), synthSend(extra.trim())];
  };
  const withForcedExtras = async (tcs) => withForcedFileOps(await withForcedHandoffs(tcs));
  const runShellLocally = async (tc) => {
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
    const cmd = typeof args.command === "string" ? args.command : "";
    if (!cmd.trim()) return "exit_code: 2\nstderr:\n[bridge] refused: empty or non-string command";
    const requested = typeof args.working_directory === "string" ? args.working_directory : "";
    const fsOk = require("fs");
    let cwd = "/tmp/grokbot-hack/box-data/workspace";
    try {
      if (requested && fsOk.existsSync(requested) && fsOk.statSync(requested).isDirectory()) cwd = requested;
      fsOk.mkdirSync(cwd, { recursive: true });
    } catch {}
    const t0 = Date.now();
    let stdout = "", stderr = "", code = null;
    try {
      const { execFile } = require("child_process");
      const shellBin = fsOk.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
      const shellArgs = shellBin.endsWith("zsh") ? ["-lc", cmd] : ["-c", cmd];
      // Minimal env: no proxy/session secrets leak into agent shells.
      const env = {
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        HOME: cwd, TMPDIR: "/tmp", LANG: "en_US.UTF-8", TERM: "dumb",
      };
      const res = await new Promise((resolve) => {
        const child = execFile(shellBin, shellArgs, { cwd, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env }, (err, so, se) => resolve({ err, so, se }));
        child.on("error", (e) => resolve({ err: e, so: "", se: String(e && e.message || e) }));
      });
      stdout = res.so || ""; stderr = res.se || "";
      code = res.err && typeof res.err.code === "number" ? res.err.code : res.err ? 1 : 0;
      if (res.err && res.err.killed) stderr += "\n[bridge] command timed out after 60s";
    } catch (e) {
      code = 1; stderr = String(e && e.message || e);
    }
    const out = `exit_code: ${code}\nstdout:\n${stdout.slice(0, 12000)}${stderr ? `\nstderr:\n${stderr.slice(0, 4000)}` : ""}`;
    console.log(`[${id}] BRIDGE shell local (${Date.now() - t0}ms): ${JSON.stringify(cmd).slice(0, 140)} cwd=${cwd} -> exit ${code}, ${stdout.length + stderr.length}B${stderr ? ` err=${stderr.slice(0, 120).replace(/\n/g, " ")}` : ""}`);
    return out;
  };
  const synthSend = (content) => ({ id: "tc-synth-" + Math.random().toString(36).slice(2, 8), function: { name: "SendMessage", arguments: JSON.stringify({ type: "text", content }) } });
  const withTodoPassthrough = (finalCalls) => {
    // Re-emit the latest TodoWrite to the host so its UI shows the todo list;
    // the content was already applied locally for the model.
    if (lastTodoWrite && !finalCalls.some((tc) => tc.function?.name === "TodoWrite")) return [lastTodoWrite, ...finalCalls];
    return finalCalls;
  };
  const ensureDelivered = (finalCalls, executed) => {
    // A turn that ends without SendMessage = the user sees silence and the
    // host fires ack-redrive forever. Always synthesize a delivery.
    if (finalCalls.some((tc) => tc.function?.name === "SendMessage")) return finalCalls;
    const names = finalCalls.map((tc) => tc.function?.name).filter(Boolean);
    if (executed && executed.length) {
      return [...finalCalls, synthSend(`Working on it — done so far:\n${executed.slice(-2).join("\n").slice(0, 1500)}${names.length ? `\n(dispatched: ${names.join(", ")})` : ""}`)];
    }
    return [...finalCalls, synthSend(names.length ? `I've dispatched: ${names.join(", ")}. I'll follow up with results.` : "Done.")];
  };
  // Deterministic escape hatch for promise-leak: strip tools so the model
  // physically cannot promise again — it must produce the final text.
  const forcedFinalReport = async (convo, executed) => {
    const facts = executed && executed.length
      ? `GROUND TRUTH — tool calls actually executed this turn:\n${executed.slice(-8).map((e) => `- ${e.slice(0, 200)}`).join("\n")}`
      : "GROUND TRUTH — tool calls actually executed this turn: NONE. No files were written, no commands run, no routines created, nothing was configured.";
    try {
      const r = await callCliproxy([...convo, { role: "user", content: `${facts}\nAnything not in the ground-truth list above was NOT done — never claim it was. Deliver your final answer to the user now, in one message. If work is complete per the facts, report the concrete results (exact outputs, paths, findings). If work remains undone per the facts, say plainly what you finished and what is still pending — no promises, no future tense, no false confirmations.` }], null, "none");
      if (r.full && r.full.trim()) {
        // If even the forced final is a refusal, don't leak it — fall back to executed output.
        if (REFUSAL_RE.test(r.full)) {
          console.log(`[${id}] BRIDGE forced-final was a refusal — falling back to executed output`);
          return null;
        }
        console.log(`[${id}] BRIDGE forced-final: ${r.full.slice(0, 80).replace(/\n/g, " ")}`);
        return [synthSend(r.full)];
      }
    } catch (e) { console.log(`[${id}] BRIDGE forced-final failed: ${e.message}`); }
    return null;
  };
  // Semantic promise detector — replaces phrasing regexes. Asks the model a
  // strict YES/NO with ground-truth facts, so ANY "I'm setting it up / done
  // (it wasn't) / on it" style leak is caught regardless of wording.
  const prematureClaim = async (sends, executedFacts) => {
    const msg = sends.map((tc) => { try { return JSON.parse(tc.function?.arguments || "{}").content || ""; } catch { return ""; } }).join("\n").trim();
    if (!msg) return false;
    const facts = executedFacts && executedFacts.length
      ? `Tool calls actually executed this turn: ${executedFacts.length} — ${executedFacts.slice(-6).map((e) => e.slice(0, 120)).join(" | ")}`
      : "Tool calls actually executed this turn: NONE.";
    try {
      const r = await callCliproxy([
        { role: "system", content: "You are a strict classifier in an agent runtime. Answer with exactly YES or NO." },
        { role: "user", content: `${facts}\nThe assistant's outgoing message to the user:\n"""${msg.slice(0, 1500)}"""\nQuestion: Given the facts, does this message claim, promise, or imply ANY work was (or will be) performed by the agent that is NOT reflected in the executed-tools facts — i.e., does the agent still owe work before this message is a complete, final answer? YES if work is still owed or falsely claimed done; NO if the message fully and truthfully answers the user with nothing pending.` },
      ], null, "none");
      const ans = (r.full || "").trim().toUpperCase();
      const yes = ans.startsWith("Y") || /\bYES\b/.test(ans);
      console.log(`[${id}] BRIDGE premature-claim: ${ans.slice(0, 12)} (msg ${msg.length}B) -> ${yes}`);
      return yes;
    } catch (e) { console.log(`[${id}] BRIDGE premature-claim check failed: ${e.message}`); return false; }
  };
  const deliverFinal = async (sends, convo, executed) => {
    // A promise-style or refusal send is worthless — replace it with an
    // honest, fact-grounded final report.
    if (sends.length && (await prematureClaim(sends, executed) || refusalish(sends))) {
      const forced = await forcedFinalReport(convo, executed);
      if (forced) return forced;
    }
    return sends;
  };
  const bridgeAgentLoop = async (initialCalls) => {
    let convo = [...payload];
    let pending = initialCalls;
    const executed = [];      // every tool output, for fallback reporting
    const seenCommands = new Set(); // repeat-call guard (name+args keyed)
    const bufferedHost = [];  // host calls deferred to end-of-turn dispatch
    const hostSeen = new Set();
    const MAX_ROUNDS = 12;
    const t0 = Date.now();
    let inLoopNudged = false;
    let emptyRounds = 0;
    // Every exit path funnels through finalize(): deferred host calls first,
    // then TodoWrite passthrough, then a guaranteed SendMessage last.
    const finalize = (calls) => withTodoPassthrough(ensureDelivered([...bufferedHost, ...calls], executed));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resultMsgs = [];
      let toolMsg = null;
      let repeatDetected = false;
      if (pending.length) {
        toolMsg = { role: "assistant", content: null, tool_calls: pending.map((tc) => ({ id: tc.id || `tc-br-${round}-${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments || "{}" } })) };
        for (let i = 0; i < pending.length; i++) {
          const tc = pending[i];
          const key = `${tc.function?.name}:${(tc.function?.arguments || "").slice(0, 500)}`;
          if (seenCommands.has(key)) { repeatDetected = true; continue; }
          seenCommands.add(key);
          const out = await runToolLocal(tc);
          executed.push(`$ ${out}`);
          resultMsgs.push({ role: "tool", tool_call_id: toolMsg.tool_calls[i].id, content: out });
        }
        convo = [...convo, toolMsg, ...resultMsgs];
      }
      if (repeatDetected && !resultMsgs.length) {
        console.log(`[${id}] BRIDGE loop: repeat call detected at round ${round + 1} — forcing final report`);
        const summary = await callCliproxy([...convo, { role: "user", content: "You are repeating the same tool call. Summarize what you have so far in one message for the user. Do not call any tools." }], null, "none").catch(() => null);
        if (summary?.full && summary.full.trim()) return finalize([synthSend(summary.full)]);
        return finalize([synthSend(`I made progress but started repeating myself, so I stopped. Output so far:\n${executed.slice(-3).join("\n").slice(0, 2000)}`)]);
      }
      let next = await callCliproxy(convo, tools, "auto");
      let nx = splitTools(next.tcs);
      // Promise-after-work: any send-only round after real work is suspect
      // here — the turn ENDS at the send, so "I'll do the rest now" means
      // the rest never happens. Nudge once; if it still sends-only, accept.
      if (!nx.work.length && nx.sends.length && executed.length && !inLoopNudged) {
        inLoopNudged = true;
        const promised = nx.sends.map((tc) => { try { return JSON.parse(tc.function.arguments || "{}").content || ""; } catch { return ""; } }).join("\n");
        console.log(`[${id}] BRIDGE loop: promise-after-work — nudging to finish before delivery`);
        convo = [...convo,
          { role: "assistant", content: promised.slice(0, 4000) },
          { role: "user", content: `Finish now. Do NOT reply to this instruction — immediately invoke a tool (Shell/Read/WebSearch/WebFetch run synchronously and return real output; MCP works via GetMcpTools/CallMcpTool; write files via Shell heredocs). You may only SendMessage after all work is complete.` }];
        next = await callCliproxy(convo, tools, "auto");
        nx = splitTools(next.tcs);
      }
      const locals = nx.work.filter(isLocalCall);
      const hostWork = nx.work.filter((tc) => !isLocalCall(tc));
      console.log(`[${id}] BRIDGE loop round ${round + 1} (${Date.now() - t0}ms): ${locals.length} local, ${hostWork.length} host-work, ${nx.sends.length} sends, text=${(next.full || "").slice(0, 60).replace(/\n/g, " ")}`);
      // Host calls can't return results mid-turn in this build — defer them
      // to end-of-turn dispatch, tell the model they're queued, and let it
      // continue the rest of its plan (writes, reports, verification).
      if (hostWork.length) {
        const hostToolMsg = { role: "assistant", content: null, tool_calls: [] };
        const hostResults = [];
        for (const tc of hostWork) {
          const key = `${tc.function?.name}:${(tc.function?.arguments || "").slice(0, 500)}`;
          if (!hostSeen.has(key)) {
            hostSeen.add(key);
            bufferedHost.push(tc);
            console.log(`[${id}] BRIDGE loop: deferring host call ${tc.function?.name} to end of turn`);
          }
          const tcid = `tc-host-${round}-${hostToolMsg.tool_calls.length}`;
          hostToolMsg.tool_calls.push({ id: tcid, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments || "{}" } });
          hostResults.push({ role: "tool", tool_call_id: tcid, content: "queued: this action dispatches to the host when your turn completes. Assume it will succeed and continue the rest of your plan now; verify on-disk effects with Read/Shell if you need to." });
        }
        convo = [...convo, hostToolMsg, ...hostResults];
      }
      if (nx.sends.length && !locals.length) return finalize(await deliverFinal(nx.sends, convo, executed));
      if (locals.length) {
        if (Date.now() - t0 > 180_000) {
          console.log(`[${id}] BRIDGE loop: wall-clock limit — forcing final report`);
          return finalize([]);
        }
        emptyRounds = 0;
        pending = locals;
        continue;
      }
      // no locals this round: sends were handled above; maybe host-only or quiet
      if (next.full && next.full.trim()) return finalize([synthSend(next.full)]);
      if (++emptyRounds >= 2 || Date.now() - t0 > 180_000) {
        return finalize([synthSend(executed.length ? `Done. Last tool output:\n${executed[executed.length - 1].slice(0, 2000)}` : "Done.")]);
      }
      pending = []; // give the model one more chance after host dispatches
    }
    return finalize([synthSend(`I hit my step limit after ${executed.length} tool steps — ask me to continue and I'll pick up where I left off. Output so far:\n${executed.slice(-2).join("\n").slice(0, 1500)}`)]);
  };
  const splitTools = (tcs) => {
    const sends = [], work = [];
    for (const tc of tcs) (tc.function?.name === "SendMessage" ? sends : work).push(tc);
    return { sends, work };
  };
  const ACK_RE = /\b(?:i|we)\s*['’‘]?\s*(?:ll|will)\b|\blet me\b|\bgoing to\b|\bgonna\b|\bright away\b|\bfirst[,. :]|\bnow[,. ]|\bone (?:moment|sec|second)\b|\bstand by\b/i;
  // Refusals: "I wasn't able…", "tools aren't available", "I don't have access"
  // — the model denying it has tools. Single regex, curly-apostrophe aware
  // (U+2019) — the prior version used ASCII-only '? and a dead || second Re).
  const REFUSAL_RE = /\b(?:wasn[’'‘]?t|weren[’'‘]?t|couldn[’'‘]?t|can[’'‘]?t|cannot|unable to|not able to|don[’'‘]?t have|doesn[’'‘]?t have)\b[^.]{0,120}\b(?:tool|access|mcp|connect(?:ed|or)?s?|availab|permission)|\b(?:tools?|connectors?|mcp|access)\b[^.]{0,80}\b(?:aren[’'‘]?t|isn[’'‘]?t)\b\s*(?:available|here|working|accessible)/i;
  const refusalish = (sends) => sends.some((tc) => {
    try { const c = JSON.parse(tc.function?.arguments || "{}").content || ""; return typeof c === "string" && REFUSAL_RE.test(c); }
    catch { return false; }
  });
  const ackish = (sends) => sends.some((tc) => {
    try {
      const c = JSON.parse(tc.function?.arguments || "{}").content || "";
      // Only short promise-style replies count as acks (ASCII AND curly
      // apostrophes — the model emits U+2019); long substantive answers
      // are treated as final and delivered untouched.
      return typeof c === "string" && c.length <= 400 && ACK_RE.test(c);
    }
    catch { return false; }
  });
  const hasWorkTools = tools.some((t) => !["SendMessage", "ReactToMessage"].includes(t.function?.name));
  const emitToolCalls = (tcsToEmit, fullText) => {
    for (const tc of tcsToEmit) {
      tc.function.arguments = sanitizeArgs(tc.function.arguments || "{}");
      emitToolCallPart(tc.id || "tc-" + Math.random().toString(36).slice(2, 8), tc.function.name, tc.function.arguments, true);
    }
    // Record this turn's delivered reply so future requests replay it after
    // its user message (answered-history reconstruction above).
    try {
      const lu = [...payload].reverse().find((m) => m.role === "user");
      const ans = tcsToEmit.filter((t) => t.function?.name === "SendMessage")
        .map((t) => { try { return JSON.parse(t.function.arguments || "{}").content || ""; } catch { return ""; } })
        .join("\n").trim();
      if (lu && ans) {
        ANSWERED.set(lu.content.slice(0, 120), ans.slice(0, 4000));
        if (ANSWERED.size > 80) ANSWERED.delete(ANSWERED.keys().next().value);
      }
    } catch {}
    emitResponseInfo(fullText, tcsToEmit);
  };
  const routeWork = async (workCalls, fallback) => {
    const locals = workCalls.filter(isLocalCall);
    const hostCalls = workCalls.filter((tc) => !isLocalCall(tc));
    let out;
    if (locals.length && hostCalls.length) {
      // execute what we can locally, keep host tools for delivery alongside
      out = [...hostCalls, ...await bridgeAgentLoop(locals)];
    } else if (locals.length) out = await bridgeAgentLoop(locals);
    else {
      // host-only dispatch (update_state, SendToAgent, CreateAgent...): the
      // actions go out with the final response — generate a REAL summary of
      // what was done instead of a placeholder promise.
      const names = hostCalls.map((tc) => tc.function?.name).filter(Boolean);
      let real = null;
      try {
        const r = await callCliproxy([...payload, { role: "user", content: `You dispatched these actions: ${names.join(", ")}. They execute when this turn ends. Write the single message the user should receive now — describe concretely what you just did and what they'll see next. No future-tense promises.` }], null, "none");
        if (r.full && r.full.trim()) real = [synthSend(r.full)];
      } catch {}
      // Always keep host tool calls. A successful summary used to replace
      // them, so SendToAgent / CreateAgent never reached the host.
      out = ensureDelivered([...hostCalls, ...(real || [])], null);
    }
    out = ensureDelivered(out, null);
    return out.length ? out : (fallback || [synthSend("Done.")]);
  };
  // The box's own settings say mcpBoxServers:[] — the model can't know the
  // bridge executes MCP locally, so it refuses to even try. Tell it.
  const MCP_HINT = `Bridge note: GetMcpTools and CallMcpTool are fully functional here and executed locally by the bridge. Live servers: ${Object.entries(localMcp.SERVERS || {}).map(([k, v]) => `"${k}" (${v.displayName})`).join(", ")}. Use GetMcpTools {server:"<id>"} to list tools, then CallMcpTool {server, toolName, arguments}.`;
  const nudgedContinuation = async (round1) => {
    // round1 = { full, tcs } from the first completion
    const { sends, work } = splitTools(round1.tcs);
    if (!hasWorkTools) return round1.tcs;
    if (work.length) return await routeWork(work, round1.tcs);
    const plainAck = !sends.length && round1.full && round1.full.trim().length > 0;
    if (!sends.length && !plainAck) return round1.tcs;
    // Refusals ("tools aren't available") get the same treatment as acks —
    // nudge with the tool-availability hint and make the model actually try.
    const isRefusal = sends.length > 0 && refusalish(sends);
    const prem = isRefusal || (sends.length ? await prematureClaim(sends, []) : (plainAck ? await prematureClaim([{ function: { arguments: JSON.stringify({ content: round1.full }) } }], []) : false));
    if (!prem) return round1.tcs; // truthful direct answer — deliver it
    const asstContent = sends.length
      ? sends.map((tc) => { try { return JSON.parse(tc.function.arguments || "{}").content || ""; } catch { return ""; } }).join("\n")
      : round1.full;
    const refusalPreamble = isRefusal ? `Correction: the tools ARE available and functional in this environment. ${MCP_HINT}\n` : "";
    const nudgeMsgs = [
      ...payload,
      { role: "assistant", content: asstContent.slice(0, 4000) },
      { role: "user", content: `${refusalPreamble}${MCP_HINT}\n${isRefusal ? "Do not claim tools are unavailable — you have not tried them yet. " : ""}Your reply was not sent to the user. Now actually perform the task using the available tools (Shell/Read/WebSearch/WebFetch run synchronously; MCP via GetMcpTools/CallMcpTool). Do NOT call SendMessage again until the requested work is complete and you have concrete results to report.` },
    ];
    try {
      const round2 = await callCliproxy(nudgeMsgs, tools, "auto");
      const r2 = splitTools(round2.tcs);
      console.log(`[${id}] BRIDGE nudge round2: ${r2.work.length} work, ${r2.sends.length} sends, text=${(round2.full || "").slice(0, 80).replace(/\n/g, " ")}`);
      if (r2.work.length) {
        console.log(`[${id}] BRIDGE continuation: dropped ${sends.length || 1} ack SendMessage, routing ${r2.work.length} work tool calls (${r2.work.map((t) => t.function.name).join(",")})`);
        return await routeWork(r2.work, round2.tcs.length ? round2.tcs : round1.tcs);
      }
      if (r2.sends.length) {
        // model insists on messaging again — if it still owes work, try once more
        if (await prematureClaim(r2.sends, [])) {
          const nudge2 = [...nudgeMsgs, { role: "assistant", content: (() => { try { return JSON.parse(r2.sends[0].function.arguments || "{}").content || ""; } catch { return ""; } })() }, { role: "user", content: `${MCP_HINT}\nStop acknowledging. Execute the work now with tool calls only. Invoke the Shell tool with {"command": ...} or CallMcpTool with {server, toolName, arguments} immediately.` }];
          const round3 = await callCliproxy(nudge2, tools, "auto");
          const r3 = splitTools(round3.tcs);
          console.log(`[${id}] BRIDGE nudge round3: ${r3.work.length} work, ${r3.sends.length} sends`);
          if (r3.work.length) {
            console.log(`[${id}] BRIDGE continuation (round 3): routing ${r3.work.length} work tool calls (${r3.work.map((t) => t.function?.name).join(",")})`);
            return await routeWork(r3.work, round1.tcs);
          }
          // still promising instead of working — force a real final report
          const forced = await forcedFinalReport(nudge2, []);
          if (forced) return forced;
          // forced-final refused/rate-limited too — synthesize something honest
          return [synthSend(`I'm still limited producing the final report. Ask me to retry and I'll try a different approach — tools ARE available here, and I have the MCP hint.` )];
        }
        // non-ackish send-only after nudge — deliver it, unless it's a refusal
        if (refusalish(r2.sends)) {
          const forced = await forcedFinalReport(nudgeMsgs, []);
          if (forced) return forced;
          return [synthSend(`I'm still limited here: ${r2.sends.map((tc) => { try { return JSON.parse(tc.function?.arguments || "{}").content || ""; } catch { return ""; } }).join(" ").slice(0, 400)}`)];
        }
        return round2.tcs; // deliver its message — avoid silence
      }
      if (round2.full && round2.full.trim()) {
        return [{ id: "tc-synth-" + Math.random().toString(36).slice(2, 8), function: { name: "SendMessage", arguments: JSON.stringify({ type: "text", content: round2.full }) } }];
      }
    } catch (e) {
      console.log(`[${id}] BRIDGE continuation nudge failed: ${e.message}`);
    }
    return round1.tcs;
  };
  res.writeHead(200, { "content-type": "application/connect+proto", "connect-protocol-version": "1" });
  const responseChunks = [];
  const writeResponse = (chunk) => { responseChunks.push(chunk); res.write(chunk); };
  const emitText = (text, isFinal) => {
    const part = Buffer.concat([ pbStr(1, text), ...(isFinal ? [Buffer.from([0x10, 0x01])] : []) ]);
    writeResponse(connectFrame(pbStr(1, part))); // n3 field1 = text_part
  };
  const emitToolCallPart = (toolCallId, toolName, argsStr, isComplete) => {
    // rQ: {1:id, 2:name, 3:args, 4:is_complete, 5:tool_index(opt)} -> n3 field2
    const part = Buffer.concat([ pbStr(1, toolCallId), pbStr(2, toolName), pbStr(3, argsStr), Buffer.from([0x20, isComplete ? 0x01 : 0x00]) ]);
    writeResponse(connectFrame(pbStr(2, part)));
  };
  const sanitizeArgs = (raw) => {
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return raw;
      if (o.type === "text") {
        const keep = {};
        if (o.type) keep.type = o.type;
        if (o.content != null) keep.content = o.content;
        if (Array.isArray(o.images)) keep.images = o.images;
        if (o.alt) keep.alt = o.alt;
        if (o.reply_to) keep.reply_to = o.reply_to;
        if (o.channel) keep.channel = o.channel;
        return JSON.stringify(keep);
      }
      if (o.agent_id && !o.target_id) o.target_id = o.agent_id;
      if (o.content && !o.message) o.message = o.content;
      return JSON.stringify(o);
    } catch { return raw; }
  };
  const emitResponseInfo = (fullText, toolCalls) => {
    const tcParts = [];
    for (const tc of (toolCalls || [])) {
      const raw = tc.function?.arguments || "{}";
      const clean = sanitizeArgs(raw);
      tc.function.arguments = clean;
      const ec = Buffer.concat([ pbStr(1, tc.id || "tc-"+Math.random().toString(36).slice(2,8)), pbStr(2, tc.function?.name || tc.name || "unknown"), pbStr(4, clean) ]);
      tcParts.push(pbStr(4, ec));
    }
    const msg = Buffer.concat([ pbVarint(2, 2), ...(fullText ? [pbStr(3, fullText)] : []), ...tcParts ]);
    const info = Buffer.concat([ pbStr(1, "chatcmpl-local"), pbStr(2, BRIDGE_MODEL), pbVarint(3, Math.floor(Date.now() / 1000)), pbStr(4, msg) ]);
    writeResponse(connectFrame(pbStr(4, info))); // n3 field4 = response_info
  };
  const emitEnd = () => { const j = Buffer.from('{"metadata":{}}'); const h = Buffer.alloc(5); h[0] = 0x02; h.writeUInt32BE(j.length, 1); writeResponse(Buffer.concat([h, j])); };
  try {
    const body = { model: BRIDGE_MODEL, messages: payload, stream: true };
    if (tools.length) {
      body.tools = tools;
      // Only force SendToAgent when the *current* user turn explicitly
      // asks for it. Checking the whole history caused an infinite
      // ping-pong: once "handoff-ok" entered history every future turn
      // kept forcing SendToAgent. Check last user message only.
      const lastUser = [...payload].reverse().find(m => m.role === "user");
      const lastText = lastUser?.content || "";
      const wantsHandoff = lastUser && !/Do NOT|do not send|Stop the handoff|Stop all handoffs/i.test(lastText) && (
        /SendToAgent/i.test(lastText) ||
        /\b(?:tell|ask|message|ping|handoff|hand off|talk to)\b.{0,40}\b(?:lol|sally|grok(?:\s*bot)?\s*[abcd]?)\b/i.test(lastText) ||
        /\b(?:lol|sally|grok(?:\s*bot)?\s*[abcd]?)\b.{0,20}\b(?:to |that |should |must |needs? to)\b/i.test(lastText)
      );
      const wantsExec = lastUser && /write a file at\s+\S+/i.test(lastText);
      const hasSendToAgent = tools.some(t => t.function?.name === "SendToAgent");
      const hasShell = tools.some(t => t.function?.name === "Shell");
      if (wantsHandoff && hasSendToAgent) {
        body.tool_choice = { type: "function", function: { name: "SendToAgent" } };
      } else if (wantsExec && hasShell) {
        body.tool_choice = { type: "function", function: { name: "Shell" } };
      } else {
        body.tool_choice = "auto";
      }
    }
    const up = await fetch(CLIPROXY, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", authorization: `Bearer ${CLIPROXY_KEY}` }, payingHeaders(getModelConfig())),
      body: JSON.stringify(body),
    });
    if (!up.ok || !up.body) throw new Error(`cliproxy ${up.status}`);
    const reader = up.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    // accumulate streaming tool_calls by index
    const tcsByIndex = new Map();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) { full += delta.content; emitText(delta.content, false); }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const cur = tcsByIndex.get(idx) || { id: "", function: { name: "", arguments: "" } };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name = tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              tcsByIndex.set(idx, cur);
            }
          }
        } catch {}
      }
    }
    if (tcsByIndex.size) {
      const tcs = [...tcsByIndex.values()];
      console.log(`[${id}] BRIDGE tool_calls=${tcs.map(t=>t.function.name+":"+(t.function.arguments||"").slice(0,60)).join(", ")}`);
      // SendMessage-only steps end the host turn (verified empirically), so
      // nudge the model into real work tool calls and emit those instead.
      const finalTcs = await nudgedContinuation({ full, tcs });
      emitToolCalls(await withForcedExtras(finalTcs), full);
    } else {
      // model replied with plain text, no tool call — synthesize SendMessage so the box sees delivery (box's SendMessage is the only voice)
      if (tools.length && tools.some(t=>t.function?.name==="SendMessage") && full && full.trim().length) {
        const synthArgs = JSON.stringify({ type: "text", content: full });
        const synth = { id: "tc-synth-"+Math.random().toString(36).slice(2,8), function: { name: "SendMessage", arguments: synthArgs } };
        const finalTcs = await nudgedContinuation({ full, tcs: [synth] });
        emitToolCalls(await withForcedExtras(finalTcs), full);
      } else {
        emitText("", true);
        emitResponseInfo(full, null);
      }
    }
    emitEnd();
  } catch (e) {
    console.log(`[${id}] BRIDGE-infer ERROR: ${e.message}`);
    const msg = `[bridge error] ${e.message}`;
    // Plain assistant text is never delivered by the box — surface bridge
    // crashes through a real SendMessage so the user never sees silence.
    try {
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/connect+proto", "connect-protocol-version": "1" });
      if (tools.some((t) => t.function?.name === "SendMessage")) {
        const synth = synthSend(msg);
        emitToolCalls([synth], msg);
      } else {
        emitText(msg, true);
        emitResponseInfo(msg, null);
      }
      emitEnd();
    } catch (e2) {
      console.log(`[${id}] BRIDGE error-path also failed: ${e2.message}`);
    }
  }
  const responseBytes = Buffer.concat(responseChunks);
  fs.writeFileSync(`/tmp/grokbot-bodies/${String(id).padStart(4, "0")}-INFERRES.bin`, responseBytes);
  let responsePos = 0, responseFrame = 0;
  while (responsePos + 5 <= responseBytes.length) {
    const responseLen = responseBytes.readUInt32BE(responsePos + 1);
    const responseEnd = responsePos + 5 + responseLen;
    if (responseEnd > responseBytes.length) { console.log(`[${id}] BRIDGE response frame overflow at ${responseFrame}`); break; }
    if (responseBytes[responsePos] !== 2 && !tryParse(responseBytes.subarray(responsePos + 5, responseEnd))) console.log(`[${id}] BRIDGE response protobuf parse failed frame ${responseFrame}`);
    responsePos = responseEnd; responseFrame++;
  }
  console.log(`[${id}] BRIDGE response ${responseBytes.length}B/${responseFrame} frames`);
  res.end();
  console.log(`[${id}] BRIDGE-infer done`);
}

async function bridgeToCliproxy(reqBuf, res, id) {
  const { proxyUrl: CLIPROXY, apiKey: CLIPROXY_KEY, model: BRIDGE_MODEL, proxyTarget } = getModelConfig();
  const convo = extractConversation(reqBuf);
  console.log(`[${id}] BRIDGE ${convo.length} msgs, model=${BRIDGE_MODEL}`);
  if (convo.length) {
    const last = convo[convo.length - 1];
    console.log(`[${id}]   last(${last.role}): ${last.text.slice(0, 120).replace(/\n/g, " ")}`);
  }
  // Keep last 40 messages, cap each at 24k chars
  const messages = [
    { role: "system", content: "You are Grok Bot, a capable autonomous agent. Answer directly and helpfully." },
    ...convo.slice(-40).map(m => ({ role: m.role, content: m.text.slice(0, 24000) })),
  ];
  res.writeHead(200, {
    "content-type": "application/connect+proto",
    "connect-protocol-version": "1",
  });
  try {
    const up = await fetch(CLIPROXY, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", authorization: `Bearer ${CLIPROXY_KEY}` }, payingHeaders(getModelConfig())),
      body: JSON.stringify({ model: BRIDGE_MODEL, messages, stream: true }),
    });
    if (!up.ok || !up.body) throw new Error(`cliproxy ${up.status}: ${await up.text().catch(() => "")}`.slice(0, 300));
    const reader = up.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            res.write(connectFrame(pbString(1, delta))); // StreamUnifiedChatResponse.text
          }
        } catch {}
      }
    }
  } catch (e) {
    console.log(`[${id}] BRIDGE ERROR: ${e.message}`);
    res.write(connectFrame(pbString(1, `[bridge error] ${e.message}`)));
  }
  res.end();
  console.log(`[${id}] BRIDGE done`);
}

function pbStr(fieldNo, s) { // length-delimited string field
  const body = Buffer.from(s, "utf8");
  return Buffer.concat([encodeVarint((fieldNo << 3) | 2), encodeVarint(body.length), body]);
}

function syntheticEnsureSandBox() {
  const terminalsFolder = "/tmp/grokbot-hack/box-data/workspace/terminals";
  try { fs.mkdirSync(terminalsFolder, { recursive: true }); } catch {}
  return Buffer.concat([
    pbStr(1, "local"),                       // cluster
    pbStr(2, "alberto-local"),                // tenant_id
    pbStr(3, "pod-fakelocal-0001"),           // pod_id
    pbStr(4, "nto-fake-local-token"),         // network_token
    pbStr(5, "fake-daemon-auth-token"),       // exec_daemon_auth_token
    pbStr(6, "http://127.0.0.1:1340"),        // exec_daemon_url
    pbStr(7, "http://127.0.0.1:6080/vnc.html"), // vnc_url
    pbStr(8, terminalsFolder),                 // terminals_folder
    pbStr(12, "http://127.0.0.1:6081"),        // fork_vnc_base_url
    pbStr(10, "http://127.0.0.1:1337"),        // gateway_url
    pbStr(11, "fake-gateway-token"),           // gateway_token
  ]);
}

const LISTEN_PORT = parseInt(process.argv[2] || "8787", 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "api2.cursor.sh";
const LOG_PATH = process.env.LOG_PATH || "/tmp/grokbot-proxy-calls.jsonl";
const BODY_DUMP_DIR = "/tmp/grokbot-bodies";

fs.mkdirSync(BODY_DUMP_DIR, { recursive: true });
const PERIOD_USAGE_ORIG = fs.existsSync("/tmp/grokbot-bodies/0022-_aiserver.v1.DashboardService_GetCurrentPeriodUsage.res-head.bin")
  ? fs.readFileSync("/tmp/grokbot-bodies/0022-_aiserver.v1.DashboardService_GetCurrentPeriodUsage.res-head.bin") : null;

// Map real box ports -> local fake box ports (identity: fake box listens on same ports)
function rewriteBoxUrl(s) {
  // https://<hash>-pod-<id>-1337.us9.cursorvm.com -> http://127.0.0.1:1337
  const m = s.match(/^https?:\/\/[a-z0-9-]+\.us9\.cursorvm\.com(:\d+)?/);
  if (!m) return null;
  let port = 443;
  const pm = m[0].match(/-(\d+)\.us9\.cursorvm\.com/) || m[0].match(/:(\d+)$/);
  if (pm) port = parseInt(pm[1], 10);
  if (![1337, 1340, 6080, 6081].includes(port)) port = 1340;
  const replaced = s.replace(/^https?:\/\/[a-z0-9-]+\.us9\.cursorvm\.com(:\d+)?/, `http://127.0.0.1:${port}`);
  console.log("  [rewrite]", s.slice(0, 80), "->", replaced.slice(0, 60));
  return replaced;
}

let reqCounter = 0;

const server = http.createServer((req, res) => {
  const id = ++reqCounter;
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const entry = { id, ts: new Date().toISOString(), method: req.method, url: req.url, contentType: req.headers["content-type"], reqBytes: body.length };

    // D-only OAuth callback. Tokens are stored in macOS Keychain by local-mcp.
    if (req.method === "GET" && req.url.startsWith("/callback")) {
      try {
        const result = await localMcp.handleOAuthCallback(new URL(req.url, "http://localhost").searchParams);
        const out = Buffer.from(`<!doctype html><meta charset="utf-8"><title>Grok D connector</title><p>${result.body}</p>`);
        entry.status = result.status; entry.mutated = "LOCAL-MCP-oauth-callback"; entry.resBytes = out.length;
        fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
        res.writeHead(result.status, { "content-type": "text/html; charset=utf-8", "content-length": String(out.length) });
        return res.end(out);
      } catch (error) {
        entry.status = 500; entry.error = error.message || String(error);
        fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
        res.writeHead(500, { "content-type": "text/plain" });
        return res.end("OAuth callback failed");
      }
    }

    // DEV LOGIN: no Cursor account needed. App asks for a local session token; we mint one.
    if (req.url.startsWith("/auth/cursor_dev_session_token")) {
      const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const jwt = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: "alberto-local", email: "alberto@local", exp: Math.floor(Date.now() / 1000) + 86400 * 365 })}.localsig`;
      const out = Buffer.from(JSON.stringify({ accessToken: jwt, refreshToken: jwt }));
      console.log(`[${id}] DEV LOGIN -> local session token minted`);
      entry.status = 200; entry.mutated = "DEV-LOGIN-local";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/json", "content-length": String(out.length) });
      return res.end(out);
    }

    // TOKEN REFRESH: answer /oauth/token locally so the app never revokes itself
    if (req.url.startsWith("/oauth/token")) {
      const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const jwt = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: "alberto-local", email: "alberto@local", exp: Math.floor(Date.now() / 1000) + 86400 * 365 })}.localsig`;
      const out = Buffer.from(JSON.stringify({ access_token: jwt, refresh_token: jwt }));
      console.log(`[${id}] REFRESH -> local token re-minted`);
      entry.status = 200; entry.mutated = "REFRESH-local";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/json", "content-length": String(out.length) });
      return res.end(out);
    }

    // FULL TAKEOVER: answer EnsureSandBox locally with synthetic fake box
    if (req.url.includes("EnsureSandBox")) {
      const out = syntheticEnsureSandBox();
      entry.status = 200; entry.resBytes = out.length; entry.mutated = "SYNTHETIC-fakebox";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      console.log(`[${id}] SYNTHETIC EnsureSandBox -> fake box (${out.length}B)`);
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }

    // QUOTA FAKE for the APP: always healthy
    if (req.url.includes("GetSandTrialClaimStatus")) {
      entry.status = 200; entry.mutated = "SYNTHETIC-trial"; fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto" }); return res.end(Buffer.alloc(0));
    }
    if (req.url.includes("GetCurrentPeriodUsage") && PERIOD_USAGE_ORIG) {
      entry.status = 200; entry.resBytes = PERIOD_USAGE_ORIG.length; entry.mutated = "REPLAY-period-usage"; fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(PERIOD_USAGE_ORIG.length) });
      return res.end(PERIOD_USAGE_ORIG);
    }
    // QUOTA FAKE: usage shows zero / always available
    if (req.url.includes("GetSandUsageStatus")) { /* ALL callers */
      const out = fs.readFileSync("/tmp/grokbot-hack/usage-ok.bin");
      entry.status = 200; entry.resBytes = out.length; entry.mutated = "SYNTHETIC-usage-ok";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }
    // box-originated RPCs that need happy answers while token is dead:

    // INFERENCE BRIDGE: box InferenceService/Stream -> CLIProxy
    if (req.url.includes("InferenceService/Stream") && (req.headers["authorization"] || "").match(/local-fake-token|localsig/)) {
      let reqMsg = body;
      if (body.length > 5 && body[0] === 0) {
        const len = body.readUInt32BE(1);
        if (5 + len <= body.length) reqMsg = body.subarray(5, 5 + len);
      }
      fs.writeFileSync(`/tmp/grokbot-bodies/${String(id).padStart(4, "0")}-INFERREQ.bin`, reqMsg);
      entry.mutated = "BRIDGE-inference";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      return bridgeInference(reqMsg, res, id);
    }

    // INFERENCE BRIDGE: box-originated StreamUnified* -> CLIProxy / OpenBurnBar
    if (req.url.includes("StreamUnified") && (req.headers["authorization"] || "").match(/local-fake-token|localsig/)) {
      // connect streaming: first frame is the request (5-byte prefix)
      let reqMsg = body;
      if (body.length > 5 && body[0] === 0) {
        const len = body.readUInt32BE(1);
        if (5 + len <= body.length) reqMsg = body.subarray(5, 5 + len);
      }
      fs.writeFileSync(`/tmp/grokbot-bodies/${String(id).padStart(4, "0")}-STREAMREQ.bin`, reqMsg);
      entry.mutated = "BRIDGE-cliproxy";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      return bridgeToCliproxy(reqMsg, res, id);
    }
    // D-only MCP catalog/config/auth/tool bridge. This runs before the
    // read-only marketplace forwarder and never touches Seat C or Cursor.
    if ((req.headers["authorization"] || "").match(/local-fake-token|localsig/)) {
      try {
        const out = await localMcp.handleBackendRpc(req.url, body);
        if (out !== null) {
          entry.status = 200; entry.resBytes = out.length; entry.mutated = "LOCAL-MCP-bridge";
          fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
          res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
          return res.end(out);
        }
      } catch (error) {
        entry.status = 502; entry.error = error.message || String(error); entry.mutated = "LOCAL-MCP-error";
        fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
        res.writeHead(502, { "content-type": "application/proto" });
        return res.end(Buffer.alloc(0));
      }
    }

    // AUTH FAKES: keep the app believing our local JWT is a real account
    if (req.url.includes("DashboardService/GetMe")) {
      const out = Buffer.concat([pbStr(1, "local-auth-0001"), pbStr(3, "alberto@local"), pbStr(4, "Alberto"), pbStr(5, "Nunez-Garcia")]);
      console.log(`[${id}] FAKE GetMe -> alberto@local`);
      entry.status = 200; entry.mutated = "FAKE-GetMe"; fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }
    if (req.url.includes("GetUserPrivacyMode")) {
      const out = Buffer.from([0x08, 0x02]); // privacy_mode=2 (USAGE_DATA_TRAINING_ALLOWED)
      entry.status = 200; entry.mutated = "FAKE-privacy"; fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }
    if (req.url.includes("GetSandAccessStatus")) {
      const out = Buffer.from([0x08, 0x01]); // state=GRANTED
      entry.status = 200; entry.mutated = "FAKE-access-GRANTED"; fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }

    // Host asks AiService/AvailableModels before StreamUnified. The catch-all
    // empty-ok used to return 0 bytes, so the box cached "no models" and never
    // called inference. Advertise the configured local model.
    if (req.url.includes("AvailableModels")) {
      const model = String((getModelConfig().model || "grok-4.6"));
      const modelMsg = Buffer.concat([
        pbStr(1, model),
        Buffer.from([0x10, 0x01]), // default_on = true
      ]);
      const out = Buffer.concat([
        pbStr(1, model),
        Buffer.concat([encodeVarint((2 << 3) | 2), encodeVarint(modelMsg.length), modelMsg]),
      ]);
      entry.status = 200; entry.resBytes = out.length; entry.mutated = "SYNTHETIC-available-models";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      console.log(`[${id}] SYNTHETIC AvailableModels -> ${model}`);
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }

    // Sand automation persistence: the host re-creates routines forever if
    // Create echoes no workflow and List returns empty. Store them and answer
    // with real payloads.
    if (/AutomationsService\/CreateSandAutomation$/.test(req.url.split("?")[0])) {
      const agentId = String((tryParse(body) || []).find((f) => f.fieldNo === 11 && f.wireType === 2)?.value || "");
      const name = String((tryParse(body) || []).find((f) => f.fieldNo === 1 && f.wireType === 2)?.value || "automation");
      const wf = (tryParse(body) || []).find((f) => f.fieldNo === 2 && f.wireType === 2)?.value || Buffer.alloc(0);
      const storePath = "/tmp/grokbot-hack/box-data/automations-store.json";
      let store = {};
      try { store = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch {}
      // Dedupe: the host retries creations whose response lacks a server id;
      // identical (agent,name) routines collapse to one stored entry.
      const dup = Object.entries(store).find(([, a]) => a.agentId === agentId && a.name === name);
      let autoId, wfOut;
      if (dup) {
        autoId = dup[0];
        wfOut = Buffer.from(dup[1].workflowB64, "base64");
        console.log(`[${id}] AUTOMATION create "${name}" agent=${agentId.slice(0, 8)} -> dedupe ${autoId}`);
      } else {
        autoId = `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        store[autoId] = { agentId, name, workflowB64: wf.toString("base64"), createdAt: Date.now() };
        try { fs.writeFileSync(storePath, JSON.stringify(store, null, 1)); } catch {}
        wfOut = wf;
        console.log(`[${id}] AUTOMATION create "${name}" agent=${agentId.slice(0, 8)} -> ${autoId} (store now ${Object.keys(store).length})`);
      }
      const out = pbStr(1, wfOut); // CreateAutomationResponse.workflow = echo
      entry.status = 200; entry.resBytes = out.length; entry.mutated = "AUTOMATION-create";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }
    if (/AutomationsService\/ListSandAutomations$/.test(req.url.split("?")[0])) {
      const agentId = String((tryParse(body) || []).find((f) => f.fieldNo === 1 && f.wireType === 2)?.value || "");
      const storePath = "/tmp/grokbot-hack/box-data/automations-store.json";
      let store = {};
      try { store = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch {}
      const parts = [];
      for (const [autoId, a] of Object.entries(store)) {
        if (agentId && a.agentId !== agentId) continue;
        parts.push(pbStr(1, Buffer.from(a.workflowB64, "base64")));
      }
      const out = Buffer.concat(parts); // ListAutomationsResponse.workflows
      entry.status = 200; entry.resBytes = out.length; entry.mutated = `AUTOMATION-list(${parts.length})`;
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/proto", "content-length": String(out.length) });
      return res.end(out);
    }
    if (/AutomationsService\/(DeleteSandAutomation|UpdateSandAutomation)$/.test(req.url.split("?")[0])) {
      const storePath = "/tmp/grokbot-hack/box-data/automations-store.json";
      let store = {};
      try { store = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch {}
      // id field number differs per request; match any string field against stored ids/names
      const strFields = (tryParse(body) || []).filter((f) => f.wireType === 2).map((f) => f.value.toString());
      let changed = 0;
      for (const [autoId, a] of Object.entries(store)) {
        if (strFields.includes(autoId) || strFields.includes(a.name)) { delete store[autoId]; changed++; }
      }
      if (changed) { try { fs.writeFileSync(storePath, JSON.stringify(store, null, 1)); } catch {} }
      console.log(`[${id}] AUTOMATION delete/update matched ${changed} entries`);
      entry.status = 200; entry.mutated = "AUTOMATION-delete";
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/proto" });
      return res.end(Buffer.alloc(0));
    }
    // LOCAL AUTOMATION FIRING: the box polls us for due routine events.
    // Answer from the on-disk routines (bridge-created via CreateRoutine).
    if (req.url.includes("/sand/automation-events/poll")) {
      const out = handleAutomationPoll(body);
      entry.status = 200; entry.mutated = "AUTOMATION-poll"; entry.resBytes = out.length;
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/json" });
      return res.end(out);
    }
    // All other box-originated RPCs get a happy empty proto response (auth is ours now)
    // EXCEPT plugin/marketplace/MCP catalog reads — forward those upstream so D can browse
    // the public marketplace like C does (safe: no write, no quota, no touch to C's bots).
    // Forwarded even with local-fake-token: the public catalog is account-agnostic.
    const PLUGIN_FORWARD_RE = /List(MarketplacePlugins|Marketplaces|AvailableMcpServers)|Get(Plugin|Marketplace|AvailableMcp)|SearchPlugins|GetPluginCatalog/i;
    const isPluginCatalogRead = PLUGIN_FORWARD_RE.test(req.url);
    if ((req.headers["authorization"] || "").match(/local-fake-token|localsig/)) {
      if (!isPluginCatalogRead) {
        console.log(`[${id}] BOX->BACKEND ${req.method} ${req.url} (${body.length}B) -> empty-ok`);
        entry.status = 200; entry.resBytes = 0; entry.note = "box-originated-empty-ok";
        fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
        res.writeHead(200, { "content-type": "application/proto" });
        return res.end(Buffer.alloc(0));
      }
      console.log(`[${id}] PLUGIN-CATALOG forward (local token, read-only) ${req.method} ${req.url}`);
      entry.mutated = "PLUGIN-CATALOG-forward";
      // fall through to https.request upstream — but strip local auth so upstream doesn't 401 on it
      // (public catalog doesn't require auth; better to omit the fake token)
      const fwdHeaders = { ...req.headers };
      delete fwdHeaders["authorization"];
      delete fwdHeaders["Authorization"];
      fwdHeaders.host = UPSTREAM_HOST;
      const upReq2 = https.request(
        { hostname: UPSTREAM_HOST, port: 443, path: req.url, method: req.method, headers: fwdHeaders },
        (upRes) => {
          const chunks2 = [];
          upRes.on("data", (c) => chunks2.push(c));
          upRes.on("end", () => {
            const out2 = Buffer.concat(chunks2);
            entry.status = upRes.statusCode;
            entry.resBytes = out2.length;
            fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
            const h2 = { ...upRes.headers };
            res.writeHead(upRes.statusCode, h2);
            res.end(out2);
          });
        }
      );
      upReq2.on("error", (e) => { entry.error = String(e); fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n"); res.writeHead(502); res.end("proxy error"); });
      upReq2.end(body);
      return;
    }

    const isEnsure = req.url.includes("EnsureSandBox");
    const isUsage = req.url.includes("GetSandUsageStatus") || req.url.includes("GetCurrentPeriodUsage");

    const upReq = https.request(
      { hostname: UPSTREAM_HOST, port: 443, path: req.url, method: req.method, headers: { ...req.headers, host: UPSTREAM_HOST } },      (upRes) => {
        const resChunks = [];
        upRes.on("data", (c) => resChunks.push(c));
        upRes.on("end", () => {
          let outBuf = Buffer.concat(resChunks);
          let mutated = null;

          // Daemon handoff: JSON {baseUrl: "https://...cursorvm.com"} -> fake box
          if (req.url.includes("/sand-box/") && upRes.statusCode === 200 &&
              (req.headers["content-type"] || "").includes("json")) {
            try {
              const j = JSON.parse(outBuf.toString("utf8"));
              if (j.baseUrl && j.baseUrl.includes("cursorvm.com")) {
                const port = 1340;
                j.baseUrl = `http://127.0.0.1:${port}`;
                outBuf = Buffer.from(JSON.stringify(j), "utf8");
                mutated = "daemon-connection->fakebox";
                console.log(`[${id}] MUTATED daemon baseUrl -> http://127.0.0.1:${port}`);
              }
            } catch {}
          }

          if (isEnsure && upRes.statusCode === 200) {
            try {
              const rw = rewriteProto(outBuf, (s) => (s.includes("cursorvm.com") ? rewriteBoxUrl(s) : null));
              if (rw) { outBuf = rw; mutated = "EnsureSandBox->fakebox"; }
            } catch (e) { console.log("rewrite error:", e.message); }
          }

          entry.status = upRes.statusCode;
          entry.resBytes = outBuf.length;
          entry.mutated = mutated;
          fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");

          const h = { ...upRes.headers };
          if (mutated) {
            delete h["content-length"];
            h["content-length"] = String(outBuf.length);
            console.log(`[${id}] MUTATED ${mutated}`);
          }
          res.writeHead(upRes.statusCode, h);
          res.end(outBuf);
        });
      }
    );
    upReq.on("error", (e) => {
      entry.error = String(e);
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
      res.writeHead(502); res.end("proxy error");
    });
    upReq.end(body);
  });
});

server.listen(8787, "127.0.0.1", () => console.log(`proxy2 on :8787 -> ${UPSTREAM_HOST} (EnsureSandBox rewrite ACTIVE)`));
if (LISTEN_PORT !== 8787) {
  try {
    const server2 = http.createServer(server.listeners("request")[0]);
    server2.listen(LISTEN_PORT, "127.0.0.1", () => console.log(`proxy2 also listening on :${LISTEN_PORT}`));
  } catch (e) {
    console.error("Secondary listen error:", e);
  }
}
