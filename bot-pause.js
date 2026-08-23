// No shebang: Electron's renderer wraps module source in an extra function,
// so a line-1 '#!' is no longer at offset 0 and Node's shebang stripping does
// not apply — require() throws SyntaxError in the app while working under
// plain node. Run this as `node bot-pause.js <cmd>`.
// Stop / resume Grok bots: park automations, interrupt running turns.
// Local files + official computers. Does not kill Grok Bot B.
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const dns = require("dns");
const secGuard = require("./security-guard");
const paths = require("./paths");

const ROOT = paths.ROOT;
const SEAT4 = paths.SEAT4;
const STATE = path.join(ROOT, "runtime", "paused.json");
const POLICY = path.join(ROOT, "runtime", "pause-policy.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function writeJson(p, obj) {
  secGuard.writeJsonAtomic0600(p, obj);
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
  const lockFile = path.join(ROOT, "runtime", ".paused.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 4000, staleMs: 15000 });
  if (fd === null) {
    throw new Error("Failed to acquire bot pause state lock");
  }
  try {
    writeJson(STATE, s);
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
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
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return;
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) return;
      seen.add(p);
      out.push(p);
    } catch (_) {}
  };
  add(path.join(paths.existingHack(), "box-data", "agents"));
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
        try {
          if (fs.lstatSync(file).isSymbolicLink()) continue;
        } catch (_) { continue; }
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
  secGuard.writeFile0600(file, JSON.stringify(next, null, 2) + "\n");
}

function pauseLocal() {
  const saved = [];
  let localDisabled = 0;
  for (const row of listLocalAutos()) {
    if (!autoOn(row.cfg)) continue;
    try {
      setLocalEnabled(row.file, row.cfg, false);
      localDisabled += 1;
      saved.push({
        file: row.file,
        agentId: row.agentId,
        folder: row.folder,
        name: row.cfg.name || row.folder,
      });
    } catch (e) {
      console.error("[pause] failed to pause local auto:", row.file, e);
    }
  }
  return { localDisabled, saved };
}

function interruptLocal() {
  const http = require("http");
  const payload = Buffer.from("{}");
  const token = secGuard.getGatewayToken();
  const list = () => new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: 1337, path: "/api/listAgents", method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "content-length": payload.length },
      timeout: 3000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { resolve([]); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
  return list().then((agents) => {
    const arr = Array.isArray(agents) ? agents : [];
    return Promise.all(arr.map((a) => {
      if (!a || !a.id) return null;
      if (!(a.isRunning || a.isComposingMessage || a.isRunningTurn)) return null;
      const body = Buffer.from(JSON.stringify({ id: a.id }));
      return new Promise((resolve) => {
        const req = http.request({
          host: "127.0.0.1", port: 1337, path: "/api/interruptAgent", method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "content-length": body.length },
          timeout: 3000,
        }, (res) => { res.resume(); res.on("end", resolve); });
        req.on("error", () => resolve());
        req.on("timeout", () => { req.destroy(); resolve(); });
        req.write(body);
        req.end();
      });
    }));
  }).catch(() => {});
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
    if (!secGuard.isApprovedRemoteComputerDescriptor(j.baseUrl)) return;
    if (j.token && secGuard.isGatewayOrLoopbackMarker(j.token)) return;
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

async function postComputer(conn, method, body) {
  if (!conn || !conn.baseUrl) throw new Error("no computer");
  if (!secGuard.isApprovedRemoteComputerDescriptor(conn.baseUrl)) {
    throw new Error("unapproved remote descriptor domain");
  }
  if (conn.token && secGuard.isGatewayOrLoopbackMarker(conn.token)) {
    throw new Error("gateway master token cannot be sent to remote computer");
  }
  const u = new URL(conn.baseUrl.replace(/\/$/, "") + "/api/" + method);
  if (u.protocol !== "https:") throw new Error("insecure protocol for remote descriptor");
  if (secGuard.isPrivateOrLoopbackIp(u.hostname)) {
    throw new Error("private or loopback IP rejected");
  }
  const cleanHost = String(u.hostname || "").toLowerCase().trim().replace(/\.+$/, "");
  const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
  if (!records || !records.length) throw new Error("DNS resolution failed");
  for (const rec of records) {
    if (secGuard.isPrivateOrLoopbackIp(rec.address)) {
      throw new Error("DNS record resolved to private or loopback IP");
    }
  }
  const pinnedIp = records[0].address;
  const payload = Buffer.from(JSON.stringify(body || {}));
  const headers = {
    host: u.host,
    "content-type": "application/json",
    accept: "application/json",
    "content-length": payload.length,
  };
  if (conn.token) headers.authorization = "Bearer " + String(conn.token).replace(/[\r\n]/g, "");

  return new Promise((resolve, reject) => {
    const MAX_RESP = 1024 * 1024;
    let size = 0;
    const req = https.request({
      protocol: u.protocol,
      host: pinnedIp,
      servername: u.hostname,
      port: u.port || 443,
      path: u.pathname,
      method: "POST",
      headers,
      rejectUnauthorized: true,
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_RESP) {
          req.destroy();
          reject(new Error("Response too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (size > MAX_RESP) return;
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

let _pauseGeneration = 0;

async function pauseRemote(computers, post) {
  const fn = post || postComputer;
  const remote = [];
  let interrupted = 0;
  let disabled = 0;
  let errors = [];
  const cappedComputers = (computers || []).slice(0, 10);
  const deadline = Date.now() + 15000;
  for (const conn of cappedComputers) {
    if (Date.now() > deadline) {
      errors.push({ tag: conn.tag, op: "pauseRemote", error: "aggregate deadline exceeded" });
      break;
    }
    let agents = [];
    try { agents = await fn(conn, "listAgents", {}); }
    catch (e) {
      errors.push({ tag: conn.tag, op: "listAgents", error: String(e && e.message || e) });
      continue;
    }
    if (!Array.isArray(agents)) continue;
    const cappedAgents = agents.slice(0, 50);
    for (const a of cappedAgents) {
      if (Date.now() > deadline) {
        errors.push({ tag: conn.tag, agentId: a.id, op: "pauseRemote", error: "aggregate deadline exceeded" });
        break;
      }
      if (!a || !a.id) continue;
      const busy = !!(a.isRunning || a.isComposingMessage || a.isRunningTurn);
      if (busy) {
        let cut = false;
        for (let i = 0; i < 2 && !cut; i++) {
          try {
            const r = await fn(conn, "interruptAgentRun", { id: a.id });
            cut = !r || r.hadActiveRun !== false;
            interrupted += 1;
          } catch (e) {
            errors.push({ tag: conn.tag, agentId: a.id, op: "interrupt", error: String(e && e.message || e) });
          }
        }
      }
      let autos = [];
      try { autos = await fn(conn, "getAgentAutomations", { id: a.id }); }
      catch (e) {
        errors.push({ tag: conn.tag, agentId: a.id, op: "getAgentAutomations", error: String(e && e.message || e) });
        autos = [];
      }
      if (!Array.isArray(autos)) continue;
      const cappedAutos = autos.slice(0, 50);
      for (const auto of cappedAutos) {
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
        } catch (e) {
          errors.push({ tag: conn.tag, agentId: a.id, automationId: auto.id, op: "disable", error: String(e && e.message || e) });
        }
      }
    }
  }
  return { interrupted, disabled, remote, errors };
}

async function resumeRemote(saved, computers, post) {
  const fn = post || postComputer;
  const byTag = new Map((computers || []).map((c) => [c.tag, c]));
  let n = 0;
  const restoredIds = new Set();
  for (const row of saved || []) {
    // Finding 33: Only send to the matching computer connection for this tag
    const conn = byTag.get(row.tag);
    if (!conn) continue;
    try {
      await fn(conn, "setAgentAutomationEnabled", {
        id: row.agentId,
        automationId: row.automationId,
        isEnabled: true,
      });
      n += 1;
      restoredIds.add(`${row.tag}|${row.agentId}|${row.automationId}`);
    } catch {}
  }
  return { count: n, restoredIds };
}

function computersForSeats(want, provided) {
  const ids = new Set(want);
  const list = provided !== undefined ? provided : discoverComputers();
  const active = activeProfileId();
  const out = [];
  for (const c of list || []) {
    const tag = c.tag === "seat4" && active ? active : c.tag;
    if (ids.has(tag) || ids.has("all")) out.push(Object.assign({}, c, { tag }));
  }
  return out;
}

function resolveSeats(opts) {
  const raw = opts && opts.seats;
  const discovered = ["local-d"];
  for (const c of (opts && opts.computers) || discoverComputers()) {
    const tag = c.tag === "seat4" ? (activeProfileId() || "seat4") : c.tag;
    if (tag && !discovered.includes(tag)) discovered.push(tag);
  }
  if (Array.isArray(raw) && raw.length) {
    const out = [];
    for (const s of raw) {
      const str = String(s);
      if (str === "all") {
        for (const d of discovered) {
          if (!out.includes(d)) out.push(d);
        }
      } else if (!out.includes(str)) {
        out.push(str);
      }
    }
    return out.length ? out : discovered;
  }
  return discovered;
}

const _activePausePromises = new Map();
let _pauseMutex = Promise.resolve();

async function withPauseLock(fn) {
  const prev = _pauseMutex;
  let release;
  _pauseMutex = new Promise((resolve) => { release = resolve; });
  await prev.catch(() => {});
  const lockPath = path.join(ROOT, ".pause.lock");
  const fd = secGuard.acquireFileLock(lockPath, { waitMs: 8000, staleMs: 25000 });
  if (fd === null) {
    release();
    throw new Error("Failed to acquire .pause.lock: another pause/resume operation is in progress");
  }
  try {
    return await fn();
  } finally {
    secGuard.releaseFileLock(lockPath, fd);
    release();
  }
}

async function pause(opts) {
  return withPauseLock(async () => {
    opts = opts || {};
    const seats = resolveSeats(opts);
    const cur = loadState();
    const pending = seats.filter((id) => !cur.seats[id]);
    if (!pending.length) {
      return { paused: true, already: true, seats: pausedSeats() };
    }
    let local = { localDisabled: 0, saved: [] };
    let localErrors = [];
    if (pending.includes("local-d")) {
      try {
        local = pauseLocal();
      } catch (e) {
        localErrors.push({ tag: "local-d", op: "pauseLocal", error: String(e && e.message || e) });
      }
      try {
        await interruptLocal();
      } catch (e) {
        localErrors.push({ tag: "local-d", op: "interruptLocal", error: String(e && e.message || e) });
      }
    }
    const now = Date.now();
    const next = loadState();
    const currentGen = `${now}-${crypto.randomUUID()}`;
    for (const id of pending) {
      next.seats[id] = {
        at: now,
        local: id === "local-d" ? local.saved : [],
        remote: [],
        gen: currentGen,
        inFlight: true,
      };
    }
    next.at = now;
    saveState(next);

    const computers = computersForSeats(pending.filter((id) => id !== "local-d"), opts.computers);
    const finish = async () => {
      const remote = await pauseRemote(computers, opts.post);
      await withPauseLock(async () => {
        const s = loadState();
        for (const id of pending) {
          if (!s.seats[id] || s.seats[id].gen !== currentGen) {
            const disabledRows = remote.remote.filter((r) => r.tag === id);
            if (disabledRows.length) {
              const currentS = loadState();
              if (!currentS.seats[id] || currentS.seats[id].gen === currentGen) {
                resumeRemote(disabledRows, computers, opts.post).catch(() => {});
              }
            }
            continue;
          }
          s.seats[id].remote = remote.remote.filter((r) => r.tag === id);
          delete s.seats[id].inFlight;
        }
        saveState(s);
      });
      return remote;
    };

    const p = finish();
    for (const id of pending) {
      _activePausePromises.set(id, p);
    }

    if (opts.waitRemote === false) {
      p.catch(() => {});
      return {
        paused: localErrors.length === 0,
        already: false,
        seats: pending,
        localDisabled: local.localDisabled,
        saved: local.saved,
        pendingRemote: true,
        computers: computers.length,
        errors: localErrors,
      };
    }

    const remote = await p;
    const allErrors = [...localErrors, ...remote.errors];
    return {
      paused: allErrors.length === 0,
      already: false,
      seats: pending,
      localDisabled: local.localDisabled,
      saved: local.saved,
      interrupted: remote.interrupted,
      remoteDisabled: remote.disabled,
      remoteErrors: remote.errors,
      errors: allErrors,
      computers: computers.length,
    };
  });
}

async function resume(opts) {
  return withPauseLock(async () => {
    opts = opts || {};
    _pauseGeneration++;
    const cur = loadState();
    const rawSeats = (opts.seats && opts.seats.length) ? opts.seats.map(String) : Object.keys(cur.seats);
    const seats = rawSeats.includes("all") ? Object.keys(cur.seats) : rawSeats;
    const have = seats.filter((id) => cur.seats[id]);
    if (!have.length) return { paused: isPaused(), already: true, seats: pausedSeats() };

    // Wait for any in-flight pause on these seats
    for (const id of have) {
      if (_activePausePromises.has(id)) {
        try { await _activePausePromises.get(id); } catch {}
        _activePausePromises.delete(id);
      }
    }

    const freshState = loadState();
    let localN = 0;
    let remoteN = 0;
    const computers = computersForSeats(have.filter((id) => id !== "local-d"), opts.computers);
    for (const id of have) {
      const saved = freshState.seats[id] || {};
      if (id === "local-d") localN += resumeLocal(saved.local);
      const res = await resumeRemote(saved.remote, computers, opts.post);
      remoteN += res.count;
      if (saved.remote && saved.remote.length > 0) {
        saved.remote = saved.remote.filter((r) => !res.restoredIds.has(`${r.tag}|${r.agentId}|${r.automationId}`));
      }
      if (!saved.remote || saved.remote.length === 0) {
        delete freshState.seats[id];
      }
    }
    freshState.at = Date.now();
    saveState(freshState);
    return {
      paused: isPaused(),
      already: false,
      seats: have,
      localEnabled: localN,
      localRestored: localN,
      remoteRestored: remoteN,
      remoteEnabled: remoteN,
      computers: computers.length,
    };
  });
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

// A stop should outlive a restart — that is the whole point of stopping a bot
// that bills by the week. Persistence is therefore the default and lives in
// paused.json. resumeOnStart is the opt-out for anyone who wants a stop to last
// only for the current run of the app.
function getPolicy() {
  const raw = readJson(POLICY, null);
  return { resumeOnStart: !!(raw && raw.resumeOnStart) };
}

function setPolicy(patch) {
  const next = Object.assign(getPolicy(), patch || {});
  writeJson(POLICY, next);
  return next;
}

// Called once when the app boots. Default policy does nothing at all, so a
// paused seat stays paused.
async function applyStartupPolicy() {
  const pol = getPolicy();
  const st = status();
  if (!pol.resumeOnStart) {
    return { policy: pol, action: "kept", paused: !!st.paused };
  }
  if (!st.paused) return { policy: pol, action: "none", paused: false };
  const out = await resume({});
  return { policy: pol, action: "resumed", result: out };
}

module.exports = {
  getPolicy,
  setPolicy,
  applyStartupPolicy,
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
      console.log(JSON.stringify(Object.assign({ policy: getPolicy() }, status()), null, 2));
    } else if (cmd === "policy") {
      const key = process.argv[3];
      if (!key) console.log(JSON.stringify(getPolicy(), null, 2));
      else if (key === "resume-on-start") {
        const v = String(process.argv[4] || "").toLowerCase();
        if (v !== "on" && v !== "off") { console.error("usage: policy resume-on-start on|off"); process.exit(2); }
        console.log(JSON.stringify(setPolicy({ resumeOnStart: v === "on" }), null, 2));
      } else { console.error("unknown policy key: " + key); process.exit(2); }
    } else {
      console.error("usage: bot-pause.js pause|resume|status|policy [seat...]");
      process.exit(2);
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
