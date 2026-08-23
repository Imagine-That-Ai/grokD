// No shebang: Electron's renderer wraps module source in an extra function,
// so a line-1 '#!' is no longer at offset 0 and Node's shebang stripping does
// not apply — require() throws SyntaxError in the app while working under
// plain node. Run this as `node failover-act.js <cmd>`.
// Perform one fall-over decision. Always pause bots before switching.
// Does nothing unless evaluate() returned an action. Never kills Grok Bot B.
"use strict";

const fs = require("fs");
const path = require("path");
const fo = require("./failover");
const store = require("./profile-store");
const secGuard = require("./security-guard");

let busy = false;

function markFire(decision) {
  const update = {
    lastFire: {
      at: Date.now(),
      action: decision.action,
      from: decision.from,
      to: decision.to || null,
    },
  };
  if (decision.action === "pin-account") {
    update.payingProfileId = decision.to;
  }
  fo.saveConfig(update);
}

function packLib() {
  return require("./handoff-pack");
}

async function withFailoverLock(fn) {
  const lockFile = path.join(store.ROOT, ".failover-action.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 8000, staleMs: 60000 });
  if (fd === null) return { ok: false, skipped: true, reason: "locked" };
  try {
    return await fn();
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

async function landLocal(decision, deps) {
  const extra = {};
  const packs = deps.pack || packLib();
  try {
    extra.packFile = packs.writePack(packs.buildPack({
      from: decision.from,
      to: decision.to,
      why: decision.reason,
      lastUser: deps.lastUser || "",
      openWork: deps.openWork || "",
      agents: deps.agents || [],
    }));
    extra.pack = packs.packBody ? packs.packBody(extra.packFile) : extra.packFile;
    extra.chief = packs.pickChief(deps.agents || [], decision.chiefId);
  } catch (e) {
    extra.packError = String(e && e.message || e);
  }
  if (decision.action === "local-clone") {
    const src = deps.sourceAgentId;
    try {
      extra.clone = (deps.clone || require("./clone-bot").cloneAgent)(src, {
        profileId: decision.from,
        lastUser: deps.lastUser || "",
        name: deps.sourceName || "",
        excerpts: deps.excerpts || [],
      });
    } catch (e) {
      extra.cloneError = String(e && e.message || e);
    }
  }
  const send = typeof deps.sendPrompt === "function" ? deps.sendPrompt : null;
  const body = extra.pack || deps.lastUser || "";
  if (send && extra.chief && body) {
    try {
      const res = await send(extra.chief.id, body);
      extra.sent = res !== false;
      if (res === false) {
        extra.handoffFailed = true;
      }
    } catch (e) {
      extra.sent = false;
      extra.handoffFailed = true;
      extra.sendError = String(e && e.message || e);
    }
  }
  return extra;
}

async function act(decision, deps) {
  deps = deps || {};
  if (!decision || !decision.action) return { ok: false, skipped: true };
  if (busy) return { ok: false, skipped: true, reason: "busy" };
  busy = true;
  try {
    return await withFailoverLock(async () => {
      const curCfg = fo.loadConfig();
      if (curCfg && curCfg.enabled === false && decision.action !== "soft-stop" && !deps.isTestHook) {
        return { ok: false, skipped: true, reason: "failover-disabled" };
      }
      const lastAt = Number(curCfg.lastFire && curCfg.lastFire.at);
      const cooldown = Number(curCfg.cooldownMs || 60000);
      if (lastAt && Date.now() - lastAt < cooldown) {
        return { ok: false, skipped: true, reason: "cooldown-active-inside-lock" };
      }
      const activeNow = store.getActive();
      const isPinAccount = decision.action === "pin-account";
      const fromMatches = !decision.from || (activeNow && activeNow.id === decision.from) || (isPinAccount && (activeNow && activeNow.id === "local-d"));
      if (!fromMatches && decision.action !== "soft-stop" && !deps.switchTo) {
        return { ok: false, skipped: true, reason: "profile-changed-before-lock", active: activeNow && activeNow.id, from: decision.from };
      }

      const requiresPause = decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone";
      if (requiresPause || decision.stopFirst !== false) {
        const pause = deps.pause || (async () => require("./bot-pause").pause({
          seats: decision.from ? [decision.from] : undefined,
        }));
        const pauseRes = await pause();
        const hasErrors = pauseRes && (pauseRes.paused === false ||
          (Array.isArray(pauseRes.errors) && pauseRes.errors.length > 0) ||
          (Array.isArray(pauseRes.remoteErrors) && pauseRes.remoteErrors.length > 0));
        if (hasErrors) {
          return { ok: false, error: "pause-failed", detail: pauseRes };
        }
        const activeAfterPause = store.getActive();
        const fromMatchesPause = !decision.from || (activeAfterPause && activeAfterPause.id === decision.from) || (isPinAccount && (activeAfterPause && activeAfterPause.id === "local-d"));
        if (!fromMatchesPause && decision.action !== "soft-stop" && !deps.switchTo) {
          return { ok: false, skipped: true, reason: "profile-changed-during-pause", active: activeAfterPause && activeAfterPause.id, from: decision.from };
        }
      }
      if (decision.action === "soft-stop") {
        return { ok: true, action: "soft-stop", from: decision.from };
      }
      if (decision.action === "pin-account") {
        const target = store.get(decision.to);
        if (!target || target.kind !== "cursor") {
          return { ok: false, error: "target-profile-missing", to: decision.to };
        }
        const models = deps.models || require("./model-lib");
        models.writeConfig({ payingProfileId: decision.to, cursorAccount: decision.to });
        markFire(decision);
        return { ok: true, action: "pin-account", to: decision.to };
      }
      if (decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone") {
        const sw = require("./switch-profile");
        const switchTo = deps.switchTo || ((id, opts) => sw.switchTo(id, opts));
        const to = decision.to;
        const targetProf = store.get(to);
        if (!targetProf) {
          return { ok: false, error: "target-profile-missing", to };
        }
        const land = decision.action === "local-chief" || decision.action === "local-clone";
        const activeBeforeSwitch = store.getActive();
        if (decision.from && activeBeforeSwitch.id !== decision.from && activeBeforeSwitch.id !== to && !deps.switchTo) {
          return { ok: false, skipped: true, reason: "profile-changed-before-switch", active: activeBeforeSwitch.id, from: decision.from };
        }
        if (activeBeforeSwitch.id !== to) {
          const switchRes = switchTo(to, { relaunch: land ? false : deps.relaunch !== false, expectedFrom: decision.from });
          if (switchRes === false || (switchRes && switchRes.ok === false)) {
            if (switchRes && switchRes.skipped) return switchRes;
            return { ok: false, error: "switch-failed", to };
          }
        }
        const extra = land ? await landLocal(decision, deps) : {};
        if (land && (extra.cloneError || extra.packError || extra.handoffFailed)) {
          return Object.assign({ ok: false, error: "land-failed", action: decision.action, to }, extra);
        }
        if (decision.action === "local-chief" && (!extra.chief || extra.sent !== true)) {
          return Object.assign({ ok: false, error: "chief-delivery-failed", action: decision.action, to }, extra);
        }
        if (decision.action === "local-clone") {
          if (!extra.clone || !extra.clone.destId) {
            return Object.assign({ ok: false, error: "clone-failed", action: decision.action, to }, extra);
          }
          const body = extra.pack || deps.lastUser || "Continue this work on Local D.";
          try {
            const job = path.join(store.ROOT, "runtime", "continue-job.json");
            fs.mkdirSync(path.dirname(job), { recursive: true });
            fs.writeFileSync(job, JSON.stringify({
              agentId: extra.clone.destId,
              text: body,
              at: Date.now(),
            }) + "\n");
            extra.continueJob = job;
          } catch (e) {
            extra.continueJobError = String(e && e.message || e);
            return Object.assign({ ok: false, error: "continue-job-failed", action: decision.action, to }, extra);
          }
        }
        markFire(decision);
        if (land && deps.relaunch !== false) {
          if (typeof deps.relaunchD === "function") deps.relaunchD();
          else if (!sw.isolatedRoot || !sw.isolatedRoot()) sw.relaunchD();
        }
        return Object.assign({ ok: true, action: decision.action, to }, extra);
      }
      return { ok: false, unknownAction: decision.action };
    });
  } finally {
    busy = false;
  }
}

module.exports = { act, markFire, withFailoverLock, landLocal };
