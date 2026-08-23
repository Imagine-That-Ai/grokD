// Durable Grok D profiles: local box vs Cursor identities.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const secGuard = require("./security-guard");

function getRoot() { return process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d"); }
function getStore() { return path.join(getRoot(), "profiles.json"); }
function getData() { return path.join(getRoot(), "profile-data"); }

const SEATS = {
  A: path.join(os.homedir(), "Library/Application Support/Grok Bot"),
  B: path.join(os.homedir(), "Library/Application Support/GrokBotB"),
  C: path.join(os.homedir(), "Library/Application Support/GrokBotC"),
};

// Official Grok B / C stay on the Mac. D no longer imports or lists them.
const RETIRED_IDS = ["cursor-b", "cursor-c"];
const DETECT_SEATS = ["A"];
const RETIRED_SEATS = ["B", "C"];

function validateProfileId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`invalid profile id: ${id}`);
  }
  return id;
}

function assertSeatAllowed(seat) {
  if (!seat) return;
  const s = String(seat).toUpperCase();
  if (RETIRED_SEATS.indexOf(s) >= 0) throw new Error("retired seat " + s);
}

function ensureDirs() {
  secGuard.ensureDir0700(getRoot());
  secGuard.ensureDir0700(getData());
}

function detectedCursorProfiles() {
  const colors = { A: "#f4f4f5" };
  const out = [];
  for (const seat of DETECT_SEATS) {
    const dir = SEATS[seat];
    if (!dir || !fs.existsSync(path.join(dir, "sand-secrets.json"))) continue;
    out.push({
      id: `cursor-${seat.toLowerCase()}`,
      name: `Grok ${seat}`,
      kind: "cursor",
      color: colors[seat] || "#f4f4f5",
      seat,
      sourceUserData: dir,
      identitySource: dir,
      createdAt: Date.now(),
    });
  }
  return out;
}

function pruneRetired(s) {
  const drop = new Set(RETIRED_IDS);
  let changed = false;
  const kept = (s.profiles || []).filter((p) => p && !drop.has(p.id));
  if (kept.length !== (s.profiles || []).length) {
    s.profiles = kept;
    changed = true;
  }
  if (drop.has(s.activeId)) {
    s.activeId = kept.some((p) => p.id === "cursor-a") ? "cursor-a"
      : ((kept[0] && kept[0].id) || "local-d");
    changed = true;
  }
  return changed;
}

function forgetRetiredData() {
  const dataPath = getData();
  for (const id of RETIRED_IDS) {
    try { fs.rmSync(path.join(dataPath, id), { recursive: true, force: true }); } catch {}
  }
}

function defaultState() {
  return {
    version: 1,
    activeId: "local-d",
    profiles: [
      {
        id: "local-d",
        name: "Local D",
        kind: "local",
        color: "#c4b5fd",
        createdAt: Date.now(),
        desiredBots: null,
      },
      ...detectedCursorProfiles(),
    ],
  };
}

function load() {
  ensureDirs();
  const storePath = getStore();
  if (!fs.existsSync(storePath)) {
    return withProfileLock(() => {
      if (fs.existsSync(storePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(storePath, "utf8"));
          if (existing && Array.isArray(existing.profiles) && existing.profiles.length) return existing;
        } catch (_) {}
      }
      const s = defaultState();
      rawSave(s);
      return s;
    });
  }
  let s = null;
  try {
    s = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch (err) {
    return withProfileLock(() => {
      try {
        const existing = JSON.parse(fs.readFileSync(storePath, "utf8"));
        if (existing && Array.isArray(existing.profiles) && existing.profiles.length) return existing;
      } catch (_) {}
      try {
        const backupPath = `${storePath}.corrupted-${Date.now()}`;
        fs.copyFileSync(storePath, backupPath);
      } catch (_) {}
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[profile-store] Corrupted profiles.json: " + (err.message || err) + "\n"); } catch (_) {}
      const def = defaultState();
      rawSave(def);
      return def;
    });
  }
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) {
    return withProfileLock(() => {
      try {
        const existing = JSON.parse(fs.readFileSync(storePath, "utf8"));
        if (existing && Array.isArray(existing.profiles) && existing.profiles.length) return existing;
      } catch (_) {}
      const def = defaultState();
      rawSave(def);
      return def;
    });
  }
  if (pruneRetired(s)) {
    withProfileLock(() => {
      try {
        const fresh = JSON.parse(fs.readFileSync(storePath, "utf8"));
        if (pruneRetired(fresh)) {
          if (!fresh.profiles.some((p) => p.id === fresh.activeId)) fresh.activeId = fresh.profiles[0].id;
          rawSave(fresh);
        }
      } catch (_) {}
      forgetRetiredData();
    });
  }
  if (!s.profiles.some((p) => p.id === s.activeId)) s.activeId = s.profiles[0].id;
  return s;
}

const _activeProfileLocks = new Map();

function withProfileLock(fn) {
  const lockPath = path.resolve(getRoot(), ".profiles.lock");
  let entry = _activeProfileLocks.get(lockPath);
  if (entry && entry.depth > 0) {
    entry.depth++;
    try {
      return fn();
    } finally {
      entry.depth--;
      if (entry.depth === 0) {
        _activeProfileLocks.delete(lockPath);
        secGuard.releaseFileLock(lockPath, entry.fd);
      }
    }
  }
  const fd = secGuard.acquireFileLock(lockPath, { waitMs: 5000, staleMs: 15000 });
  if (fd === null) throw new Error("failed to acquire profiles lock");
  entry = { depth: 1, fd };
  _activeProfileLocks.set(lockPath, entry);
  try {
    return fn();
  } finally {
    entry.depth--;
    if (entry.depth === 0) {
      _activeProfileLocks.delete(lockPath);
      secGuard.releaseFileLock(lockPath, entry.fd);
    }
  }
}

function rawSave(state) {
  ensureDirs();
  const storePath = getStore();
  const tmp = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  secGuard.writeFile0600(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, storePath);
}

function save(state) {
  return withProfileLock(() => {
    rawSave(state);
  });
}

function list() {
  return load().profiles;
}

function get(id) {
  return load().profiles.find((p) => p.id === id) || null;
}

function getActive() {
  const s = load();
  return s.profiles.find((p) => p.id === s.activeId) || s.profiles[0];
}

function setActive(id) {
  return withProfileLock(() => {
    const s = load();
    if (!s.profiles.some((p) => p.id === id)) throw new Error(`unknown profile ${id}`);
    s.activeId = id;
    rawSave(s);
    return s.profiles.find((p) => p.id === id);
  });
}

function profileDataDir(id) {
  const cleanId = validateProfileId(id);
  const dataPath = getData();
  const resolvedData = path.resolve(dataPath);
  secGuard.ensureDir0700(resolvedData);
  const stData = fs.lstatSync(resolvedData);
  if (stData.isSymbolicLink() || !stData.isDirectory()) {
    throw new Error(`profile-data root is not a normal directory: ${resolvedData}`);
  }
  const realData = fs.realpathSync(resolvedData);
  const dir = path.resolve(resolvedData, cleanId);
  if (!dir.startsWith(realData + path.sep)) {
    throw new Error(`path traversal detected in profile id: ${id}`);
  }
  if (fs.existsSync(dir)) {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(`profile storage is a symlink or not a directory: ${dir}`);
    }
    const realDir = fs.realpathSync(dir);
    if (!realDir.startsWith(realData + path.sep)) {
      throw new Error(`symlink escape detected in profile dir: ${dir}`);
    }
  }
  secGuard.ensureDir0700(dir);
  const realDir = fs.realpathSync(dir);
  for (const sub of ["persistence", "box-data", path.join("box-data", "agents"), "secrets"]) {
    const subTarget = path.join(dir, sub);
    if (fs.existsSync(subTarget)) {
      const stSub = fs.lstatSync(subTarget);
      if (stSub.isSymbolicLink() || !stSub.isDirectory()) {
        throw new Error(`nested profile storage is a symlink or not a directory: ${subTarget}`);
      }
      const realSub = fs.realpathSync(subTarget);
      if (!realSub.startsWith(realDir + path.sep)) {
        throw new Error(`nested symlink escape detected in profile sub: ${subTarget}`);
      }
    }
    secGuard.ensureDir0700(subTarget);
  }
  return dir;
}

function sanitizeProfileName(name, fallback) {
  const s = String(name || "").replace(/[<>"'&`]/g, "").trim().slice(0, 60);
  return s || fallback;
}

function sanitizeProfileColor(color, fallback) {
  const s = String(color || "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+\s*)?\)$/.test(s)) {
    return s;
  }
  return fallback;
}

function add(opts) {
  if (!opts || typeof opts !== "object") throw new Error("invalid profile options");
  const rawId = String(opts.id || `p-${crypto.randomBytes(4).toString("hex")}`);
  const id = validateProfileId(rawId);
  if (RETIRED_IDS.includes(id)) throw new Error(`retired profile ${id}`);
  assertSeatAllowed(opts.fromSeat);
  assertSeatAllowed(opts.identitySeat);
  const dir = profileDataDir(id);

  return withProfileLock(() => {
    const s = load();
    if (s.profiles.some((p) => p.id === id)) throw new Error(`profile exists ${id}`);
    const kind = opts.kind === "cursor" ? "cursor" : "local";
    let sourceUserData = opts.sourceUserData || null;
    let identitySource = opts.identitySource || sourceUserData || null;
    if (opts.fromSeat && SEATS[opts.fromSeat]) {
      sourceUserData = SEATS[opts.fromSeat];
      identitySource = opts.identitySeat && SEATS[opts.identitySeat] ? SEATS[opts.identitySeat] : sourceUserData;
    }
    const defaultName = kind === "cursor" ? "Cursor" : "Local";
    const defaultColor = kind === "cursor" ? "#38bdf8" : "#c4b5fd";
    const profile = {
      id,
      name: sanitizeProfileName(opts.name, defaultName),
      kind,
      color: sanitizeProfileColor(opts.color, defaultColor),
      seat: opts.fromSeat || opts.seat || null,
      sourceUserData,
      identitySource,
      rosterSources: Array.isArray(opts.rosterSources) ? opts.rosterSources : (sourceUserData ? [sourceUserData] : []),
      desiredBots: Number.isFinite(opts.desiredBots) ? opts.desiredBots : null,
      createdAt: Date.now(),
    };
    if (kind === "local") {
      try {
        const box = require("./box-state");
        const localD = profileDataDir("local-d");
        const cred = box.findLocalCredential([localD]);
        if (cred) {
          box.copyFile(cred, box.credentialPath(dir));
          const conn = path.join(localD, "sand-data", "local-exec-daemon-connection.json");
          if (require("fs").existsSync(conn)) {
            box.copyFile(conn, path.join(dir, "sand-data", "local-exec-daemon-connection.json"));
          }
        }
      } catch {}
    }
    s.profiles.push(profile);
    rawSave(s);
    return profile;
  });
}

function importDetected(id) {
  if (RETIRED_IDS.includes(id)) throw new Error(`unknown import ${id}`);
  const existing = get(id);
  if (existing) return existing;
  const found = detectedCursorProfiles().find((p) => p.id === id);
  if (!found) throw new Error(`unknown import ${id}`);
  return add({
    id: found.id,
    name: found.name,
    kind: "cursor",
    color: found.color,
    seat: found.seat,
    sourceUserData: found.sourceUserData,
    identitySource: found.identitySource,
  });
}

function rename(id, name) {
  return withProfileLock(() => {
    const s = load();
    const p = s.profiles.find((x) => x.id === id);
    if (!p) throw new Error(`unknown profile ${id}`);
    const next = sanitizeProfileName(name, "");
    if (!next) throw new Error("empty name");
    p.name = next;
    rawSave(s);
    return get(id);
  });
}

function remove(id) {
  const cleanId = validateProfileId(id);
  return withProfileLock(() => {
    const s = load();
    if (s.profiles.length <= 1) throw new Error("cannot remove the last profile");
    if (s.activeId === cleanId) throw new Error("cannot remove the active profile");
    if (cleanId === "local-d") throw new Error("cannot remove Local D");
    const exists = s.profiles.some((p) => p.id === cleanId);
    if (!exists) throw new Error(`unknown profile ${cleanId}`);

    const dataPath = getData();
    const resolvedData = path.resolve(dataPath);
    const dir = path.resolve(dataPath, cleanId);
    const quarantineDir = path.join(resolvedData, `.quarantine-${cleanId}-${Date.now()}`);

    let movedToQuarantine = false;
    if (fs.existsSync(dir) && dir.startsWith(resolvedData + path.sep)) {
      try {
        const st = fs.lstatSync(dir);
        if (st.isSymbolicLink()) {
          fs.unlinkSync(dir);
        } else {
          const real = fs.realpathSync(dir);
          const realData = fs.realpathSync(resolvedData);
          if (real.startsWith(realData + path.sep)) {
            fs.renameSync(dir, quarantineDir);
            movedToQuarantine = true;
          }
        }
      } catch (rmErr) {
        throw new Error(`Failed to stage profile directory for deletion: ${rmErr.message || rmErr}`);
      }
    }

    try {
      s.profiles = s.profiles.filter((p) => p.id !== cleanId);
      rawSave(s);
    } catch (saveErr) {
      if (movedToQuarantine) {
        try { fs.renameSync(quarantineDir, dir); } catch (_) {}
      }
      throw saveErr;
    }

    if (movedToQuarantine) {
      try { fs.rmSync(quarantineDir, { recursive: true, force: true }); } catch (_) {}
    }

    try {
      const localMcp = require("./local-mcp");
      localMcp.clearCaches();
    } catch (_) {}

    return true;
  });
}

function writeActiveEnv(profile) {
  const envPath = path.join(getRoot(), "active-env.json");
  const env = profile.kind === "local"
    ? {
      mode: "local",
      profileId: profile.id,
      SAND_HOST_GATEWAY_URL: "http://127.0.0.1:1337",
      SAND_BACKEND_URL: "http://127.0.0.1:8787",
    }
    : { mode: "cursor", profileId: profile.id };
  secGuard.writeFile0600(envPath, JSON.stringify(env, null, 2) + "\n");
  return env;
}

function readActiveEnv() {
  try {
    return JSON.parse(fs.readFileSync(path.join(getRoot(), "active-env.json"), "utf8"));
  } catch {
    return { mode: "local" };
  }
}

module.exports = {
  get ROOT() { return getRoot(); },
  get STORE() { return getStore(); },
  get DATA() { return getData(); },
  getRoot, getStore, getData,
  SEATS, RETIRED_IDS, RETIRED_SEATS, DETECT_SEATS, assertSeatAllowed,
  load, save, list, get, getActive, setActive, add, rename, remove, importDetected,
  profileDataDir, writeActiveEnv, readActiveEnv, defaultState, ensureDirs,
  detectedCursorProfiles, pruneRetired, withProfileLock,
};
