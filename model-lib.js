// Shared model-config for D's local box. Official setDefaultModel syncs
// to the computer; when that computer is unreachable the composer queues
// ("Will send when reconnected"). This file is the local source of truth
// that proxy2.js and the Profiles bar both honor.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const secGuard = require("./security-guard");
const { isGatewayOrLoopbackMarker } = secGuard;

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const DURABLE = path.join(ROOT, "model-config.json");
const LIVE = path.join(ROOT, "runtime", "model-config.json");

const TARGETS = {
  openburnbar: { port: 8320, url: "http://127.0.0.1:8320/v1/chat/completions", service: "openburnbar" },
  cliproxy: { port: 8322, url: "http://127.0.0.1:8322/v1/chat/completions", service: "cliproxy" },
  vibeproxy: { port: 8325, url: "http://127.0.0.1:8325/v1/chat/completions", service: "vibeproxy" },
  ollama: { port: 11434, url: "http://127.0.0.1:11434/v1/chat/completions", service: "ollama" },
  podex: { port: 8484, url: "http://127.0.0.1:8484/v1/chat/completions", service: "podex" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", remote: true },
  vercel: { url: "https://ai-gateway.vercel.sh/v1/chat/completions", remote: true },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/chat/completions", remote: true },
  baseten: { url: "https://bridge.baseten.co/v1/chat/completions", remote: true },
  cloudflare: { url: "https://api.cloudflare.com/client/v4/ai/v1/chat/completions", remote: true },
  wafer: { url: "https://api.wafer.ai/v1/chat/completions", remote: true },
  modal: { url: "https://api.modal.run/v1/chat/completions", remote: true },
  openai: { url: "https://api.openai.com/v1/chat/completions", remote: true },
  anthropic: { url: "https://api.anthropic.com/v1/messages", remote: true },
  xai: { url: "https://api.x.ai/v1/chat/completions", remote: true },
  deepseek: { url: "https://api.deepseek.com/v1/chat/completions", remote: true },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta", remote: true },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", remote: true },
  minimax: { url: "https://api.minimax.chat/v1/text/chatcompletion_v2", remote: true },
};

const FALLBACK_ORDER = ["openburnbar", "cliproxy", "vibeproxy", "ollama", "podex"];

const CURATED = [
  { id: "grok-4.6", name: "Grok 4.6", provider: "xai", providerName: "xAI", logo: "../assets/lobe/grok.svg", tag: "Flagship deep reasoning & autonomous code synthesis" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "openai", providerName: "OpenAI", logo: "../assets/lobe/openai.svg", tag: "Next-gen omni reasoning & proactive agent workflow" },
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "Frontier systems architecture & deep technical writing" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "High-speed hybrid reasoning & multi-file refactors" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", providerName: "DeepSeek", logo: "../assets/lobe/deepseek-color.svg", tag: "Ultra-low latency MoE deep reasoning" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", providerName: "Google", logo: "../assets/lobe/gemini-color.svg", tag: "Massive 2M context window & multimodal reasoning" },
  { id: "kimi/k3", name: "Kimi K3.5", provider: "moonshot", providerName: "Moonshot", logo: "../assets/lobe/moonshot.svg", tag: "Long-horizon agentic memory & document analysis" },
  { id: "grok-composer-2.5-fast", name: "Grok Composer 2.5 Fast", provider: "xai", providerName: "xAI", logo: "../assets/lobe/xai.svg", tag: "Real-time interactive code editor completion" },
  { id: "claude-fable-5", name: "Claude Fable 5", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "Creative synthesis & formal verification" },
  { id: "ollama-local", name: "Llama 4 (Ollama)", provider: "meta", providerName: "Meta / Local", logo: "../assets/lobe/meta-color.svg", tag: "100% private offline computation on this Mac" },
];

const _portCache = new Map();

function verifyProviderSignature(targetKey, port, json) {
  if (!json || typeof json !== "object") return false;
  if (port === 8320 || targetKey === "openburnbar") {
    return Boolean(json.service === "openburnbar-proxy" || json.service === "openburnbar" || json.service === "openburnbar-hub" || json.application === "openburnbar");
  }
  if (port === 8322 || targetKey === "cliproxy") {
    return Boolean(json.service === "cliproxy" || json.service === "cliproxyapi");
  }
  if (port === 8325 || targetKey === "vibeproxy") {
    return Boolean(json.service === "vibeproxy" || json.service === "vibe-proxy");
  }
  if (port === 11434 || targetKey === "ollama") {
    return Boolean((json.status === "ok" || json.version != null || json.models != null) && (json.ok !== false));
  }
  if (port === 1234 || targetKey === "lmstudio") {
    return Boolean((json.status === "ok" || json.service === "lmstudio") && json.ok !== false);
  }
  return Boolean((json.ok === true || json.status === "ok" || json.status === "healthy") && json.service === targetKey);
}

function portOpen(port, targetKey = "") {
  const cacheKey = `${port}:${targetKey}`;
  const now = Date.now();
  const hit = _portCache.get(cacheKey);
  if (hit && now - hit.t < 4000) return hit.up;
  let up = false;
  try {
    const out = execFileSync("/usr/bin/curl", [
      "--fail", "--silent", "--noproxy", "*", "--max-time", "1",
      `http://127.0.0.1:${port}/health`,
    ], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
    });
    const j = JSON.parse(out);
    up = verifyProviderSignature(targetKey, port, j);
  } catch {
    up = false;
  }
  _portCache.set(cacheKey, { up, t: now });
  return up;
}

function defaultConfig() {
  return {
    proxyTarget: "openburnbar",
    model: "grok-4.6",
    apiKey: "",
    cursorAccount: "Primary Cursor Account",
    payingProfileId: null,
  };
}

function readRaw() {
  for (const p of [DURABLE, LIVE]) {
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
        if (cfg && typeof cfg === "object") {
          if (isGatewayOrLoopbackMarker(cfg.apiKey)) cfg.apiKey = "";
          return cfg;
        }
      }
    } catch {}
  }
  return defaultConfig();
}

function writeConfig(partial) {
  const lockFile = path.join(path.dirname(DURABLE), ".model-config.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 4000, staleMs: 15000 });
  if (fd === null) {
    throw new Error("Failed to acquire model-config lock");
  }
  try {
    const current = readRaw();
    const next = Object.assign(defaultConfig(), current, partial || {});
    // If proxy target changed without an explicit new apiKey or proxyUrl, clear old target credentials/url
    if (partial && partial.proxyTarget && partial.proxyTarget !== current.proxyTarget) {
      if (!partial.apiKey) next.apiKey = "";
      if (!partial.proxyUrl) {
        next.proxyUrl = (partial.proxyTarget === "custom" || partial.proxyTarget === "cloud") ? "" : (TARGETS[partial.proxyTarget] ? TARGETS[partial.proxyTarget].url : "");
      }
    }
    // Reject master gateway token from being saved or used as provider apiKey
    if (isGatewayOrLoopbackMarker(next.apiKey)) {
      next.apiKey = "";
    }
    secGuard.writeJsonAtomic0600(DURABLE, next);

    try {
      secGuard.writeFile0600(LIVE, JSON.stringify(next, null, 2) + "\n");
    } catch {}
    try {
      secGuard.writeFile0600(path.join(ROOT, "runtime", "paying.json"), JSON.stringify({
        payingProfileId: next.payingProfileId || null,
        cursorAccount: next.cursorAccount || null,
        at: Date.now(),
      }) + "\n");
    } catch {}
    return next;
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

function resolveTarget(preferred) {
  if (preferred === "custom" || preferred === "cloud") return preferred;
  if (preferred && TARGETS[preferred] && TARGETS[preferred].remote) return preferred;
  const want = preferred && TARGETS[preferred] ? preferred : "openburnbar";
  const order = [want, ...FALLBACK_ORDER.filter((t) => t !== want)];
  for (const t of order) {
    const spec = TARGETS[t];
    if (spec && (spec.remote || portOpen(spec.port, t))) return t;
  }
  return want;
}

function resolveConfig() {
  const raw = Object.assign(defaultConfig(), readRaw());
  const target = resolveTarget(raw.proxyTarget);
  const spec = TARGETS[target] || TARGETS.openburnbar;
  let model = raw.model || "grok-4.6";
  if (target === "ollama" && (model === "grok-4.6" || !model)) {
    model = "deepseek-v4-pro:cloud";
  }
  let safeProxyUrl = spec.url;
  let fellBack = target !== (raw.proxyTarget || "openburnbar");

  if (raw.proxyTarget === "custom" || raw.proxyTarget === "cloud") {
    if (raw.proxyUrl && secGuard.isApprovedProviderUrl(raw.proxyUrl)) {
      safeProxyUrl = raw.proxyUrl;
      fellBack = false;
    } else {
      fellBack = true;
      safeProxyUrl = spec.url;
    }
  }

  // On fallback to a different listener or URL origin, never leak the original apiKey/credential
  let safeApiKey = "";
  if (!fellBack && typeof raw.apiKey === "string" && raw.apiKey.trim().length > 0) {
    let parsedUrl = null;
    try { parsedUrl = new URL(safeProxyUrl); } catch (_) {}
    if (parsedUrl && parsedUrl.protocol === "https:") {
      const host = parsedUrl.hostname.toLowerCase();
      if (!isGatewayOrLoopbackMarker(raw.apiKey) &&
          (raw.proxyTarget === "custom" || raw.proxyTarget === "cloud" || (TARGETS[raw.proxyTarget] && TARGETS[raw.proxyTarget].remote)) &&
          secGuard.isApprovedProviderUrl(safeProxyUrl) &&
          !secGuard.isPrivateOrLoopbackIp(host) &&
          secGuard.parseIpv4Int(host) === null &&
          secGuard.parseIpv6Blocks(host) === null) {
        safeApiKey = raw.apiKey.trim();
      }
    }
  }
  return {
    proxyUrl: safeProxyUrl,
    apiKey: safeApiKey,
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
  if (proxyTarget && TARGETS[proxyTarget]) {
    patch.proxyTarget = proxyTarget;
  }
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
    console.log(JSON.stringify(secGuard.redactProviderSecrets(resolveConfig()), null, 2));
  } else if (cmd === "set") {
    const model = process.argv[3];
    if (!model) {
      console.error("usage: model-lib.js set <model> [proxyTarget]");
      process.exit(2);
    }
    console.log(JSON.stringify(secGuard.redactProviderSecrets(setModel(model, process.argv[4])), null, 2));
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
  officialModelObject, defaultConfig, verifyProviderSignature,
};
