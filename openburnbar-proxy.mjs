#!/usr/bin/env node
// OpenBurnBar loopback OpenAI-compatible gateway on port 8320
// Provides /v1/models and /v1/chat/completions with automatic local model discovery (Ollama/LM Studio).
import http from "node:http";

const PORT = parseInt(process.env.OPENBURNBAR_PORT || process.argv.slice(2).find((_, i, a) => a[i-1] === "--port") || "8320", 10);
const HOST = "127.0.0.1";

const CURATED_MODELS = [
  "grok-4.6",
  "grok-composer-2.5-fast",
  "gpt-5.6-luna",
  "claude-opus-5",
  "gpt-oss:20b-cloud",
  "glm-5.2:cloud",
  "deepseek-v4-pro:cloud"
];

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readModelConfig() {
  const p = path.join(os.homedir(), ".grok", "grokbot-d", "model-config.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return {};
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

async function routeCompletions(body, res) {
  const cfg = readModelConfig();
  const xaiKey = process.env.XAI_API_KEY || cfg.xaiApiKey || (cfg.apiKey && cfg.apiKey.startsWith("xai-") ? cfg.apiKey : null);
  const openAiKey = process.env.OPENAI_API_KEY || cfg.openaiApiKey || (cfg.apiKey && cfg.apiKey.startsWith("sk-") ? cfg.apiKey : null);
  const customBaseUrl = process.env.OPENBURNBAR_PROVIDER_BASE_URL || cfg.providerBaseUrl;
  const customApiKey = process.env.OPENBURNBAR_PROVIDER_API_KEY || cfg.providerApiKey;
  let targetModel = body.model || cfg.model || "grok-4.6";

  // 1. Forward to Remote Provider if API key is configured
  let remoteUrl = null;
  let remoteKey = null;
  if (customBaseUrl && customApiKey) {
    remoteUrl = `${customBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    remoteKey = customApiKey;
  } else if (xaiKey) {
    remoteUrl = "https://api.x.ai/v1/chat/completions";
    remoteKey = xaiKey;
  } else if (openAiKey) {
    remoteUrl = "https://api.openai.com/v1/chat/completions";
    remoteKey = openAiKey;
  }

  if (remoteUrl && remoteKey) {
    try {
      const up = await fetch(remoteUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${remoteKey}`
        },
        body: JSON.stringify({ ...body, model: targetModel })
      });
      if (up.ok) {
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
        return;
      }
    } catch (e) {
      console.error("[openburnbar-proxy] Remote forward failed:", e.message);
    }
  }

  // 2. Auto-forward to local Ollama if running
  const ollamaModels = await getAvailableOllamaModels();
  if (ollamaModels.length > 0) {
    if (!ollamaModels.includes(targetModel)) {
      targetModel = ollamaModels[0];
    }
    const ollamaBody = { ...body, model: targetModel };
    try {
      const up = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ollamaBody),
      });
      if (up.ok) {
        res.writeHead(up.status, {
          "content-type": up.headers.get("content-type") || "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
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
        return;
      }
    } catch (e) {
      console.error("[openburnbar-proxy] Ollama forward failed:", e.message);
    }
  }

  // 3. Fallback: Stream beautiful, interactive onboarding guide
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });
  const text = `👋 **Welcome to Grok "D" — Powered by OpenBurnBar!**\n\nYour local AI gateway is active on \`http://127.0.0.1:8320\`.\n\nTo connect your AI models, choose an option below:\n\n* ⚡ **Free Local AI (Zero Keys)**: Run [Ollama](https://ollama.com) (\`ollama run llama3.2\`) or LM Studio. OpenBurnBar auto-detects it instantly.\n* 🔑 **Cloud API Key**: Set \`export XAI_API_KEY="xai-..."\` or an OpenAI key in OpenBurnBar.\n* ✨ **Cursor Multi-Seat**: Click the bottom-left seat menu to link your Cursor account.\n* 🔥 **BurnBar Mac App**: Check out the official menu bar app at [burnbar.app](https://burnbar.app) for full agent spend & transcript tracking.`;

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

  if (url.pathname === "/v1/models" && req.method === "GET") {
    const ollamaModels = await getAvailableOllamaModels();
    const all = [...new Set([...CURATED_MODELS, ...ollamaModels])].map(id => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "openburnbar",
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: all }));
    return;
  }

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
  console.log(`[openburnbar-proxy] listening on http://${HOST}:${PORT}`);
});
