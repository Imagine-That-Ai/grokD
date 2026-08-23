// Cursor included-quota % per seat. Cache + DashboardService/GetSandUsageStatus.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const CACHE = path.join(ROOT, "runtime", "seat-quota.json");
const SEAT4 = process.env.GROK_SEAT4
  || path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
const STORE = path.join(ROOT, "profiles.json");
const ENV = path.join(ROOT, "active-env.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

const secGuard = require("./security-guard");

function writeCache(map) {
  const dir = path.dirname(CACHE);
  secGuard.ensureDir0700(dir);
  const lockFile = path.join(dir, ".seat-quota.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 3000, staleMs: 15000 });
  if (fd === null) {
    return false;
  }
  try {
    secGuard.writeJsonAtomic0600(CACHE, { ts: Date.now(), seats: map || {} });
    return true;
  } catch {
    return false;
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

const EXHAUSTED_AT = 98;

function stampExhausted(prev, next, threshold, now) {
  const n = Object.assign({}, next || {});
  const t = Number(threshold);
  const cut = Number.isFinite(t) ? t : EXHAUSTED_AT;
  const when = Number(now) || Date.now();
  const used = Number(n.percentUsed);
  const resetPast = n.nextResetMs != null && Number(n.nextResetMs) < when;
  const spent = Number.isFinite(used) && used >= cut && !resetPast;
  if (!spent) {
    n.exhaustedAt = null;
    return n;
  }
  const keep = prev && Number(prev.exhaustedAt);
  n.exhaustedAt = Number.isFinite(keep) && keep > 0 ? keep : (Number(n.at) || when);
  return n;
}

function remember(id, incoming, threshold, now) {
  const dir = path.dirname(CACHE);
  secGuard.ensureDir0700(dir);
  const lockFile = path.join(dir, ".seat-quota.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 4000, staleMs: 15000 });
  if (fd === null) {
    throw new Error("Failed to acquire seat-quota lock");
  }
  try {
    const seats = readCache();
    const prev = seats[id];
    const merged = Object.assign({}, incoming || {});
    if (merged.nextResetMs == null && prev && prev.nextResetMs) merged.nextResetMs = prev.nextResetMs;
    seats[id] = stampExhausted(prev, merged, threshold, now);
    secGuard.writeJsonAtomic0600(CACHE, { ts: Date.now(), seats: seats || {} });
    return seats[id];
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

function formatWall(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return null;
  try {
    return new Date(t).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function hoverText(opts) {
  opts = opts || {};
  const q = opts.quota;
  const lines = [];
  if (q && q.percentUsed != null) {
    lines.push(Math.round(Number(q.percentUsed)) + "% included quota used");
    const ran = formatWall(q.exhaustedAt);
    if (ran) lines.push("Ran out  " + ran);
    const back = formatWall(q.nextResetMs);
    if (back) lines.push("Back     " + back);
  } else {
    lines.push("Cursor quota unavailable");
  }
  const stopped = formatWall(opts.stoppedAt);
  if (stopped) lines.push("Stopped  " + stopped);
  return lines.join("\n");
}

function readCache() {
  const j = readJson(CACHE, null);
  return (j && j.seats) || {};
}

function activeProfileId() {
  const env = readJson(ENV, {});
  if (env && env.profileId) return String(env.profileId);
  const s = readJson(STORE, {});
  return String((s && s.activeId) || "");
}

function profiles() {
  try {
    const store = require("./profile-store");
    const list = store.list();
    return list.filter((p) => p && p.id && !store.RETIRED_IDS.includes(p.id));
  } catch {
    const s = readJson(STORE, {});
    return Array.isArray(s.profiles) ? s.profiles.filter((p) => p && p.id && p.id !== "cursor-b" && p.id !== "cursor-c") : [];
  }
}

function isSafeProfileDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== "string") return false;
  const abs = path.resolve(dirPath);
  if (!fs.existsSync(abs)) return false;
  const rootAnchor = path.parse(abs).root;
  let cur = rootAnchor;
  const parts = path.relative(rootAnchor, abs).split(path.sep);
  for (const part of parts) {
    if (!part) continue;
    cur = path.join(cur, part);
    if (!fs.existsSync(cur)) return false;
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) return false;
  }
  const stFinal = fs.lstatSync(abs);
  if (!stFinal.isDirectory()) return false;
  return true;
}

function readSecretsFileSafely(filePath, parentDir) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const st = fs.lstatSync(filePath);
  if (st.isSymbolicLink() || !st.isFile()) return null;
  const realFile = fs.realpathSync(filePath);
  const realParent = fs.realpathSync(parentDir);
  if (path.dirname(realFile) !== realParent) return null;
  return readJson(filePath, null);
}

function userDataFor(profile) {
  if (!profile || !profile.id || typeof profile.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id)) return null;
  if (profile.id === "cursor-b" || profile.id === "cursor-c") return null;
  if (profile.id === activeProfileId()) {
    if (isSafeProfileDirectory(SEAT4)) return SEAT4;
    return null;
  }
  const cand = profile.identitySource || profile.sourceUserData || null;
  if (!cand || typeof cand !== "string") return null;
  if (cand.includes("..")) return null;
  const norm = path.resolve(cand);
  const allowedRoots = [
    path.join(ROOT, "profile-data"),
    path.join(ROOT, "box-data"),
    path.join(os.homedir(), "Library", "Application Support", "Cursor"),
    path.join(os.homedir(), ".cursor"),
  ];
  const realRoots = allowedRoots.map((r) => {
    try { return fs.existsSync(r) ? fs.realpathSync(r) : path.resolve(r); } catch { return path.resolve(r); }
  });
  if (!isSafeProfileDirectory(norm)) return null;
  const realNorm = fs.realpathSync(norm);
  const isContained = realRoots.some((r) => realNorm === r || realNorm.startsWith(r + path.sep));
  if (!isContained) return null;
  return norm;
}

function decryptScopedToken(safeStorage, scoped) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
  const tok = String(scoped || "");
  if (!tok.startsWith("scoped:v1:")) {
    if (tok.split(".").length === 3) return tok;
    return null;
  }
  const rest = tok.slice("scoped:v1:".length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  try {
    return safeStorage.decryptString(Buffer.from(rest.slice(i + 1), "base64"));
  } catch {
    return null;
  }
}

function tokenForProfile(profile, safeStorage) {
  if (!profile || !profile.id || typeof profile.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id)) return null;
  let root = userDataFor(profile);
  let secrets = root ? readSecretsFileSafely(path.join(root, "sand-secrets.json"), root) : null;
  if (!secrets) {
    const profDir = path.join(ROOT, "profile-data", profile.id, "secrets");
    if (isSafeProfileDirectory(profDir)) {
      const saved = path.join(profDir, "sand-secrets.json");
      secrets = readSecretsFileSafely(saved, profDir);
    }
  }
  if (!secrets) {
    log(profile.id + " no-secrets " + (root || "none"));
    return null;
  }
  const raw = secrets["cursor-access-token"] || secrets.accessToken || "";
  if (!raw) {
    log(profile.id + " no-token keys=" + Object.keys(secrets).join(","));
    return null;
  }
  if (String(raw).split(".").length === 3) return String(raw);
  const enc = !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  const dec = decryptScopedToken(safeStorage, raw);
  if (!dec) log(profile.id + " decrypt-failed");
  return dec;
}

function log(msg) {
  secGuard.auditLog("quota", msg, "quota.log");
}

function postJson(url, token) {
  return new Promise((resolve) => {
    const body = Buffer.from("{}");
    const req = https.request(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json",
        "connect-protocol-version": "1",
        "x-ghost-mode": "true",
        "x-cursor-client-type": "generic",
        "content-length": body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode === 200, status: res.statusCode, json, text: text.slice(0, 280) });
      });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
    req.write(body);
    req.end();
  });
}

function asPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1.0001) return Math.round(n * 1000) / 10;
  return Math.round(Math.min(n, 1000) * 10) / 10;
}

function normalize(json) {
  if (!json || typeof json !== "object") return null;
  const inner = json.usage || json;
  const raw = inner.usagePercent != null ? inner.usagePercent : inner.usage_percent;
  const pct = asPercent(raw);
  if (pct == null) return null;
  const reset = inner.nextResetTimestampUtc || inner.next_reset_timestamp_utc;
  let nextResetMs = null;
  if (reset && typeof reset === "object" && reset.seconds != null) {
    nextResetMs = Number(reset.seconds) * 1000;
  } else if (typeof reset === "string") {
    const t = Date.parse(reset);
    if (Number.isFinite(t)) nextResetMs = t;
  } else if (typeof reset === "number") {
    nextResetMs = reset > 1e12 ? reset : reset * 1000;
  }
  return {
    percentUsed: pct,
    nextResetMs,
    hasLimit: inner.hasNonZeroIncludedLimit === true || inner.has_non_zero_included_limit === true,
    at: Date.now(),
  };
}

async function fetchQuota(token) {
  if (!token) return null;
  const urls = [
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus",
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
  ];
  for (const url of urls) {
    const r = await postJson(url, token);
    log("GET " + url.split("/").pop() + " " + (r.status || r.error) + " " + (r.text || "").slice(0, 120));
    if (!r.ok || !r.json) continue;
    const n = normalize(r.json);
    if (n) return n;
  }
  return null;
}

function cachedQuota(id) {
  const seats = readCache();
  return seats[id] || null;
}

async function refreshProfile(profile, safeStorage) {
  if (!profile || profile.kind !== "cursor") return null;
  const initialActive = activeProfileId();
  const tok = tokenForProfile(profile, safeStorage);
  log(profile.id + " token=" + (tok ? ("yes:" + tok.length) : "no"));
  const q = await fetchQuota(tok);
  if (!q) return cachedQuota(profile.id);
  if (profile.id === initialActive && activeProfileId() !== initialActive) {
    log(profile.id + " profile changed during quota fetch; skipped cache write");
    return q;
  }
  return remember(profile.id, q);
}

async function refreshAll(safeStorage) {
  const out = Object.assign({}, readCache());
  for (const p of profiles()) {
    if (p.kind !== "cursor") continue;
    try {
      const q = await refreshProfile(p, safeStorage);
      if (q) out[p.id] = q;
    } catch {}
  }
  return out;
}

module.exports = {
  cachedQuota,
  readCache,
  writeCache,
  remember,
  stampExhausted,
  formatWall,
  hoverText,
  EXHAUSTED_AT,
  refreshAll,
  refreshProfile,
  profiles,
  userDataFor,
  tokenForProfile,
};
