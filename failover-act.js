// No shebang: Electron's renderer wraps module source in an extra function,
// so a line-1 '#!' is no longer at offset 0 and Node's shebang stripping does
// not apply — require() throws SyntaxError in the app while working under
// plain node. Run this as `node failover-act.js <cmd>`.
// Perform one fall-over decision. Always pause bots before switching.
// Does nothing unless evaluate() returned an action. Never kills Grok Bot B.
"use strict";

const fo = require("./failover");
const store = require("./profile-store");

let busy = false;

function markFire(decision) {
  fo.saveConfig({
    lastFire: {
      at: Date.now(),
      action: decision.action,
      from: decision.from,
      to: decision.to || null,
    },
    payingProfileId: decision.action === "pin-account" ? decision.to : undefined,
  });
}

function landLocal(decision, deps) {
  const extra = {};
  try {
    const packLib = deps.pack || require("./handoff-pack");
    extra.pack = packLib.writePack(packLib.buildPack({
      from: decision.from,
      to: decision.to,
      why: decision.reason,
      lastUser: deps.lastUser || "",
      agents: deps.agents || [],
    }));
    extra.chief = packLib.pickChief(deps.agents || [], decision.chiefId);
  } catch (e) {
    extra.packError = String(e && e.message || e);
  }
  if (decision.action === "local-clone") {
    const src = deps.sourceAgentId;
    if (src) {
      try {
        extra.clone = (deps.clone || require("./clone-bot").cloneAgent)(src, { profileId: decision.from });
      } catch (e) {
        extra.cloneError = String(e && e.message || e);
      }
    }
  }
  if (typeof deps.sendPrompt === "function" && extra.chief && extra.pack) {
    extra.sent = deps.sendPrompt(extra.chief.id, extra.pack);
  }
  return extra;
}

async function act(decision, deps) {
  deps = deps || {};
  if (!decision || !decision.action) return { ok: false, skipped: true };
  if (busy) return { ok: false, skipped: true, reason: "busy" };
  busy = true;
  try {
    if (decision.stopFirst !== false) {
      const pause = deps.pause || (async () => require("./bot-pause").pause({
        seats: decision.from ? [decision.from] : undefined,
      }));
      await pause();
    }
    if (decision.action === "soft-stop") {
      return { ok: true, action: "soft-stop", from: decision.from };
    }
    if (decision.action === "pin-account") {
      const models = deps.models || require("./model-lib");
      models.writeConfig({ payingProfileId: decision.to, cursorAccount: decision.to });
      markFire(decision);
      return { ok: true, action: "pin-account", to: decision.to };
    }
    if (decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone") {
      const switchTo = deps.switchTo || ((id) => require("./switch-profile").switchTo(id, {
        relaunch: deps.relaunch !== false,
      }));
      const to = decision.to;
      if (to && store.get(to) && store.getActive().id !== to) switchTo(to);
      const extra = (decision.action === "local-chief" || decision.action === "local-clone")
        ? landLocal(decision, deps)
        : {};
      markFire(decision);
      return Object.assign({ ok: true, action: decision.action, to }, extra);
    }
    return { ok: false, error: "unknown action " + decision.action };
  } finally {
    busy = false;
  }
}

module.exports = { act };
