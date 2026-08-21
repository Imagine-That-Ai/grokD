// Shared model-config for D's local box. Official setDefaultModel syncs
// to the computer; when that computer is unreachable the composer queues
// ("Will send when reconnected"). This file is the local source of truth
// that proxy2.js and the Profiles bar both honor.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(os.homedir(), ".grok", "grokbot-d");
const DURABLE = path.join(ROOT, "model-config.json");
const LIVE = "/tmp/grokbot-hack/model-config.json";

const TARGETS = {
  openburnbar: { port: 8320, url: "http://127.0.0.1:8320/v1/chat/completions" },
  cliproxy: { port: 8322, url: "http://127.0.0.1:8322/v1/chat/completions" },
  vibeproxy: { port: 8325, url: "http://127.0.0.1:8325/v1/chat/completions" },
  ollama: { port: 11434, url: "http://127.0.0.1:11434/v1/chat/completions" },
  podex: { port: 8484, url: "http://127.0.0.1:8484/v1/chat/completions" },
};

const FALLBACK_ORDER = ["openburnbar", "cliproxy", "vibeproxy", "ollama", "podex"];

const CURATED = [
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-composer-2.5-fast", name: "Grok Composer 2.5 Fast" },
  { id: "grok-4.5", name: "Grok 4.5" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-fable-5", name: "Claude Fable 5" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "kimi/k3", name: "Kimi K3" },
];

const _portCache = new Map();

function portOpen(port) {
  const now = Date.now();
  const hit = _portCache.get(port);
  if (hit && now - hit.t < 4000) return hit.up;
  let up = false;
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      stdio: "ignore",
      timeout: 800,
    });
    up = true;
  } catch {
    up = false;
  }
  _portCache.set(port, { up, t: now });
  return up;
}

function defaultConfig() {
  return {
    proxyTarget: "openburnbar",
    model: "grok-4.6",
    apiKey: "local-cliproxy",
    cursorAccount: "Primary Cursor Account",
    payingProfileId: null,
  };
}

function readRaw() {
  for (const p of [LIVE, DURABLE]) {
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
        if (cfg && typeof cfg === "object") return cfg;
      }
    } catch {}
  }
  return defaultConfig();
}

function writeConfig(partial) {
  const next = Object.assign(defaultConfig(), readRaw(), partial || {});
  const text = JSON.stringify(next, null, 2) + "\n";
  try {
    fs.mkdirSync(path.dirname(DURABLE), { recursive: true });
    fs.writeFileSync(DURABLE, text);
  } catch {}
  try {
    fs.mkdirSync(path.dirname(LIVE), { recursive: true });
    fs.writeFileSync(LIVE, text);
  } catch {}
  try {
    const pay = path.join(ROOT, "runtime", "paying.json");
    fs.mkdirSync(path.dirname(pay), { recursive: true });
    fs.writeFileSync(pay, JSON.stringify({
      payingProfileId: next.payingProfileId || null,
      cursorAccount: next.cursorAccount || null,
      at: Date.now(),
    }) + "\n");
  } catch {}
  return next;
}

function resolveTarget(preferred) {
  const want = preferred && TARGETS[preferred] ? preferred : "openburnbar";
  const order = [want, ...FALLBACK_ORDER.filter((t) => t !== want)];
  for (const t of order) {
    const spec = TARGETS[t];
    if (spec && portOpen(spec.port)) return t;
  }
  return want;
}

function resolveConfig() {
  const raw = Object.assign(defaultConfig(), readRaw());
  const target = resolveTarget(raw.proxyTarget);
  const spec = TARGETS[target] || TARGETS.openburnbar;
  const fellBack = target !== (raw.proxyTarget || "openburnbar");
  let model = raw.model || "grok-4.6";
  if (target === "ollama" && (model === "grok-4.6" || !model)) {
    model = "deepseek-v4-pro:cloud";
  }
  return {
    proxyUrl: fellBack ? spec.url : (raw.proxyUrl || spec.url),
    apiKey: raw.apiKey || "local-cliproxy",
    model: model,
    proxyTarget: target,
    requestedTarget: raw.proxyTarget || "openburnbar",
    cursorAccount: raw.cursorAccount || "Primary Cursor Account",
    payingProfileId: raw.payingProfileId || null,
    fellBack,
  };
}

function setModel(model, proxyTarget) {
  const patch = { model: String(model || "").trim() };
  if (proxyTarget && TARGETS[proxyTarget]) patch.proxyTarget = proxyTarget;
  return writeConfig(patch);
}

function officialModelObject(modelId) {
  return {
    modelId: String(modelId || "grok-4.6"),
    maxMode: true,
    parameters: [],
  };
}

if (require.main === module) {
  const cmd = process.argv[2] || "show";
  if (cmd === "show") {
    console.log(JSON.stringify(resolveConfig(), null, 2));
  } else if (cmd === "set") {
    const model = process.argv[3];
    if (!model) {
      console.error("usage: model-lib.js set <model> [proxyTarget]");
      process.exit(2);
    }
    console.log(JSON.stringify(setModel(model, process.argv[4]), null, 2));
  } else if (cmd === "list") {
    for (const m of CURATED) console.log(`${m.id}\t${m.name}`);
  } else {
    console.error("usage: model-lib.js show|set|list");
    process.exit(2);
  }
}

module.exports = {
  ROOT, DURABLE, LIVE, TARGETS, CURATED, FALLBACK_ORDER,
  portOpen, readRaw, writeConfig, resolveTarget, resolveConfig, setModel,
  officialModelObject, defaultConfig,
};
