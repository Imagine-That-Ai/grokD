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
  const ollamaModels = await getAvailableOllamaModels();
  let targetModel = body.model || "grok-4.6";

  // Auto-map to first available Ollama model if running locally
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

  // Fallback: Synthesize OpenAI SSE streaming response if no engine running
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });
  const text = "Local D is active on this Mac. Ready for prompts!";
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
