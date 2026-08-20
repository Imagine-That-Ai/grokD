#!/usr/bin/env node
// Headless evaluate + act. Safe no-op while fall over is off.
"use strict";

const fo = require("./failover");
const { act } = require("./failover-act");
const store = require("./profile-store");

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
  const { execFileSync } = require("child_process");
  const sendPrompt = (id, text) => {
    try {
      execFileSync("curl", [
        "-sS", "-X", "POST", "http://127.0.0.1:1337/api/sendPrompt",
        "-H", "content-type: application/json",
        "-H", "authorization: Bearer fake-gateway-token",
        "-d", JSON.stringify({ agentId: id, prompt: String(text || ""), awaitTurn: false }),
      ], { encoding: "utf8", timeout: 8000 });
      return true;
    } catch { return false; }
  };
  return act(decision, {
    relaunch: decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone",
    sendPrompt,
    agents: store.list(),
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
