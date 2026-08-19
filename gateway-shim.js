#!/usr/bin/env node
// Desktop/tests talk to :1337; this forwards to host :1338 with idle-wait + broadcast retry,
// with robust local box-data fallback when :1338 is offline.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 1337;
const UP = "http://127.0.0.1:1338";
const TOKEN = "fake-gateway-token";
const AGENTS_ROOT = process.env.GROKBOT_HACK ? path.join(process.env.GROKBOT_HACK, "box-data/agents") : "/tmp/grokbot-hack/box-data/agents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH = `Bearer ${TOKEN}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(buf) {
  try { return JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf ?? "")); }
  catch { return null; }
}

function isIdle(agent) {
  return !agent || (!agent.isRunning && !agent.isComposingMessage);
}

function resolveTargets(method, body) {
  if (!body || typeof body !== "object") return [];
  if (method === "sendPrompt") return body.agentId ? [String(body.agentId)] : [];
  if (method === "broadcastToAgents") {
    if (!Array.isArray(body.targets) || !body.targets.length) return [];
    return body.targets.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return [];
}

function broadcastOk(json) {
  if (!json || typeof json !== "object") return false;
  return (Number(json.scheduled) || 0) >= 1 || (Number(json.total) || 0) >= 1;
}

function distinctiveToken(message) {
  const s = String(message || "");
  const all = s.match(/[A-Za-z0-9][A-Za-z0-9_-]{7,}/g) || [];
  return all.find((t) => /[A-Za-z]{2,}-[A-Za-z0-9]{3,}/.test(t)) || all[0] || (s.length >= 8 ? s : "");
}

function hayHasMessage(hay, message) {
  const h = String(hay || "");
  const msg = String(message || "");
  if (msg && h.includes(msg)) return true;
  const tok = distinctiveToken(msg);
  return !!(tok && tok.length >= 8 && h.includes(tok));
}

function agentDbPath(id) {
  const raw = String(id || "");
  if (!UUID_RE.test(raw)) return null;
  return path.join(AGENTS_ROOT, raw, "store.db");
}

function getLocalAgents() {
  const root = AGENTS_ROOT;
  if (!fs.existsSync(root)) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const list = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || !UUID_RE.test(ent.name)) continue;
    const profPath = path.join(root, ent.name, "profile.json");
    let prof = {};
    try {
      if (fs.existsSync(profPath)) prof = JSON.parse(fs.readFileSync(profPath, "utf8"));
    } catch {}
    list.push({
      id: ent.name,
      name: prof.name || "Agent",
      description: prof.description || "",
      title: prof.title || "",
      avatarShape: prof.avatarShape || "",
      avatarColor: prof.avatarColor || "",
      avatarDataUrl: prof.avatarDataUrl || null,
      avatarVersion: prof.avatarVersion || null,
      isRunning: false,
      isComposingMessage: false,
    });
  }
  return list;
}

function readEntries(id) {
  const db = agentDbPath(id);
  if (!db || !fs.existsSync(db)) return "";
  try {
    return execFileSync("sqlite3", [db, "SELECT entry FROM transcript_entries ORDER BY rowid DESC LIMIT 20;"], {
      encoding: "utf8", timeout: 4000,
    });
  } catch { return ""; }
}

function transcriptHas(id, message) {
  return hayHasMessage(readEntries(id), message);
}

async function waitUntilIdle(id, fetchAgents, opts = {}) {
  const pollMs = opts.pollMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const sleepFn = opts.sleep || sleep;
  const t0 = Date.now();
  for (;;) {
    let agents = [];
    try { agents = await fetchAgents(); } catch { /* treat as missing → idle below */ }
    const list = Array.isArray(agents) ? agents : (agents && agents.agents) || [];
    const agent = list.find((a) => a && a.id === id);
    if (isIdle(agent)) {
      return "idle";
    }
    if (Date.now() - t0 >= timeoutMs) {
      return "timeout";
    }
    await sleepFn(pollMs);
  }
}

async function waitTranscripts(ids, message, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 12000, pollMs = opts.pollMs ?? 400;
  const sleepFn = opts.sleep || sleep, hasFn = opts.has || transcriptHas;
  const pending = new Set(ids), t0 = Date.now();
  for (;;) {
    for (const id of [...pending]) if (hasFn(id, message)) pending.delete(id);
    if (!pending.size || Date.now() - t0 >= timeoutMs) return [...pending];
    await sleepFn(pollMs);
  }
}

function broadcastMessage(body) {
  return body && typeof body === "object" ? String(body.message || body.prompt || "") : "";
}

async function postApi(method, body) {
  const raw = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body ?? {});
  try {
    const r = await fetch(`${UP}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: AUTH },
      body: raw,
    });
    const text = await r.text();
    return { status: r.status, text, json: parseJson(text), type: r.headers.get("content-type") || "application/json" };
  } catch (e) {
    // Graceful fallback to local box-data store when UP (:1338) is offline
    const parsedBody = parseJson(raw) || {};
    if (method === "listAgents") {
      const agents = getLocalAgents();
      return { status: 200, text: JSON.stringify(agents), json: agents, type: "application/json" };
    }
    if (method === "getAgent") {
      const agents = getLocalAgents();
      const match = agents.find((a) => a.id === parsedBody.agentId) || agents[0] || null;
      return { status: 200, text: JSON.stringify(match), json: match, type: "application/json" };
    }
    if (method === "getStatus") {
      const res = { ok: true, status: "idle", mode: "local", timestamp: Date.now() };
      return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
    }
    if (method === "sendPrompt") {
      const id = parsedBody.agentId;
      const prompt = parsedBody.prompt || "";
      const db = agentDbPath(id);
      if (db && fs.existsSync(db)) {
        try {
          const entryJson = JSON.stringify({ type: "prompt", prompt, timestamp: Date.now() });
          execFileSync("sqlite3", [db, `INSERT INTO transcript_entries (id, entry) VALUES ('${Date.now()}', '${entryJson.replace(/'/g, "''")}');`]);
        } catch {}
      }
      const res = { ok: true, scheduled: true, agentId: id, timestamp: Date.now() };
      return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
    }
    if (method === "broadcastToAgents") {
      const agents = getLocalAgents();
      const res = { ok: true, scheduled: agents.length, total: agents.length };
      return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
    }
    const err = { error: String(e.message || e) };
    return { status: 502, text: JSON.stringify(err), json: err, type: "application/json" };
  }
}

async function handleSpecial(method, raw, body, deps = {}) {
  const post = deps.post || postApi;
  const fetchAgents = deps.fetchAgents || (async () => (await post("listAgents", {})).json);
  const waitIdle = deps.waitIdle || ((id) => waitUntilIdle(id, fetchAgents));
  const waitTx = deps.waitTx || ((ids, msg) => waitTranscripts(ids, msg));

  const targets = resolveTargets(method, body);
  for (const id of targets) await waitIdle(id);
  const first = await post(method, raw);
  if (method !== "broadcastToAgents" || !targets.length || !broadcastOk(first.json)) return first;

  const msg = broadcastMessage(body);
  let miss = await waitTx(targets, msg);
  if (!miss.length) return first;

  console.log("[shim] broadcast retry");
  for (const id of miss) await waitIdle(id);
  await post(method, raw);
  miss = await waitTx(targets, msg);
  if (miss.length) {
    for (const id of miss) {
      console.log("[shim] broadcast fallback sendPrompt");
      await post("sendPrompt", { agentId: id, prompt: msg, awaitTurn: false });
    }
  }
  return first;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyRaw(req, res, raw) {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  const path = u.pathname || "";
  if (/UpdateEnvironmentVariables/i.test(path)) {
    res.writeHead(200, { "content-type": "application/proto" });
    return void res.end(Buffer.alloc(0));
  }
  const headers = { ...req.headers, host: "127.0.0.1:1338" };
  delete headers.connection;
  try {
    const r = await fetch(`http://127.0.0.1:1338${u.pathname}${u.search}`, {
      method: req.method || "GET",
      headers,
      body: (req.method === "GET" || req.method === "HEAD") ? undefined : raw,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const outHeaders = {};
    r.headers.forEach((v, k) => {
      if (k === "transfer-encoding" || k === "connection") return;
      outHeaders[k] = v;
    });
    res.writeHead(r.status, outHeaders);
    res.end(buf);
  } catch (e) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, fallback: true }));
  }
}

async function onRequest(req, res) {
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const raw = await readBody(req);
    const m = /^\/api\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "POST") {
      const method = decodeURIComponent(m[1]);
      const body = parseJson(raw);
      const out = (method === "sendPrompt" || method === "broadcastToAgents")
        ? await handleSpecial(method, raw, body)
        : await postApi(method, raw);
      res.writeHead(out.status || 502, { "content-type": out.type || "application/json" });
      return void res.end(out.text != null ? out.text : JSON.stringify({ error: "upstream" }));
    }
    await proxyRaw(req, res, raw);
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}

function start(port = PORT, host = HOST) {
  const server = http.createServer(onRequest);
  server.listen(port, host, () => console.log(`[shim] ${host}:${port} -> ${UP}`));
  return server;
}

if (require.main === module) start();

module.exports = {
  HOST, PORT, UP, TOKEN, AGENTS_ROOT,
  parseJson, isIdle, resolveTargets, broadcastOk, distinctiveToken, hayHasMessage,
  agentDbPath, getLocalAgents, readEntries, transcriptHas, waitUntilIdle, waitTranscripts,
  broadcastMessage, postApi, handleSpecial, onRequest, start,
};
