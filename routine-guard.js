#!/usr/bin/env node
// Park joke/harness minute-routines on Grok Bot D so they stay dead.
// Never writes outside box-data/agents/*/automations/*/automation.json.

const fs = require("fs");
const path = require("path");

const AGENTS_ROOT = "/tmp/grokbot-hack/box-data/agents";
const KEEP_AGENT = "9b916ddb";
const KEEP_FOLDER = "8468e7f8";
const EVERY_MINUTE = "* * * * *";
const PARKED = "0 0 1 1 *";

function shouldPark(agentDirName, folderName, cfg) {
  const agent = String(agentDirName || "");
  const folder = String(folderName || "");
  if (agent.startsWith(KEEP_AGENT) && folder.startsWith(KEEP_FOLDER)) return false;
  const name = cfg && cfg.name != null ? String(cfg.name) : "";
  const schedule = cfg && cfg.schedule != null ? String(cfg.schedule) : "";
  // Only park joke/harness spam — not every user minute-cron.
  return /joke/i.test(name) || /^Harness /.test(name);
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

function scanOnce() {
  for (const agent of listDirs(AGENTS_ROOT)) {
    const autos = path.join(AGENTS_ROOT, agent.name, "automations");
    for (const folder of listDirs(autos)) {
      const file = path.join(autos, folder.name, "automation.json");
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
      if (!shouldPark(agent.name, folder.name, cfg)) continue;

      let changed = false;
      if (cfg.enabled !== false) {
        cfg.enabled = false;
        changed = true;
      }
      if (cfg.schedule === EVERY_MINUTE) {
        cfg.schedule = PARKED;
        changed = true;
      }
      if (!changed) continue;

      try {
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      } catch {
        continue;
      }
      console.log(`[guard] parked ${agent.name.slice(0, 8)} ${folder.name} ${cfg.name}`);
    }
  }
}

module.exports = { scanOnce, shouldPark };

if (require.main === module) {
  scanOnce();
  setInterval(scanOnce, 5000);
}
