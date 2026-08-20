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

function writeCache(map) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({ ts: Date.now(), seats: map }));
  } catch {}
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
  const seats = readCache();
  const prev = seats[id];
  const merged = Object.assign({}, incoming || {});
  if (merged.nextResetMs == null && prev && prev.nextResetMs) merged.nextResetMs = prev.nextResetMs;
  seats[id] = stampExhausted(prev, merged, threshold, now);
  writeCache(seats);
  return seats[id];
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
  const s = readJson(STORE, {});
  return Array.isArray(s.profiles) ? s.profiles : [];
}

function userDataFor(profile) {
  if (!profile) return null;
  if (profile.id === activeProfileId()) return SEAT4;
  return profile.sourceUserData || profile.identitySource || null;
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
  const root = userDataFor(profile);
  if (!root) {
    log(profile.id + " no-root");
    return null;
  }
  const secPath = path.join(root, "sand-secrets.json");
  const secrets = readJson(secPath, null);
  if (!secrets) {
    log(profile.id + " no-secrets " + secPath);
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
  try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[quota] " + msg + "\n"); } catch {}
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
  const tok = tokenForProfile(profile, safeStorage);
  log(profile.id + " token=" + (tok ? ("yes:" + tok.length) : "no"));
  const q = await fetchQuota(tok);
  if (!q) return cachedQuota(profile.id);
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
};
