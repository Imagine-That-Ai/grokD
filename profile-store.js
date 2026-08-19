// Durable Grok D profiles: local box vs Cursor identities.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const STORE = path.join(ROOT, "profiles.json");
const DATA = path.join(ROOT, "profile-data");

const SEATS = {
  A: path.join(os.homedir(), "Library/Application Support/Grok Bot"),
  B: path.join(os.homedir(), "Library/Application Support/GrokBotB"),
  C: path.join(os.homedir(), "Library/Application Support/GrokBotC"),
};

function ensureDirs() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
}

function detectedCursorProfiles() {
  const colors = { A: "#f4f4f5", B: "#fb7185", C: "#fb923c" };
  const out = [];
  for (const seat of ["A", "B", "C"]) {
    const dir = SEATS[seat];
    if (!dir || !fs.existsSync(path.join(dir, "sand-secrets.json"))) continue;
    out.push({
      id: `cursor-${seat.toLowerCase()}`,
      name: `Grok ${seat}`,
      kind: "cursor",
      color: colors[seat],
      seat,
      sourceUserData: dir,
      identitySource: dir,
      createdAt: Date.now(),
    });
  }
  return out;
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
  if (!fs.existsSync(STORE)) {
    const s = defaultState();
    save(s);
    return s;
  }
  const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) return defaultState();
  if (!s.profiles.some((p) => p.id === s.activeId)) s.activeId = s.profiles[0].id;
  return s;
}

function save(state) {
  ensureDirs();
  const tmp = STORE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, STORE);
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
  const s = load();
  if (!s.profiles.some((p) => p.id === id)) throw new Error(`unknown profile ${id}`);
  s.activeId = id;
  save(s);
  return get(id);
}

function profileDataDir(id) {
  const dir = path.join(DATA, id);
  fs.mkdirSync(path.join(dir, "persistence"), { recursive: true });
  fs.mkdirSync(path.join(dir, "box-data", "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "secrets"), { recursive: true });
  return dir;
}

function add(opts) {
  const s = load();
  const id = String(opts.id || `p-${crypto.randomBytes(4).toString("hex")}`);
  if (s.profiles.some((p) => p.id === id)) throw new Error(`profile exists ${id}`);
  const kind = opts.kind === "cursor" ? "cursor" : "local";
  let sourceUserData = opts.sourceUserData || null;
  let identitySource = opts.identitySource || sourceUserData || null;
  if (opts.fromSeat && SEATS[opts.fromSeat]) {
    sourceUserData = SEATS[opts.fromSeat];
    identitySource = opts.identitySeat && SEATS[opts.identitySeat] ? SEATS[opts.identitySeat] : sourceUserData;
  }
  // Cursor with no path is a sign-in profile: this app logs in itself.
  const profile = {
    id,
    name: String(opts.name || (kind === "cursor" ? "Cursor" : "Local")).slice(0, 60),
    kind,
    color: opts.color || (kind === "cursor" ? "#38bdf8" : "#c4b5fd"),
    seat: opts.fromSeat || opts.seat || null,
    sourceUserData,
    identitySource,
    rosterSources: Array.isArray(opts.rosterSources) ? opts.rosterSources : (sourceUserData ? [sourceUserData] : []),
    desiredBots: Number.isFinite(opts.desiredBots) ? opts.desiredBots : null,
    createdAt: Date.now(),
  };
  s.profiles.push(profile);
  save(s);
  const dir = profileDataDir(id);
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
  return profile;
}

function importDetected(id) {
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
  const s = load();
  const p = s.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`unknown profile ${id}`);
  const next = String(name || "").trim().slice(0, 60);
  if (!next) throw new Error("empty name");
  p.name = next;
  save(s);
  return get(id);
}

function remove(id) {
  const s = load();
  if (s.profiles.length <= 1) throw new Error("cannot remove the last profile");
  if (s.activeId === id) throw new Error("cannot remove the active profile");
  if (id === "local-d") throw new Error("cannot remove Local D");
  s.profiles = s.profiles.filter((p) => p.id !== id);
  save(s);
  const dir = path.join(DATA, id);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return true;
}

function writeActiveEnv(profile) {
  const envPath = path.join(ROOT, "active-env.json");
  const env = profile.kind === "local"
    ? {
      mode: "local",
      profileId: profile.id,
      SAND_HOST_GATEWAY_URL: "http://127.0.0.1:1337",
      SAND_HOST_GATEWAY_TOKEN: "fake-gateway-token",
      SAND_BACKEND_URL: "http://127.0.0.1:8787",
    }
    : { mode: "cursor", profileId: profile.id };
  fs.writeFileSync(envPath, JSON.stringify(env, null, 2) + "\n");
  return env;
}

function readActiveEnv() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8"));
  } catch {
    return { mode: "local" };
  }
}

module.exports = {
  ROOT, STORE, DATA, SEATS,
  load, save, list, get, getActive, setActive, add, rename, remove, importDetected,
  profileDataDir, writeActiveEnv, readActiveEnv, defaultState, ensureDirs,
  detectedCursorProfiles,
};
