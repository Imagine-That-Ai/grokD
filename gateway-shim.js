#!/usr/bin/env node
// Desktop/tests talk to :1337; this forwards to host :1338 with idle-wait + broadcast retry,
// with robust local box-data fallback when :1338 is offline.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { newId, createAgentAtomically } = require("./clone-bot");
const { ensureAgentStoreDb } = require("./agent-store-db");

const paths = require("./paths");
const secGuard = require("./security-guard");

const HOST = "127.0.0.1";
const PORT = Number(process.env.GROK_SHIM_PORT || 1337);
const TOKEN = secGuard.getGatewayToken();
const AGENTS_ROOT = process.env.GROKBOT_HACK
  ? path.join(process.env.GROKBOT_HACK, "box-data/agents")
  : path.join(paths.existingHack(), "box-data", "agents");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH = `Bearer ${TOKEN}`;

function resolveUp(raw) {
  const fallback = "http://127.0.0.1:1338";
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && !u.username && !u.password) {
      const port = Number(u.port) || 1338;
      if (port > 0 && port < 65536) return `http://127.0.0.1:${port}`;
    }
  } catch {}
  return fallback;
}
const UP = resolveUp(process.env.GROK_SHIM_UP);
const UP_URL = new URL(UP);

function allowedAuthHeaders() {
  const token = secGuard.getGatewayToken();
  return [`Bearer ${token}`];
}

const READ_METHODS = new Set(["listAgents", "getAgent", "getStatus", "health", "ping", "status", "getHealth"]);
const PROXY_ALLOWED_METHODS = new Set([
  "listAgents", "getAgent", "getStatus", "health", "ping", "status", "getHealth",
  "sendPrompt", "broadcastToAgents"
]);
const CONTROL_ALLOWED_METHODS = new Set(["interruptAgent", "stopAgent", "deleteLocalAgents"]);
const BRIDGE_ALLOWED_METHODS = new Set([
  "listAgents", "getAgent", "getStatus", "health", "ping", "status", "getHealth",
  "sendPrompt", "broadcastToAgents"
]);

function authorizationMatches(header, reqPath = "", method = "") {
  const got = String(header || "").trim();
  if (!got) return false;

  if (reqPath === "/api/oauth/login" || reqPath === "/oauth/login") {
    return secGuard.verifyOAuthTriggerAuth(got);
  }

  // Full gateway master token is authorized for everything
  if (secGuard.verifyGatewayAuth(got)) return true;
  if (allowedAuthHeaders().some((allowed) => secGuard.timingSafeEqualStr(got, allowed))) return true;

  const rawToken = got.startsWith("Bearer ") ? got.slice(7).trim() : got;

  // bot-create: strictly for createAgent
  if ((reqPath === "/api/createAgent" || method === "createAgent") && secGuard.verifySessionJwt(rawToken, "bot-create")) {
    return true;
  }
  // agent-control: control methods like interruptAgent, stopAgent, deleteLocalAgents
  if (CONTROL_ALLOWED_METHODS.has(method) && secGuard.verifySessionJwt(rawToken, "agent-control")) {
    return true;
  }
  // local-mcp: strictly read-only methods
  if (READ_METHODS.has(method) && secGuard.verifySessionJwt(rawToken, "local-mcp")) {
    return true;
  }
  // grokbot-proxy: proxy read & prompt dispatch, not destructive APIs or arbitrary raw proxy
  if (PROXY_ALLOWED_METHODS.has(method) && secGuard.verifySessionJwt(rawToken, "grokbot-proxy")) {
    return true;
  }
  // gateway-bridge: bridge operations (read + dispatch)
  if (BRIDGE_ALLOWED_METHODS.has(method) && secGuard.verifySessionJwt(rawToken, "gateway-bridge")) {
    return true;
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(buf) {
  try { return JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf ?? "")); }
  catch { return null; }
}

function isIdle(agent) {
  return !agent || (!agent.isRunning && !agent.isComposingMessage);
}

const MAX_BROADCAST_TARGETS = 16;

function resolveTargets(method, body) {
  if (!body || typeof body !== "object") return [];
  if (method === "sendPrompt") {
    const id = String(body.agentId || "").trim();
    return UUID_RE.test(id) ? [id] : [];
  }
  if (method === "broadcastToAgents") {
    if (!Array.isArray(body.targets) || !body.targets.length) return [];
    const valid = new Set();
    for (const t of body.targets) {
      const id = String(t || "").trim();
      if (UUID_RE.test(id)) valid.add(id);
      if (valid.size >= MAX_BROADCAST_TARGETS) break;
    }
    return Array.from(valid);
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

function createLocalAgent(body, root = AGENTS_ROOT) {
  const existing = getLocalAgents();
  if (existing.length >= 64) {
    throw new Error("agent quota exceeded (max 64 agents)");
  }
  const name = String(body && body.name || "").trim().slice(0, 64) || "New Bot";
  const id = newId();
  const prof = {
    name,
    description: String((body && body.description) || "").slice(0, 1024),
    title: String((body && body.title) || "").slice(0, 128),
    origin: String((body && body.origin) || "user").slice(0, 32),
    createdAt: Date.now(),
  };
  createAgentAtomically(root, id, (staging) => {
    ensureAgentStoreDb(path.join(staging, "store.db"));
    fs.writeFileSync(
      path.join(staging, "profile.json"),
      JSON.stringify(prof, null, 2) + "\n",
      { mode: 0o600 }
    );
  });
  const agent = { id, ...prof, isRunning: false, isComposingMessage: false };
  return { id, name, agent };
}

function deleteLocalAgents(ids, root = AGENTS_ROOT) {
  const list = Array.isArray(ids) ? ids : [];
  let deleted = 0;
  for (const id of list) {
    if (!UUID_RE.test(String(id || ""))) continue;
    const dir = path.join(root, id);
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    deleted += 1;
  }
  return { ok: true, deleted };
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

const { sqliteRead } = require("./sqlite-ro");

function readEntries(id, minRowId = 0) {
  const db = agentDbPath(id);
  if (!db || !fs.existsSync(db)) return "";
  try {
    if (minRowId > 0) {
      return sqliteRead(db, `SELECT entry FROM transcript_entries WHERE rowid > ${minRowId} ORDER BY rowid DESC LIMIT 20;`);
    }
    return sqliteRead(db, "SELECT entry FROM transcript_entries ORDER BY rowid DESC LIMIT 20;");
  } catch { return ""; }
}

function getMaxRowId(id) {
  const db = agentDbPath(id);
  if (!db || !fs.existsSync(db)) return 0;
  try {
    const raw = sqliteRead(db, "SELECT MAX(rowid) as maxId FROM transcript_entries;");
    const m = String(raw).match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  } catch { return 0; }
}

function transcriptHas(id, message, minRowId = 0) {
  const tok = distinctiveToken(message);
  return hayHasMessage(readEntries(id, minRowId), tok || message);
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
  const baselines = opts.baselines || new Map();
  const pending = new Set(ids), t0 = Date.now();
  const token = distinctiveToken(message);
  for (;;) {
    for (const id of [...pending]) {
      const minRow = baselines.get(id) || 0;
      if (hasFn(id, token || message, minRow)) pending.delete(id);
    }
    if (!pending.size || Date.now() - t0 >= timeoutMs) return [...pending];
    await sleepFn(pollMs);
  }
}

function broadcastMessage(body) {
  return body && typeof body === "object" ? String(body.message || body.prompt || "") : "";
}

function normalizeCreateAgent(raw) {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid json payload for createAgent");
  }
  const name = String(parsed.name || "New Bot").trim().slice(0, 64) || "New Bot";
  const description = String(parsed.description || "").slice(0, 1024);
  const title = String(parsed.title || "").slice(0, 128);
  const origin = String(parsed.origin || "user").slice(0, 32);
  const model = parsed.model ? String(parsed.model).slice(0, 64) : undefined;
  return JSON.stringify({ name, description, title, origin, ...(model ? { model } : {}) });
}

let _activeDispatchCount = 0;
const MAX_CONCURRENT_DISPATCH = 16;
const _dispatchRateWindows = new Map();

function checkDispatchRateLimit(callerKey = "global", cost = 1) {
  const now = Date.now();
  const windowMs = 60000;
  const maxReqs = 120;
  let record = _dispatchRateWindows.get(callerKey);
  if (!record || now - record.start > windowMs) {
    record = { start: now, count: 0 };
    _dispatchRateWindows.set(callerKey, record);
  }
  record.count += Math.max(1, cost);
  return record.count <= maxReqs;
}

async function postApi(method, body, opts = {}) {
  if (/^(getStatus|health|ping|status|getHealth)$/i.test(method)) {
    const res = { ok: true, status: "idle", mode: "local", connected: true, timestamp: Date.now() };
    return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
  }
  if (method === "createAgent" || method === "deleteAgent" || method === "deleteAgents" || method === "deleteLocalAgents") {
    if (!checkDispatchRateLimit("mutating", 1)) {
      const err = { ok: false, error: "Too Many Requests: mutating rate limit exceeded" };
      return { status: 429, text: JSON.stringify(err), json: err, type: "application/json" };
    }
  }
  if (!opts.alreadyCounted && (method === "sendPrompt" || method === "broadcastToAgents")) {
    const targets = resolveTargets(method, body);
    const cost = Math.max(1, targets.length);
    if (!checkDispatchRateLimit("global", cost)) {
      const err = { ok: false, error: "Too Many Requests: dispatch rate limit exceeded" };
      return { status: 429, text: JSON.stringify(err), json: err, type: "application/json" };
    }
    if (_activeDispatchCount >= MAX_CONCURRENT_DISPATCH) {
      const err = { ok: false, error: "Too Many Requests: maximum concurrency reached" };
      return { status: 429, text: JSON.stringify(err), json: err, type: "application/json" };
    }
  }
  let raw = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body ?? {});
  if (method === "createAgent") {
    try {
      raw = normalizeCreateAgent(raw);
    } catch (normErr) {
      const err = { ok: false, error: normErr.message };
      return { status: 400, text: JSON.stringify(err), json: err, type: "application/json" };
    }
  }
  if (method === "listAgents" || method === "getAgent") {
    try {
      const r = await fetch(`${UP}/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: AUTH },
        body: raw,
      });
      const text = await r.text();
      let res = parseJson(text);
      if (Array.isArray(res) || (res && res.id)) {
        return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
      }
      return { status: r.status, text, json: res, type: r.headers.get("content-type") || "application/json" };
    } catch (e) {
      return offlineFallback(method, parseJson(raw) || {}, e);
    }
  }
  const isDispatch = !opts.alreadyCounted && (method === "sendPrompt" || method === "broadcastToAgents");
  if (isDispatch) _activeDispatchCount++;
  try {
    const r = await fetch(`${UP}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: AUTH },
      body: raw,
    });
    const text = await r.text();
    return { status: r.status, text, json: parseJson(text), type: r.headers.get("content-type") || "application/json" };
  } catch (e) {
    return offlineFallback(method, parseJson(raw) || {}, e);
  } finally {
    if (isDispatch) _activeDispatchCount = Math.max(0, _activeDispatchCount - 1);
  }
}

function offlineFallback(method, parsedBody, err) {
  // listAgents may still answer from disk when :1338 is down. sendPrompt must not.
  if (method === "listAgents") {
    const agents = getLocalAgents();
    return { status: 200, text: JSON.stringify(agents), json: agents, type: "application/json" };
  }
  if (method === "getAgent") {
    const agents = getLocalAgents();
    const match = agents.find((a) => a.id === parsedBody.agentId) || null;
    if (!match) {
      const err = { ok: false, error: "agent not found" };
      return { status: 404, text: JSON.stringify(err), json: err, type: "application/json" };
    }
    return { status: 200, text: JSON.stringify(match), json: match, type: "application/json" };
  }
  if (method === "getStatus") {
    const res = { ok: true, status: "idle", mode: "local", timestamp: Date.now() };
    return { status: 200, text: JSON.stringify(res), json: res, type: "application/json" };
  }
  if (method === "sendPrompt") {
    const fail = { ok: false, error: "local box host is down" };
    return { status: 502, text: JSON.stringify(fail), json: fail, type: "application/json" };
  }
  if (method === "broadcastToAgents") {
    const fail = { ok: false, error: "local box host is down" };
    return { status: 502, text: JSON.stringify(fail), json: fail, type: "application/json" };
  }
  if (method === "createAgent") {
    try {
      const created = createLocalAgent(parsedBody);
      return { status: 200, text: JSON.stringify(created), json: created, type: "application/json" };
    } catch (createErr) {
      const fail = { error: String(createErr.message || createErr) };
      return { status: 400, text: JSON.stringify(fail), json: fail, type: "application/json" };
    }
  }
  if (method === "deleteAgents" || method === "deleteAgent") {
    const ids = parsedBody.ids || (parsedBody.id ? [parsedBody.id] : [parsedBody.agentId]);
    const deleted = deleteLocalAgents(ids);
    return { status: 200, text: JSON.stringify(deleted), json: deleted, type: "application/json" };
  }
  const fail = { ok: false, error: String((err && err.message) || err || "upstream") };
  return { status: 502, text: JSON.stringify(fail), json: fail, type: "application/json" };
}

async function handleSpecial(method, raw, body, deps = {}) {
  const auth = deps.auth || AUTH;
  const post = deps.post || ((m, b, extra) => postApi(m, b, extra));
  const fetchAgents = deps.fetchAgents || (async () => (await post("listAgents", {})).json);
  const waitIdle = deps.waitIdle || ((id) => waitUntilIdle(id, fetchAgents));
  const waitTx = deps.waitTx || ((ids, msg, opts) => waitTranscripts(ids, msg, opts));

  const isDispatch = method === "sendPrompt" || method === "broadcastToAgents";
  const targets = resolveTargets(method, body);
  if (method === "broadcastToAgents") {
    if (body && Array.isArray(body.targets) && body.targets.length > MAX_BROADCAST_TARGETS) {
      const err = { ok: false, error: `Too many broadcast targets: maximum is ${MAX_BROADCAST_TARGETS}` };
      return { status: 400, text: JSON.stringify(err), json: err, type: "application/json" };
    }
  }

  if (isDispatch) {
    const cost = Math.max(1, targets.length);
    if (!checkDispatchRateLimit("global", cost)) {
      const err = { ok: false, error: "Too Many Requests: dispatch rate limit exceeded" };
      return { status: 429, text: JSON.stringify(err), json: err, type: "application/json" };
    }
    if (_activeDispatchCount >= MAX_CONCURRENT_DISPATCH) {
      const err = { ok: false, error: "Too Many Requests: maximum concurrency reached" };
      return { status: 429, text: JSON.stringify(err), json: err, type: "application/json" };
    }
    _activeDispatchCount++;
  }

  try {
    for (const id of targets) {
      const idleState = await waitIdle(id);
      if (idleState === "timeout") {
        const busyErr = { ok: false, error: "agent busy: timed out waiting for idle state" };
        return { status: 409, text: JSON.stringify(busyErr), json: busyErr, type: "application/json" };
      }
    }

    const baselines = new Map();
    for (const id of targets) {
      baselines.set(id, getMaxRowId(id));
    }

    const dispatchId = `gd-tx-${crypto.randomBytes(8).toString("hex")}`;
    const canonicalBody = (method === "broadcastToAgents" && typeof body === "object" && body !== null)
      ? JSON.stringify({ ...body, targets, dispatchId })
      : raw;

    const first = await post(method, canonicalBody, { alreadyCounted: true });
    if (method !== "broadcastToAgents" || !targets.length) return first;
    if (!broadcastOk(first.json)) return first;

    const msg = broadcastMessage(body);
    const miss = await waitTx(targets, msg || dispatchId, { baselines });
    if (!miss.length) return first;

    console.log("[shim] broadcast partial delivery for targets:", miss);
    for (const id of miss) await waitIdle(id);
    const second = await post(method, JSON.stringify({ ...body, targets: miss, dispatchId: `gd-tx-${crypto.randomBytes(8).toString("hex")}` }), { alreadyCounted: true });
    return second && second.json ? second : first;
  } finally {
    if (isDispatch) _activeDispatchCount = Math.max(0, _activeDispatchCount - 1);
  }
}

const MAX_SHIM_BODY = 10 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_SHIM_BODY) {
        const err = new Error("Payload Too Large");
        err.status = 413;
        req.destroy();
        return reject(err);
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const ALLOWED_API_METHODS = new Set([
  "listAgents", "getAgent", "createAgent", "deleteAgent", "deleteAgents", "deleteLocalAgents",
  "sendPrompt", "broadcastToAgents", "getStatus", "health",
  "ping", "status", "getHealth", "interruptAgent", "stopAgent",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

async function proxyRaw(req, res, raw) {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  const reqPath = u.pathname || "";
  if (/UpdateEnvironmentVariables/i.test(reqPath)) {
    res.writeHead(200, { "content-type": "application/proto" });
    return void res.end(Buffer.alloc(0));
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase())) {
      headers[k] = v;
    }
  }
  headers.host = UP_URL.host;
  try {
    const upReq = http.request({
      hostname: UP_URL.hostname,
      port: UP_URL.port,
      path: u.pathname + u.search,
      method: req.method || "GET",
      headers,
    }, (upRes) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (k === "transfer-encoding" || k === "connection") continue;
        outHeaders[k] = v;
      }
      res.writeHead(upRes.statusCode || 200, outHeaders);
      upRes.pipe(res);
    });

    upReq.on("error", (e) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e || "upstream offline") }));
      }
    });

    req.on("close", () => {
      upReq.destroy();
    });

    if (raw && req.method !== "GET" && req.method !== "HEAD") {
      upReq.write(raw);
    }
    upReq.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e || "upstream error") }));
  }
}

async function onRequest(req, res) {
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    // Minimal unauthenticated health check endpoint
    if (u.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return void res.end(req.method === "HEAD" ? "" : JSON.stringify({
        ok: true,
        status: "healthy",
        service: "grok-d-gateway-shim",
        contract: 2,
      }));
    }

    const inboundAuth = String(req.headers.authorization || "");

    if (u.pathname === "/install/openburnbar" && (req.method === "GET" || req.method === "HEAD")) {
      let payload = { npmProxy: false };
      try { payload = require("./openburnbar-install").info(); } catch (_) {}
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return void res.end(req.method === "HEAD" ? "" : JSON.stringify(payload));
    }

    const raw = await readBody(req);
    const m = /^\/api\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "POST") {
      let rawMethod = m[1];
      try { rawMethod = decodeURIComponent(rawMethod); } catch (_) {
        res.writeHead(400, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ ok: false, error: "invalid-route" }));
      }
      if (!ALLOWED_API_METHODS.has(rawMethod)) {
        res.writeHead(404, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ ok: false, error: "method-not-found" }));
      }
      const method = rawMethod;
      if (!authorizationMatches(inboundAuth, u.pathname, method)) {
        res.writeHead(401, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      }
      const body = parseJson(raw);
      const out = (method === "sendPrompt" || method === "broadcastToAgents")
        ? await handleSpecial(method, raw, body, { auth: inboundAuth })
        : await postApi(method, raw);
      res.writeHead(out.status || 502, { "content-type": out.type || "application/json" });
      return void res.end(out.text != null ? out.text : JSON.stringify({ error: "upstream" }));
    }
    if (!authorizationMatches(inboundAuth, u.pathname, "")) {
      res.writeHead(401, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
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
  agentDbPath, getLocalAgents, readEntries, sqliteRead, transcriptHas, waitUntilIdle, waitTranscripts,
  broadcastMessage, postApi, handleSpecial, onRequest, start, offlineFallback,
  createLocalAgent, deleteLocalAgents, authorizationMatches, resolveUp, allowedAuthHeaders,
};
