#!/usr/bin/env node
// OpenBurnBar loopback OpenAI-compatible gateway on port 8320
// Universal AI Provider Hub: OpenAI, OpenRouter, Anthropic, xAI, MiniMax, DeepSeek, Gemini, Groq, Ollama, LM Studio.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = parseInt(process.env.OPENBURNBAR_PORT || process.argv.slice(2).find((_, i, a) => a[i-1] === "--port") || "8320", 10);
const HOST = "127.0.0.1";
const CONFIG_PATH = path.join(os.homedir(), ".grok", "grokbot-d", "model-config.json");

const PROVIDER_DEFAULTS = {
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-3.7-sonnet", "deepseek/deepseek-r1", "openai/gpt-4o", "meta-llama/llama-3.3-70b-instruct"],
    header: (k) => ({ "authorization": `Bearer ${k}`, "HTTP-Referer": "https://burnbar.app", "X-Title": "BurnBar Grok D" })
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  },
  anthropic: {
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    header: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" })
  },
  xai: {
    name: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-2-latest", "grok-2-vision-1212", "grok-beta"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  },
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    models: ["MiniMax-Text-01", "MiniMax-M3", "MiniMax-M2.7", "abab6.5s-chat"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  },
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-2.0-pro-exp-02-05", "gemini-1.5-pro"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b"],
    header: (k) => ({ "authorization": `Bearer ${k}` })
  }
};

function readModelConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {}
  return {};
}

function writeModelConfig(patch) {
  try {
    const cur = readModelConfig();
    const next = { ...cur, ...patch };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
    return next;
  } catch (e) {
    console.error("[openburnbar-proxy] writeModelConfig error:", e);
    return readModelConfig();
  }
}

async function getAvailableOllamaModels() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map(m => m.name || m.model);
  } catch {
    return [];
  }
}

async function getAvailableLMStudioModels() {
  try {
    const res = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.data || []).map(m => m.id);
  } catch {
    return [];
  }
}

function resolveProvider(model, cfg) {
  const providers = cfg.providers || {};
  
  if (model.startsWith("openrouter/")) {
    const key = providers.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey;
    return { target: "openrouter", model: model.replace(/^openrouter\//, ""), key, ...PROVIDER_DEFAULTS.openrouter };
  }
  if (model.startsWith("deepseek/")) {
    const key = providers.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || cfg.deepseekApiKey;
    return { target: "deepseek", model: model.replace(/^deepseek\//, ""), key, ...PROVIDER_DEFAULTS.deepseek };
  }
  if (model.startsWith("minimax/")) {
    const key = providers.minimax?.apiKey || process.env.MINIMAX_API_KEY || cfg.minimaxApiKey;
    return { target: "minimax", model: model.replace(/^minimax\//, ""), key, ...PROVIDER_DEFAULTS.minimax };
  }
  if (model.startsWith("xai/") || model.startsWith("grok/")) {
    const key = providers.xai?.apiKey || process.env.XAI_API_KEY || cfg.xaiApiKey;
    return { target: "xai", model: model.replace(/^(xai|grok)\//, ""), key, ...PROVIDER_DEFAULTS.xai };
  }
  if (model.startsWith("gemini/")) {
    const key = providers.gemini?.apiKey || process.env.GEMINI_API_KEY || cfg.geminiApiKey;
    return { target: "gemini", model: model.replace(/^gemini\//, ""), key, ...PROVIDER_DEFAULTS.gemini };
  }
  if (model.startsWith("openai/") || model.startsWith("gpt/")) {
    const key = providers.openai?.apiKey || process.env.OPENAI_API_KEY || cfg.openaiApiKey;
    return { target: "openai", model: model.replace(/^(openai|gpt)\//, ""), key, ...PROVIDER_DEFAULTS.openai };
  }

  const openrouterKey = providers.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey;
  if (openrouterKey) {
    return { target: "openrouter", model, key: openrouterKey, ...PROVIDER_DEFAULTS.openrouter };
  }

  const xaiKey = providers.xai?.apiKey || process.env.XAI_API_KEY || cfg.xaiApiKey || (cfg.apiKey?.startsWith("xai-") ? cfg.apiKey : null);
  if (xaiKey && (/grok/i.test(model) || !providers.openai?.apiKey)) {
    return { target: "xai", model: model.startsWith("grok-") ? model : "grok-2-latest", key: xaiKey, ...PROVIDER_DEFAULTS.xai };
  }

  const openAiKey = providers.openai?.apiKey || process.env.OPENAI_API_KEY || cfg.openaiApiKey || (cfg.apiKey?.startsWith("sk-") ? cfg.apiKey : null);
  if (openAiKey) {
    return { target: "openai", model, key: openAiKey, ...PROVIDER_DEFAULTS.openai };
  }

  const deepseekKey = providers.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || cfg.deepseekApiKey;
  if (deepseekKey && /deepseek/i.test(model)) {
    return { target: "deepseek", model, key: deepseekKey, ...PROVIDER_DEFAULTS.deepseek };
  }

  const minimaxKey = providers.minimax?.apiKey || process.env.MINIMAX_API_KEY || cfg.minimaxApiKey;
  if (minimaxKey && /minimax|abab/i.test(model)) {
    return { target: "minimax", model, key: minimaxKey, ...PROVIDER_DEFAULTS.minimax };
  }

  const geminiKey = providers.gemini?.apiKey || process.env.GEMINI_API_KEY || cfg.geminiApiKey;
  if (geminiKey && /gemini/i.test(model)) {
    return { target: "gemini", model, key: geminiKey, ...PROVIDER_DEFAULTS.gemini };
  }

  return null;
}

async function pipeStream(up, res) {
  res.writeHead(up.status, {
    "content-type": up.headers.get("content-type") || "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive"
  });
  if (up.body) {
    const reader = up.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

async function routeCompletions(body, res) {
  const cfg = readModelConfig();
  const customBaseUrl = process.env.OPENBURNBAR_PROVIDER_BASE_URL || cfg.providerBaseUrl;
  const customApiKey = process.env.OPENBURNBAR_PROVIDER_API_KEY || cfg.providerApiKey;
  let targetModel = body.model || cfg.model || "grok-4.6";

  // 1. Custom Provider Endpoint Override
  if (customBaseUrl && customApiKey) {
    try {
      const remoteUrl = `${customBaseUrl.replace(/\/+$/, "")}/chat/completions`;
      const up = await fetch(remoteUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${customApiKey}` },
        body: JSON.stringify({ ...body, model: targetModel })
      });
      if (up.ok) return pipeStream(up, res);
    } catch (e) {
      console.error("[openburnbar-proxy] Custom base forward failed:", e.message);
    }
  }

  // 2. Resolve Multi-Provider Route
  const provider = resolveProvider(targetModel, cfg);
  if (provider && provider.key) {
    // Special handling for Anthropic direct API key
    if (provider.target === "anthropic") {
      try {
        const systemMsg = (body.messages || []).find(m => m.role === "system")?.content || "";
        const userMessages = (body.messages || []).filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        }));

        const anthropicBody = {
          model: provider.model || "claude-3-7-sonnet-20250219",
          max_tokens: body.max_tokens || 4096,
          stream: true,
          messages: userMessages.length ? userMessages : [{ role: "user", content: "Hello" }]
        };
        if (systemMsg) anthropicBody.system = systemMsg;

        const up = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": provider.key,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(anthropicBody)
        });

        if (up.ok) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive"
          });
          const reader = up.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6).trim();
                if (dataStr === "[DONE]") continue;
                try {
                  const ev = JSON.parse(dataStr);
                  if (ev.type === "content_block_delta" && ev.delta?.text) {
                    const chunk = {
                      id: "chatcmpl-" + Date.now(),
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: targetModel,
                      choices: [{ index: 0, delta: { content: ev.delta.text }, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  }
                } catch (_) {}
              }
            }
          }
          const endChunk = {
            id: "chatcmpl-" + Date.now(),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: targetModel,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
          res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
      } catch (e) {
        console.error("[openburnbar-proxy] Anthropic native forward failed:", e.message);
      }
    }

    // Standard OpenAI-Compatible Multi-Provider Forward
    try {
      const headers = { "content-type": "application/json", ...(provider.header ? provider.header(provider.key) : { "authorization": `Bearer ${provider.key}` }) };
      const remoteUrl = `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const up = await fetch(remoteUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, model: provider.model || targetModel })
      });
      if (up.ok) return pipeStream(up, res);
    } catch (e) {
      console.error(`[openburnbar-proxy] ${provider.name} forward failed:`, e.message);
    }
  }

  // 3. CLIProxy (:8322) Active OAuth Subscriptions (Codex / ChatGPT Plus / Claude Pro / xAI)
  try {
    const up = await fetch("http://127.0.0.1:8322/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer local-cliproxy" },
      body: JSON.stringify({ ...body, model: targetModel }),
      signal: AbortSignal.timeout(3000)
    });
    if (up.ok) return pipeStream(up, res);
  } catch (_) {
    // CLIProxy not running or model not in CLIProxy catalog, continue to local engines
  }

  // 4. Local LM Studio (:1234) Auto-Forward
  const lmModels = await getAvailableLMStudioModels();
  if (lmModels.length > 0) {
    const lmModel = lmModels.includes(targetModel) ? targetModel : lmModels[0];
    try {
      const up = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, model: lmModel }),
      });
      if (up.ok) return pipeStream(up, res);
    } catch (e) {
      console.error("[openburnbar-proxy] LM Studio forward failed:", e.message);
    }
  }

  // 5. Local Ollama (:11434) Auto-Forward
  const ollamaModels = await getAvailableOllamaModels();
  if (ollamaModels.length > 0) {
    const ollamaModel = ollamaModels.includes(targetModel) ? targetModel : ollamaModels[0];
    try {
      const up = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, model: ollamaModel }),
      });
      if (up.ok) return pipeStream(up, res);
    } catch (e) {
      console.error("[openburnbar-proxy] Ollama forward failed:", e.message);
    }
  }

  // 5. Rich Onboarding & Provider Setup Fallback
  const text = `👋 **Welcome to Grok "D" — Powered by OpenBurnBar!**\n\nYour local AI gateway is active on \`http://127.0.0.1:8320\`.\n\nTo connect your AI subscriptions and keys:\n\n* 🌐 **OpenRouter / All Models**: Connect via OAuth or add an OpenRouter key to unlock Claude 3.7, DeepSeek R1, GPT-4o & Llama 3.3.\n* ⚡ **Free Local AI**: Run [Ollama](https://ollama.com) (\`ollama run llama3.2\`) or LM Studio. OpenBurnBar auto-detects local models instantly.\n* 🔑 **Direct API Keys**: Configure OpenAI, xAI, Anthropic, MiniMax, DeepSeek, or Gemini in the **OpenBurnBar & Models** settings menu.\n* ✨ **Cursor Multi-Seat**: Click the bottom-left seat menu to manage multiple Cursor accounts.\n* 🔥 **BurnBar Mac App**: Check out [burnbar.app](https://burnbar.app) for system-wide AI spend tracking.`;

  if (body.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: targetModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop"
      }]
    }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });

  const chunk = {
    id: "chatcmpl-" + Date.now(),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: targetModel,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  const finishChunk = {
    id: "chatcmpl-" + Date.now(),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: targetModel,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  // OAuth Callback Handler (OpenRouter / Custom OAuth)
  if (url.pathname === "/auth/callback" || url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code") || url.searchParams.get("token") || url.searchParams.get("api_key") || url.searchParams.get("key");
    const provider = url.searchParams.get("provider") || "openrouter";
    if (code) {
      const safeProvider = String(provider || "openrouter").replace(/[^a-zA-Z0-9_-]/g, "");
      const patch = { providers: { ...readModelConfig().providers, [safeProvider]: { enabled: true, apiKey: code, connectedAt: Date.now() } } };
      if (safeProvider === "openrouter") patch.openrouterApiKey = code;
      writeModelConfig(patch);
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system;background:#0b0d13;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,0.5);max-width:440px;"><h2 style="margin:0 0 12px;color:#58a6ff;">⚡ OpenBurnBar Connected!</h2><p style="color:#8b949e;line-height:1.5;">${safeProvider.toUpperCase()} has been authenticated and linked to your local Grok "D" workspace.</p><p style="color:#58a6ff;font-size:13px;margin-top:20px;">You can close this window now.</p><script>setTimeout(() => window.close(), 1500);</script></div></body></html>`);
      return;
    }
  }

  // Model List Endpoint
  if (url.pathname === "/v1/models" && req.method === "GET") {
    const ollama = await getAvailableOllamaModels();
    const lm = await getAvailableLMStudioModels();
    const cfg = readModelConfig();
    const providerModels = [];
    if (cfg.openrouterApiKey || cfg.providers?.openrouter?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.openrouter.models);
    }
    if (cfg.openaiApiKey || cfg.providers?.openai?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.openai.models);
    }
    if (cfg.xaiApiKey || cfg.providers?.xai?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.xai.models);
    }
    if (cfg.deepseekApiKey || cfg.providers?.deepseek?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.deepseek.models);
    }
    if (cfg.minimaxApiKey || cfg.providers?.minimax?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.minimax.models);
    }
    if (cfg.geminiApiKey || cfg.providers?.gemini?.apiKey) {
      providerModels.push(...PROVIDER_DEFAULTS.gemini.models);
    }

    const curated = ["grok-4.6", "grok-composer-2.5-fast", "gpt-5.6-luna", "claude-opus-5", "deepseek-v4-pro:cloud"];
    const all = [...new Set([...curated, ...providerModels, ...ollama, ...lm])].map(id => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "openburnbar",
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: all }));
    return;
  }

  // Provider Config API
  if (url.pathname === "/api/providers" && req.method === "GET") {
    const cfg = readModelConfig();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, config: cfg, defaults: PROVIDER_DEFAULTS }));
    return;
  }

  if (url.pathname === "/api/providers" && req.method === "POST") {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const updated = writeModelConfig(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, config: updated }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // OAuth Subscription Trigger API (Codex / ChatGPT Plus, Claude Pro, xAI)
  if (url.pathname === "/api/oauth/login" && req.method === "POST") {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const provider = String(body.provider || "codex").toLowerCase();
        let flag = "-codex-login";
        if (provider === "claude" || provider === "anthropic") flag = "-claude-login";
        if (provider === "xai" || provider === "grok") flag = "-xai-login";
        if (provider === "kimi") flag = "-kimi-login";
        if (provider === "antigravity") flag = "-antigravity-login";

        const cliproxyBin = "/Users/albertonunez/.homebrew/bin/cliproxyapi";
        if (fs.existsSync(cliproxyBin)) {
          const { spawn } = await import("node:child_process");
          const child = spawn(cliproxyBin, [flag], { detached: true, stdio: "ignore" });
          child.unref();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: `Launched ${provider} OAuth browser login` }));
        } else {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "cliproxyapi binary not found" }));
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Chat Completions Endpoint
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        await routeCompletions(body, res);
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found" } }));
});

server.listen(PORT, HOST, () => {
  console.log(`[openburnbar-proxy] Multi-Provider Hub listening on http://${HOST}:${PORT}`);
});
