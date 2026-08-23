#!/usr/bin/env node
// Headless evaluate + act. Safe no-op while fall over is off.
"use strict";

const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const fo = require("./failover");
const { act } = require("./failover-act");
const store = require("./profile-store");
const secGuard = require("./security-guard");

async function tick() {
  const cfg = fo.loadConfig();
  if (!cfg.enabled) return { skipped: true, reason: "off" };
  let quotas = {};
  try { quotas = require("./seat-quota").readCache(); } catch {}
  let pausedIds = {};
  try {
    for (const id of require("./bot-pause").pausedSeats()) pausedIds[id] = true;
  } catch {}
  const active = store.getActive();
  const decision = fo.evaluate({
    profiles: store.list(),
    activeId: active && active.id,
    payingProfileId: cfg.payingProfileId || (active && active.id),
    rails: active && active.kind === "local" ? "local" : "cursor",
    quotas,
    config: cfg,
    pausedIds,
    now: Date.now(),
  });
  if (!decision) return { skipped: true, reason: "no-decision" };
  const http = require("http");
  const sendPrompt = (id, text) => {
    return new Promise((resolve) => {
      try {
        const payload = JSON.stringify({ agentId: id, prompt: String(text || ""), awaitTurn: false });
        const token = secGuard.mintSessionJwt({ audience: "grokbot-proxy", expiresInSeconds: 60 });
        const req = http.request({
          hostname: "127.0.0.1",
          port: 1337,
          path: "/api/sendPrompt",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${token}`,
            "content-length": Buffer.byteLength(payload),
          },
          timeout: 4000,
        }, (res) => {
          let b = "";
          res.on("data", (c) => b += c);
          res.on("end", () => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          });
        });
        req.on("timeout", () => { req.destroy(); resolve(false); });
        req.on("error", () => resolve(false));
        req.write(payload);
        req.end();
      } catch { resolve(false); }
    });
  };
  let agentsList = [];
  try {
    const agentsDir = paths.agentsDir();
    if (fs.existsSync(agentsDir)) {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ent.name)) continue;
        const pFile = path.join(agentsDir, ent.name, "profile.json");
        if (fs.existsSync(pFile)) {
          try {
            const prof = JSON.parse(fs.readFileSync(pFile, "utf8"));
            if (prof) agentsList.push(Object.assign({}, prof, { id: ent.name }));
          } catch {}
        }
      }
    }
  } catch {}
  let lastUser = "";
  let sourceAgentId = "";
  let excerpts = [];
  try {
    const activeAgentFile = path.join(paths.agentsDir(), "active-agent.json");
    if (fs.existsSync(activeAgentFile)) {
      const aData = JSON.parse(fs.readFileSync(activeAgentFile, "utf8"));
      if (aData && aData.activeAgentId) sourceAgentId = String(aData.activeAgentId);
    }
  } catch (_) {}
  try {
    const lockFile = path.join(store.ROOT, ".takeover-action.lock");
    const fd = secGuard.acquireFileLock(lockFile, { waitMs: 1500, staleMs: 10000 });
    if (fd !== null) {
      try {
        const takeoverFile = path.join(store.ROOT, "runtime", "takeover.json");
        if (fs.existsSync(takeoverFile)) {
          const tData = JSON.parse(fs.readFileSync(takeoverFile, "utf8"));
          const isFresh = tData && typeof tData.at === "number" && tData.at > 0 && Math.abs(Date.now() - tData.at) < 10 * 60 * 1000;
          const matchesFrom = tData && tData.from === decision.from;
          if (isFresh && matchesFrom) {
            if (tData.lastUser) lastUser = String(tData.lastUser).slice(0, 4000);
            if (Array.isArray(tData.excerpts)) excerpts = tData.excerpts.slice(0, 10).map((e) => String(e).slice(0, 2000));
            try { fs.unlinkSync(takeoverFile); } catch (_) {}
          }
        }
      } finally {
        secGuard.releaseFileLock(lockFile, fd);
      }
    }
  } catch (_) {}
  return act(decision, {
    relaunch: decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone",
    sendPrompt,
    agents: agentsList,
    lastUser,
    sourceAgentId,
    excerpts,
  });
}

module.exports = { tick };

if (require.main === module) {
  const once = process.argv[2] === "once";
  (async () => {
    const r = await tick();
    console.log(JSON.stringify(r));
    if (once) return;
    setInterval(() => { tick().then((x) => console.log(JSON.stringify(x))).catch((e) => console.error(e.message)); }, 60000);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
