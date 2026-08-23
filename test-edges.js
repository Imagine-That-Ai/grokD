#!/usr/bin/env node
// Profile-switch rough edges without relaunching D.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const assert = (c, m) => { if (!c) throw new Error(m); };

const SWITCH = path.join(__dirname, "switch-profile.js");
const SEAT4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
const BDIR = path.join(os.homedir(), "Library/Application Support/GrokBotB");
const store = require("./profile-store");

const secrets = () => {
  try { return JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-secrets.json"), "utf8")); }
  catch { return {}; }
};
const env = () => JSON.parse(fs.readFileSync(path.join(__dirname, "active-env.json"), "utf8"));
const bUp = () => {
  try {
    const { execSync } = require("child_process");
    const out = execSync("pgrep -f 'Grok Bot B.app' || true", { encoding: "utf8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
};
const tokenOf = (seatPath) => {
  const s = JSON.parse(fs.readFileSync(path.join(seatPath, "sand-secrets.json"), "utf8"));
  return s["cursor-access-token"] || "";
};

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

if (!bUp()) {
  console.log("SKIP  test-edges (Grok Bot B is not running on this Mac)");
  process.exit(0);
}
ok("b-up-before");

const bTokenBefore = tokenOf(BDIR);
const bMtimeBefore = fs.statSync(path.join(BDIR, "sand-secrets.json")).mtimeMs;

const initialActive = (store.getActive && store.getActive().id) || "local-d";
const localAgentsDir = path.join(ROOT, "profile-data", "local-d", "agents", "_edge_marker_agent");
secGuard.ensureDir0700(localAgentsDir);
fs.writeFileSync(path.join(localAgentsDir, "profile.json"), JSON.stringify({ id: "_edge_marker_agent", name: "Edge Marker", marker: "preserved" }));

try {
  execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "pipe" });
  assert(env().mode === "local", "start local");
  ok("local");

  const validCursorProfiles = store.list().filter((p) => p.kind === "cursor");
  for (const s of validCursorProfiles) {
    execFileSync(process.execPath, [SWITCH, "switch", s.id, "--no-relaunch"], { stdio: "pipe" });
    assert(env().mode === "cursor", `${s.id} env`);
    ok(`files-${s.id}`);
  }

  execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "pipe" });
  assert(env().mode === "local", "restored local");
  assert(!Object.prototype.hasOwnProperty.call(secrets(), "cursor-access-token"), "local must drop cursor token");
  const restoredAgentProf = path.join(localAgentsDir, "profile.json");
  assert(fs.existsSync(restoredAgentProf), "local agents restored");
  const restoredData = JSON.parse(fs.readFileSync(restoredAgentProf, "utf8"));
  assert.strictEqual(restoredData.marker, "preserved", "agent profile marker preserved across switches");
  ok("restore-drops-token");

  assert(bUp(), "B still running");
  assert(tokenOf(BDIR) === bTokenBefore, "B token file unchanged");
  assert(fs.statSync(path.join(BDIR, "sand-secrets.json")).mtimeMs === bMtimeBefore, "B secrets mtime unchanged");
  ok("b-untouched");
} finally {
  try {
    execFileSync(process.execPath, [SWITCH, "switch", initialActive, "--no-relaunch"], { stdio: "ignore" });
  } catch (_) {}
  try { fs.rmSync(localAgentsDir, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n${n}/${n} edge checks passed`);
