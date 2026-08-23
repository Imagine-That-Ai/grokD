// Seed or resume a durable Local D continuation of the current official bot.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const continuation = require("./continuation");
const secGuard = require("./security-guard");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const PAYLOAD = path.join(ROOT, "runtime", "takeover.json");
const MAX_PAYLOAD_AGE_MS = 10 * 60 * 1000;

function validateFreshPayload(payload) {
  const capturedAt = Number(payload && (payload.capturedAt || payload.at));
  const age = Date.now() - capturedAt;
  if (!capturedAt || age < -30000 || age > MAX_PAYLOAD_AGE_MS) {
    throw new Error("local continuation snapshot is stale; click Local copy again");
  }
  if (!payload
      || typeof payload.sourceAgentId !== "string"
      || !payload.sourceAgentId.trim()) {
    throw new Error("local continuation snapshot has no exact official bot identity");
  }
  return capturedAt;
}

function readPayload(opts) {
  opts = opts || {};
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(PAYLOAD, "utf8")); }
  catch (error) {
    if (opts.optional) return {};
    throw new Error(`local continuation snapshot is unavailable: ${error && error.message || error}`);
  }
  try {
    validateFreshPayload(payload);
  } catch (error) {
    if (opts.optional) return {};
    throw error;
  }
  return payload;
}

function writePayload(obj) {
  validateFreshPayload(obj);
  secGuard.writeJsonAtomic0600(PAYLOAD, obj);
  return PAYLOAD;
}

function consumePayload(capturedAt) {
  let current = null;
  try { current = JSON.parse(fs.readFileSync(PAYLOAD, "utf8")); } catch { return false; }
  if (capturedAt && Number(current && (current.capturedAt || current.at)) !== Number(capturedAt)) {
    return false;
  }
  try {
    fs.unlinkSync(PAYLOAD);
    return true;
  } catch {
    return false;
  }
}

function seed(payload) {
  const lockFile = path.join(ROOT, ".takeover-action.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 6000, staleMs: 20000 });
  if (fd === null) throw new Error("local continuation is busy; retry");
  try {
    const explicit = payload || {};
    const hasExplicitSnapshot = !!(
      explicit.capturedAt
      || explicit.at
      || explicit.sourceAgentId
      || (Array.isArray(explicit.turns) && explicit.turns.length)
    );
    const captured = hasExplicitSnapshot ? {} : readPayload();
    payload = Object.assign({}, captured, explicit);
    const capturedAt = validateFreshPayload(payload);
    const result = continuation.createOrUpdate({
      sourceProfileId: payload.sourceProfileId || payload.from,
      sourceProfileName: payload.sourceProfileName || payload.fromName,
      sourceAccountSlot: payload.sourceAccountSlot,
      sourceAgentId: payload.sourceAgentId,
      sourceAgentName: payload.sourceAgentName || payload.sourceName,
      sourceAgentDescription: payload.sourceAgentDescription,
      sourceAgentTitle: payload.sourceAgentTitle,
      sourceAgentAvatarDataUrl: payload.sourceAgentAvatarDataUrl,
      sourceAgentAvatarVersion: payload.sourceAgentAvatarVersion,
      sourceAgentAvatarShape: payload.sourceAgentAvatarShape,
      sourceAgentAvatarColor: payload.sourceAgentAvatarColor,
      sourceThreadId: payload.sourceThreadId,
      sourceHref: payload.sourceHref,
      model: payload.model,
      lastUser: payload.lastUser,
      turns: payload.turns,
      excerpts: payload.excerpts,
      capturedAt: payload.capturedAt || payload.at,
    });
    if (!hasExplicitSnapshot) consumePayload(capturedAt);
    return {
      ok: true,
      via: "continuation",
      id: result.localAgentId,
      destId: result.localAgentId,
      name: result.name,
      reused: result.reused,
      status: result.status,
      continueJob: result.continueJob,
    };
  } finally {
    secGuard.releaseFileLock(lockFile, fd);
  }
}

module.exports = {
  seed,
  writePayload,
  readPayload,
  consumePayload,
  PAYLOAD,
  MAX_PAYLOAD_AGE_MS,
};

if (require.main === module) {
  const r = seed();
  console.log(JSON.stringify(r));
}
