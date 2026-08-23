#!/usr/bin/env node
// Talk to the in-window command bus that profile-ui-inject.js polls.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function getDir() {
  return process.env.GROK_RUNTIME_DIR || path.join(os.homedir(), ".grok", "grokbot-d", "runtime");
}
function getReady() { return path.join(getDir(), "ready.json"); }
function getCommand() { return path.join(getDir(), "command.json"); }
function getResult() { return path.join(getDir(), "result.json"); }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitReady(timeoutMs = 45000) {
  const t0 = Date.now();
  return (async () => {
    while (Date.now() - t0 < timeoutMs) {
      const r = readJson(getReady());
      if (r && r.ts && Date.now() - r.ts < 20000) return r;
      await sleep(250);
    }
    throw new Error("D command bus not ready");
  })();
}

async function sendCommand(op, payload = {}, timeoutMs = 120000) {
  const dir = getDir();
  const commandFile = getCommand();
  const resultFile = getResult();
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let capability = payload.capability;
  if (!capability) {
    try {
      const secGuard = require("./security-guard");
      capability = secGuard.mintSessionJwt({ audience: "ui-bus", expiresInSeconds: Math.ceil(timeoutMs / 1000) + 30 });
    } catch (_) {}
  }
  const cmd = Object.assign({ id, op, ts: Date.now() }, payload, capability ? { capability } : {});
  try { fs.unlinkSync(resultFile); } catch {}
  fs.writeFileSync(commandFile, JSON.stringify(cmd));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = readJson(resultFile);
    if (r && r.id === id) return r;
    await sleep(200);
  }
  throw new Error(`command ${op} timed out`);
}

module.exports = {
  get DIR() { return getDir(); },
  get READY() { return getReady(); },
  get COMMAND() { return getCommand(); },
  get RESULT() { return getResult(); },
  readJson,
  waitReady,
  sendCommand,
};
