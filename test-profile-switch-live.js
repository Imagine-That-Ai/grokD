#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const assert = (c, m) => { if (!c) throw new Error(m); };

const SWITCH = path.join(__dirname, "switch-profile.js");
const SEAT4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
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

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

if (!bUp()) {
  console.log("SKIP  test-profile-switch-live (Grok Bot B.app is not running)");
  process.exit(0);
}
ok("b-up-before");

const markerDir = "/tmp/grokbot-hack/box-data/agents/_audit_marker";
fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, "probe.txt"), "keep-me");

const same = execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { encoding: "utf8" });
process.stdout.write(same);
assert(JSON.parse(same).noop === true, "same-id must be a no-op");
assert(env().mode === "local", "local env");
ok("switch-local");

let unknownFailed = false;
try { execFileSync(process.execPath, [SWITCH, "switch", "nope-xyz", "--no-relaunch"]); }
catch { unknownFailed = true; }
assert(unknownFailed, "unknown id must fail");
ok("unknown-id");

const ghostAdd = execFileSync(process.execPath, [
  SWITCH, "add", "--name", "Ghost Seat", "--kind", "cursor",
  "--path", path.join(os.tmpdir(), "no-such-grok-seat-" + Date.now()),
], { encoding: "utf8" });
const ghost = JSON.parse(ghostAdd);
assert(ghost.ok && ghost.id, ghostAdd);
let missingFailed = false;
try {
  execFileSync(process.execPath, [SWITCH, "switch", ghost.id, "--no-relaunch"], { encoding: "utf8" });
} catch (e) {
  const msg = String(e.stderr || e.stdout || e.message || e);
  missingFailed = /missing|unknown|ENOENT|not found/i.test(msg) || e.status !== 0;
}
require("./profile-store").remove(ghost.id);
assert(missingFailed, "missing cursor secrets must fail closed");
assert(env().mode === "local", "failed cursor switch must not flip env");
ok("missing-cursor-secrets");

let aProf = require("./profile-store").get("cursor-a");
if (!aProf) {
  try {
    aProf = require("./profile-store").importDetected("cursor-a");
  } catch {}
}
if (aProf && fs.existsSync(path.join(require("./profile-store").SEATS.A, "sand-secrets.json"))) {
  execFileSync(process.execPath, [SWITCH, "switch", "cursor-a", "--no-relaunch"], { stdio: "inherit" });
  assert(env().mode === "cursor", "cursor env after a");
  ok("switch-cursor-a-files");

  execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "inherit" });
  assert(env().mode === "local", "back to local");
  assert(fs.existsSync(path.join(markerDir, "probe.txt")), "local box-data marker restored");
  fs.rmSync(markerDir, { recursive: true, force: true });
  ok("restore-local-box");
} else {
  console.log("SKIP  live cursor-a switch (official Grok Bot A secrets not detected on Mac)");
}

let famBlocked = false;
try {
  execFileSync(process.execPath, [
    SWITCH, "add", "--name", "All on B", "--kind", "cursor", "--from", "B",
  ], { encoding: "utf8" });
} catch { famBlocked = true; }
assert(famBlocked, "add --from B is retired");
ok("block-from-b");

console.log(`\n${n}/${n} live profile-switch checks passed`);
