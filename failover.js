// No shebang: Electron's renderer wraps module source in an extra function,
// so a line-1 '#!' is no longer at offset 0 and Node's shebang stripping does
// not apply — require() throws SyntaxError in the app while working under
// plain node. Run this as `node failover.js <cmd>`.
// Quota fall-over policy. Pure decide. Never fires on require.
// Hard actions always carry stopFirst — pause bots before switching seats.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function rootDir() {
  return process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
}
const SEAT_ORDER = ["cursor-a"];

function defaultConfig(over) {
  return Object.assign({
    enabled: false,
    nextCursor: false,
    localChief: false,
    localClone: false,
    threshold: 98,
    warnThreshold: 90,
    chiefId: null,
    cooldownMs: 15 * 60 * 1000,
    cacheMaxAgeMs: 10 * 60 * 1000,
    lastFire: null,
    payingProfileId: null,
  }, over || {});
}

function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(rootDir(), "failover-config.json"), "utf8"));
    if (j && typeof j === "object") return defaultConfig(j);
  } catch {}
  return defaultConfig();
}

function saveConfig(partial) {
  const root = rootDir();
  const file = path.join(root, "failover-config.json");
  const lockFile = path.join(root, ".failover-config.lock");
  const secGuard = require("./security-guard");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 4000, staleMs: 15000 });
  if (fd === null) {
    throw new Error("Failed to acquire failover config lock");
  }
  try {
    const cleanPartial = {};
    if (partial && typeof partial === "object") {
      for (const [k, v] of Object.entries(partial)) {
        if (v !== undefined) cleanPartial[k] = v;
      }
    }
    const next = defaultConfig(Object.assign(loadConfig(), cleanPartial));
    secGuard.writeJsonAtomic0600(file, next);
    return next;
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

function isExhausted(q, threshold, now, cacheMaxAgeMs) {
  if (!q || typeof q !== "object") return false;
  if (q.hasLimit === false) return false;
  const t = Number(threshold);
  const n = Number(now) || Date.now();
  const age = Number(cacheMaxAgeMs) || 10 * 60 * 1000;
  const qAt = Number(q.at);
  if (q.at != null && (!Number.isFinite(qAt) || qAt > n + 60000 || n - qAt > age)) return false;
  if (q.nextResetMs != null && Number(q.nextResetMs) < n) return false;
  const pct = Number(q.percentUsed);
  if (!Number.isFinite(pct)) return false;
  return pct >= t;
}

function cursorOrder(profiles) {
  const list = Array.isArray(profiles) ? profiles.filter((p) => p && p.kind === "cursor") : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const out = [];
  const seen = new Set();
  for (const id of SEAT_ORDER) {
    if (byId.has(id)) {
      out.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const p of list) {
    if (!seen.has(p.id)) out.push(p);
  }
  return out;
}

function isSeatPaused(input, id) {
  if (!id) return false;
  const ids = input && input.pausedIds;
  if (Array.isArray(ids)) return ids.indexOf(id) >= 0;
  if (ids && typeof ids === "object") return !!ids[id];
  if (typeof (input && input.paused) === "boolean") return !!input.paused;
  return false;
}

function nextCursor(profiles, quotas, fromId, threshold, now, cacheMaxAgeMs, input) {
  let unmeasured = null;
  const n = Number(now) || Date.now();
  const maxAge = Number(cacheMaxAgeMs) || 10 * 60 * 1000;
  for (const p of cursorOrder(profiles)) {
    if (p.id === fromId) continue;
    if (isSeatPaused(input, p.id)) continue;
    if (isExhausted(quotas && quotas[p.id], threshold, now, cacheMaxAgeMs)) continue;
    const q = quotas && quotas[p.id];
    const qAt = Number(q && q.at);
    if (!q || q.percentUsed == null || (q.at != null && (!Number.isFinite(qAt) || qAt > n + 60000 || n - qAt > maxAge))) {
      if (!unmeasured) unmeasured = p;
      continue;
    }
    return p;
  }
  return unmeasured;
}

function evaluate(input) {
  const cfg = defaultConfig(input && input.config);
  if (!cfg.enabled) return null;
  const now = Number(input && input.now) || Date.now();
  const lastFireAt = Number(cfg.lastFire && cfg.lastFire.at);
  if (Number.isFinite(lastFireAt) && lastFireAt <= now + 60000 && Math.max(0, now - lastFireAt) < cfg.cooldownMs) return null;
  const inputLastFire = Number(input && input.lastFireAt);
  if (Number.isFinite(inputLastFire) && inputLastFire <= now + 60000 && Math.max(0, now - inputLastFire) < cfg.cooldownMs) return null;

  const profiles = (input && input.profiles) || [];
  const activeId = input && input.activeId;
  const payerId = (input && input.payingProfileId) || activeId;
  const rails = (input && input.rails) || (
    (profiles.find((p) => p.id === activeId) || {}).kind === "local" ? "local" : "cursor"
  );
  const quotas = (input && input.quotas) || {};
  const warn = Number(cfg.warnThreshold) || 90;
  const hard = Number(cfg.threshold) || 98;
  const age = cfg.cacheMaxAgeMs;

  const payerQ = quotas[payerId];
  const hardHit = isExhausted(payerQ, hard, now, age);
  const warnHit = !hardHit && isExhausted(payerQ, warn, now, age);

  const targetFrom = rails === "local" ? "local-d" : payerId;
  if (warnHit && !isSeatPaused(input, targetFrom)) {
    return {
      action: "soft-stop",
      from: targetFrom,
      payerId: payerId,
      to: null,
      stopFirst: true,
      sameThread: true,
      reason: `included quota ${payerQ.percentUsed}% ≥ warn ${warn}%`,
    };
  }
  if (!hardHit) return null;
  if (!cfg.nextCursor && !cfg.localChief && !cfg.localClone) return null;

  if (cfg.nextCursor) {
    const nxt = nextCursor(profiles, quotas, payerId, hard, now, age, input);
    if (nxt) {
      const local = rails === "local" || activeId === "local-d";
      return {
        action: local ? "pin-account" : "cursor",
        from: local ? activeId : payerId,
        payerId: payerId,
        to: nxt.id,
        stopFirst: true,
        sameThread: local,
        reason: `${payerId} spent; next ${nxt.id} at ${quotas[nxt.id] && quotas[nxt.id].percentUsed}%`,
      };
    }
  }
  if (rails === "local" || activeId === "local-d") {
    // If local is already active and no other cursor account is available, stop workload
    return {
      action: "soft-stop",
      from: "local-d",
      payerId: payerId,
      to: null,
      stopFirst: true,
      sameThread: true,
      reason: `${payerId} spent; no remaining eligible cursor seats`,
    };
  }
  if (cfg.localChief) {
    return {
      action: "local-chief",
      from: payerId,
      to: "local-d",
      stopFirst: true,
      sameThread: false,
      chiefId: cfg.chiefId || null,
      reason: `${payerId} spent; hand off to Local D chief`,
    };
  }
  if (cfg.localClone) {
    return {
      action: "local-clone",
      from: payerId,
      to: "local-d",
      stopFirst: true,
      sameThread: true,
      reason: `${payerId} spent; clone onto Local D`,
    };
  }
  return null;
}

module.exports = {
  get ROOT() { return rootDir(); },
  get CONFIG() { return path.join(rootDir(), "failover-config.json"); },
  defaultConfig, loadConfig, saveConfig,
  isExhausted,
  isSeatPaused,
  cursorOrder,
  nextCursor,
  evaluate,
};

if (require.main === module) {
  const cmd = process.argv[2] || "evaluate";
  if (cmd === "evaluate") {
    let quotas = {};
    try {
      const path = require("path");
      const os = require("os");
      const fs = require("fs");
      const root = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
      const cache = JSON.parse(fs.readFileSync(path.join(root, "runtime", "seat-quota.json"), "utf8"));
      quotas = (cache && cache.seats) || {};
    } catch {}
    let profiles = [];
    let activeId = "";
    try {
      const store = require("./profile-store");
      profiles = store.list();
      activeId = store.getActive().id;
    } catch {}
    let pausedIds = {};
    try {
      const pause = require("./bot-pause");
      for (const id of pause.pausedSeats()) pausedIds[id] = true;
    } catch {}
    const cfg = defaultConfig();
    try {
      const path = require("path");
      const os = require("os");
      const fs = require("fs");
      const p = path.join(process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d"), "failover-config.json");
      Object.assign(cfg, JSON.parse(fs.readFileSync(p, "utf8")));
    } catch {}
    console.log(JSON.stringify(evaluate({
      profiles, activeId, payingProfileId: cfg.payingProfileId || activeId,
      quotas, config: cfg, pausedIds, now: Date.now(),
    }), null, 2));
  } else {
    console.error("usage: failover.js evaluate");
    process.exit(2);
  }
}
