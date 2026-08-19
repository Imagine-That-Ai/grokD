#!/usr/bin/env node
// Stop / resume Grok bots: park automations, interrupt running turns.
// Local files + official computers. Does not kill Grok Bot B.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const HACK = process.env.GROKBOT_HACK || path.join(ROOT, "hack");
const TMP_HACK = "/tmp/grokbot-hack";
const SEAT4 = process.env.GROK_SEAT4 || path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
const STATE = path.join(ROOT, "runtime", "paused.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function defaultState() {
  return { at: 0, seats: {} };
}

function migrateState(s) {
  if (s && s.seats && typeof s.seats === "object") return Object.assign(defaultState(), s);
  if (s && s.paused === true) {
    return {
      at: s.at || Date.now(),
      seats: {
        "local-d": { at: s.at || Date.now(), local: s.local || [], remote: [] },
        all: { at: s.at || Date.now(), local: [], remote: s.remote || [] },
      },
    };
  }
  return defaultState();
}

function loadState() {
  return migrateState(readJson(STATE, null));
}

function saveState(s) {
  writeJson(STATE, s);
  try { writeJson(path.join(TMP_HACK, "paused.json"), s); } catch {}
}

function pausedSeats() {
  return Object.keys(loadState().seats || {});
}

function isPaused(id) {
  const seats = loadState().seats || {};
  if (id) return !!seats[id];
  return Object.keys(seats).length > 0;
}

function pausedAt(id) {
  if (!id) return null;
  const row = (loadState().seats || {})[id];
  const t = row && Number(row.at);
  return Number.isFinite(t) && t > 0 ? t : null;
}

function shouldFireAutomation() {
  return !isPaused("local-d");
}

function activeProfileId() {
  try {
    const env = readJson(path.join(ROOT, "active-env.json"), {});
    if (env && env.profileId) return String(env.profileId);
  } catch {}
  return "";
}

function agentRoots() {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p) || !fs.existsSync(p)) return;
    seen.add(p);
    out.push(p);
  };
  add(path.join(HACK, "box-data", "agents"));
  add(path.join(TMP_HACK, "box-data", "agents"));
  add(path.join(ROOT, "profile-data", "local-d", "box-data", "agents"));
  return out;
}

function listLocalAutos() {
  const found = [];
  for (const root of agentRoots()) {
    let agents = [];
    try { agents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const ent of agents) {
      if (!ent.isDirectory()) continue;
      const autoRoot = path.join(root, ent.name, "automations");
      let folders = [];
      try { folders = fs.readdirSync(autoRoot, { withFileTypes: true }); } catch { continue; }
      for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        const file = path.join(autoRoot, folder.name, "automation.json");
        const cfg = readJson(file, null);
        if (!cfg || typeof cfg !== "object") continue;
        found.push({ file, root, agentId: ent.name, folder: folder.name, cfg });
      }
    }
  }
  return found;
}

function autoOn(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  if (cfg.enabled === false || cfg.isEnabled === false) return false;
  if (cfg.enabled === true || cfg.isEnabled === true) return true;
  return cfg.enabled == null && cfg.isEnabled == null ? true : !!cfg.enabled;
}

function setLocalEnabled(file, cfg, on) {
  const next = Object.assign({}, cfg, { enabled: on, isEnabled: on });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
}

function pauseLocal() {
  const saved = [];
  let localDisabled = 0;
  for (const row of listLocalAutos()) {
    if (!autoOn(row.cfg)) continue;
    setLocalEnabled(row.file, row.cfg, false);
    localDisabled += 1;
    saved.push({
      file: row.file,
      agentId: row.agentId,
      folder: row.folder,
      name: row.cfg.name || row.folder,
    });
  }
  return { localDisabled, saved };
}

function resumeLocal(saved) {
  let n = 0;
  for (const row of saved || []) {
    if (!row.file || !fs.existsSync(row.file)) continue;
    const cfg = readJson(row.file, {});
    setLocalEnabled(row.file, cfg, true);
    n += 1;
  }
  return n;
}

function discoverComputers() {
  const out = [];
  const seen = new Set();
  const addFile = (tag, file) => {
    const j = readJson(file, null);
    if (!j || typeof j.baseUrl !== "string") return;
    if (/127\.0\.0\.1|localhost/.test(j.baseUrl)) return;
    const key = j.baseUrl.replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      tag,
      baseUrl: key,
      token: j.token || "",
      headers: j.headers && typeof j.headers === "object" ? j.headers : {},
    });
  };
  addFile("seat4", path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json"));
  const data = path.join(ROOT, "profile-data");
  let dirs = [];
  try { dirs = fs.readdirSync(data); } catch { dirs = []; }
  for (const id of dirs) {
    addFile(id, path.join(data, id, "sand-data", "local-exec-daemon-connection.json"));
  }
  return out;
}

function postComputer(conn, method, body) {
  return new Promise((resolve, reject) => {
    if (!conn || !conn.baseUrl) return reject(new Error("no computer"));
    const u = new URL(conn.baseUrl.replace(/\/$/, "") + "/api/" + method);
    const payload = Buffer.from(JSON.stringify(body || {}));
    const lib = u.protocol === "https:" ? https : http;
    const headers = Object.assign({
      "content-type": "application/json",
      accept: "application/json",
      "content-length": payload.length,
    }, conn.headers || {});
    if (conn.token) headers.authorization = "Bearer " + conn.token;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname,
      method: "POST",
      headers,
      rejectUnauthorized: false,
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error((json && json.error) || text.slice(0, 180) || String(res.statusCode)));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

async function pauseRemote(computers, post) {
  const fn = post || postComputer;
  const remote = [];
  let interrupted = 0;
  let disabled = 0;
  for (const conn of computers || []) {
    let agents = [];
    try { agents = await fn(conn, "listAgents", {}); }
    catch { continue; }
    if (!Array.isArray(agents)) continue;
    for (const a of agents) {
      if (!a || !a.id) continue;
      const busy = !!(a.isRunning || a.isComposingMessage || a.isRunningTurn);
      if (busy) {
        let cut = false;
        for (let i = 0; i < 2 && !cut; i++) {
          try {
            const r = await fn(conn, "interruptAgentRun", { id: a.id });
            cut = !r || r.hadActiveRun !== false;
            interrupted += 1;
          } catch {}
        }
      }
      let autos = [];
      try { autos = await fn(conn, "getAgentAutomations", { id: a.id }); }
      catch { autos = []; }
      if (!Array.isArray(autos)) continue;
      for (const auto of autos) {
        if (!auto || !auto.id) continue;
        if (auto.isEnabled === false || auto.enabled === false) continue;
        try {
          await fn(conn, "setAgentAutomationEnabled", {
            id: a.id,
            automationId: auto.id,
            isEnabled: false,
          });
          disabled += 1;
          remote.push({
            tag: conn.tag,
            agentId: a.id,
            automationId: auto.id,
            name: auto.name || auto.id,
          });
        } catch {}
      }
    }
  }
  return { interrupted, disabled, remote };
}

async function resumeRemote(saved, computers, post) {
  const fn = post || postComputer;
  const byTag = new Map((computers || []).map((c) => [c.tag, c]));
  let n = 0;
  for (const row of saved || []) {
    const conn = byTag.get(row.tag);
    if (!conn) continue;
    try {
      await fn(conn, "setAgentAutomationEnabled", {
        id: row.agentId,
        automationId: row.automationId,
        isEnabled: true,
      });
      n += 1;
    } catch {}
  }
  return n;
}

function computersForSeats(want, provided) {
  const ids = new Set(want);
  const list = provided !== undefined ? provided : discoverComputers();
  const active = activeProfileId();
  const out = [];
  for (const c of list || []) {
    const tag = c.tag === "seat4" && active ? active : c.tag;
    if (ids.has(tag)) out.push(Object.assign({}, c, { tag }));
  }
  return out;
}

function resolveSeats(opts) {
  const raw = opts && opts.seats;
  if (Array.isArray(raw) && raw.length) return raw.map(String);
  const found = ["local-d"];
  for (const c of (opts && opts.computers) || discoverComputers()) {
    const tag = c.tag === "seat4" ? (activeProfileId() || "seat4") : c.tag;
    if (tag && !found.includes(tag)) found.push(tag);
  }
  return found;
}

async function pause(opts) {
  opts = opts || {};
  const seats = resolveSeats(opts);
  const cur = loadState();
  const pending = seats.filter((id) => !cur.seats[id]);
  if (!pending.length) {
    return { paused: true, already: true, seats: pausedSeats() };
  }
  let local = { localDisabled: 0, saved: [] };
  if (pending.includes("local-d")) local = pauseLocal();
  const now = Date.now();
  const next = loadState();
  for (const id of pending) {
    next.seats[id] = {
      at: now,
      local: id === "local-d" ? local.saved : [],
      remote: [],
    };
  }
  next.at = now;
  saveState(next);

  const computers = computersForSeats(pending.filter((id) => id !== "local-d"), opts.computers);
  const finish = async () => {
    const remote = await pauseRemote(computers, opts.post);
    const s = loadState();
    for (const id of pending) {
      if (!s.seats[id]) continue;
      s.seats[id].remote = remote.remote.filter((r) => r.tag === id);
    }
    saveState(s);
    return remote;
  };

  if (opts.waitRemote === false) {
    finish().catch(() => {});
    return {
      paused: true,
      already: false,
      seats: pending,
      localDisabled: local.localDisabled,
      saved: local.saved,
      pendingRemote: true,
      computers: computers.length,
    };
  }

  const remote = await finish();
  return {
    paused: true,
    already: false,
    seats: pending,
    localDisabled: local.localDisabled,
    saved: local.saved,
    interrupted: remote.interrupted,
    remoteDisabled: remote.disabled,
    computers: computers.length,
  };
}

async function resume(opts) {
  opts = opts || {};
  const cur = loadState();
  const seats = (opts.seats && opts.seats.length) ? opts.seats.map(String) : Object.keys(cur.seats);
  const have = seats.filter((id) => cur.seats[id]);
  if (!have.length) return { paused: isPaused(), already: true, seats: pausedSeats() };
  let localN = 0;
  let remoteN = 0;
  const computers = computersForSeats(have.filter((id) => id !== "local-d"), opts.computers);
  for (const id of have) {
    const saved = cur.seats[id] || {};
    if (id === "local-d") localN += resumeLocal(saved.local);
    remoteN += await resumeRemote(saved.remote, computers, opts.post);
    delete cur.seats[id];
  }
  cur.at = Date.now();
  saveState(cur);
  return {
    paused: isPaused(),
    already: false,
    seats: have,
    localEnabled: localN,
    remoteEnabled: remoteN,
  };
}

async function setSeatPaused(id, want, opts) {
  const o = Object.assign({}, opts || {}, { seats: [id] });
  return want ? pause(o) : resume(o);
}

function status() {
  const s = loadState();
  const seats = {};
  for (const [id, row] of Object.entries(s.seats || {})) {
    seats[id] = {
      at: row.at || 0,
      local: (row.local || []).length,
      remote: (row.remote || []).length,
    };
  }
  return { paused: Object.keys(seats).length > 0, seats };
}

module.exports = {
  ROOT, STATE,
  isPaused, pausedAt, pausedSeats, shouldFireAutomation, loadState, saveState,
  pause, resume, setSeatPaused, status,
  discoverComputers, postComputer, computersForSeats,
  pauseLocal, resumeLocal, listLocalAutos, autoOn,
};

if (require.main === module) {
  const cmd = process.argv[2] || "status";
  const seats = process.argv.slice(3).filter((a) => !a.startsWith("-"));
  (async () => {
    if (cmd === "pause" || cmd === "stop") {
      console.log(JSON.stringify(await pause(seats.length ? { seats } : {}), null, 2));
    } else if (cmd === "resume" || cmd === "start") {
      console.log(JSON.stringify(await resume(seats.length ? { seats } : {}), null, 2));
    } else if (cmd === "status") {
      console.log(JSON.stringify(status(), null, 2));
    } else {
      console.error("usage: bot-pause.js pause|resume|status [local-d|cursor-a|cursor-b|cursor-c]");
      process.exit(2);
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
