#!/usr/bin/env node
// Talk to the in-window command bus that profile-ui-inject.js polls.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DIR = path.join(os.homedir(), ".grok", "grokbot-d", "runtime");
const READY = path.join(DIR, "ready.json");
const COMMAND = path.join(DIR, "command.json");
const RESULT = path.join(DIR, "result.json");

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
      const r = readJson(READY);
      if (r && r.ts && Date.now() - r.ts < 20000) return r;
      await sleep(250);
    }
    throw new Error("D command bus not ready");
  })();
}

async function sendCommand(op, payload = {}, timeoutMs = 120000) {
  fs.mkdirSync(DIR, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cmd = Object.assign({ id, op, ts: Date.now() }, payload);
  try { fs.unlinkSync(RESULT); } catch {}
  fs.writeFileSync(COMMAND, JSON.stringify(cmd));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = readJson(RESULT);
    if (r && r.id === id) return r;
    await sleep(200);
  }
  throw new Error(`command ${op} timed out`);
}

module.exports = { DIR, READY, COMMAND, RESULT, readJson, waitReady, sendCommand };
