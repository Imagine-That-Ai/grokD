// Shared roots. Scripts may still mention /tmp/grokbot-hack; ensure-local-box
// keeps that path as a symlink to the durable hack dir after reboot.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const HACK = process.env.GROKBOT_HACK || path.join(ROOT, "hack");
const TMP_HACK = "/tmp/grokbot-hack";
const SEAT4 = process.env.GROK_SEAT4 || path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");

function existingHack() {
  if (process.env.GROKBOT_HACK) return process.env.GROKBOT_HACK;
  try {
    if (fs.existsSync(path.join(TMP_HACK, "box-data"))) return TMP_HACK;
  } catch {}
  return HACK;
}

function agentsDir() {
  return path.join(existingHack(), "box-data", "agents");
}

function appCandidates() {
  const home = os.homedir();
  const extra = process.env.GROK_D_APP ? [process.env.GROK_D_APP] : [];
  return extra.concat([
    path.join(home, "Applications", 'grok"D".app'),
    path.join("/Applications", 'grok"D".app'),
    path.join(home, "Applications", "Grok Bot D.app"),
    path.join("/Applications", "Grok Bot D.app"),
  ]);
}

function appBundle() {
  for (const p of appCandidates()) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return fs.realpathSync(p);
    } catch {}
  }
  return appCandidates()[0];
}

module.exports = { ROOT, HACK, TMP_HACK, SEAT4, existingHack, agentsDir, appCandidates, appBundle };
