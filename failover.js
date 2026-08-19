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
const SEAT_ORDER = ["cursor-a", "cursor-b", "cursor-c"];

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
  const next = defaultConfig(Object.assign(loadConfig(), partial || {}));
  const file = path.join(rootDir(), "failover-config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function isExhausted(q, threshold, now, cacheMaxAgeMs) {
  if (!q || typeof q !== "object") return false;
  const t = Number(threshold);
  const n = Number(now) || Date.now();
  const age = Number(cacheMaxAgeMs) || 10 * 60 * 1000;
  if (q.at != null && n - Number(q.at) > age) return false;
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
  for (const p of cursorOrder(profiles)) {
    if (p.id === fromId) continue;
    if (isSeatPaused(input, p.id)) continue;
    if (isExhausted(quotas && quotas[p.id], threshold, now, cacheMaxAgeMs)) continue;
    const q = quotas && quotas[p.id];
    if (!q || q.percentUsed == null) continue;
    return p;
  }
  return null;
}

function evaluate(input) {
  const cfg = defaultConfig(input && input.config);
  if (!cfg.enabled) return null;
  const now = Number(input && input.now) || Date.now();
  if (cfg.lastFire && cfg.lastFire.at && now - Number(cfg.lastFire.at) < cfg.cooldownMs) return null;
  if (input && input.lastFireAt && now - Number(input.lastFireAt) < cfg.cooldownMs) return null;

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

  if (warnHit && !isSeatPaused(input, payerId)) {
    return {
      action: "soft-stop",
      from: payerId,
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
        from: payerId,
        to: nxt.id,
        stopFirst: true,
        sameThread: local,
        reason: `${payerId} spent; next ${nxt.id} at ${quotas[nxt.id] && quotas[nxt.id].percentUsed}%`,
      };
    }
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
