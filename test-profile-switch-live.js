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
  const out = execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" });
  return out.includes("Grok Bot B.app/Contents/MacOS/Grok Bot.real");
};

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(bUp(), "B must be running before test");
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

execFileSync(process.execPath, [SWITCH, "switch", "cursor-b", "--no-relaunch"], { stdio: "inherit" });
assert(env().mode === "cursor", "cursor env after b");
assert(Object.prototype.hasOwnProperty.call(secrets(), "cursor-access-token"), "b token copied");
ok("switch-cursor-b-files");

execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "inherit" });
assert(env().mode === "local", "back to local");
assert(!Object.prototype.hasOwnProperty.call(secrets(), "cursor-access-token"), "local secrets must not keep B token");
assert(fs.existsSync(path.join(markerDir, "probe.txt")), "local box-data marker restored");
fs.rmSync(markerDir, { recursive: true, force: true });
const r = execFileSync("curl", [
  "-sS", "-X", "POST", "http://127.0.0.1:1337/api/listAgents",
  "-H", "content-type: application/json",
  "-H", "authorization: Bearer fake-gateway-token",
  "-d", "{}",
], { encoding: "utf8" });
const agents = JSON.parse(r);
assert(Array.isArray(agents) && agents.length >= 2, `listAgents ${agents.length || r.slice(0, 120)}`);
assert(bUp(), "B still running");
ok("restore-local-box");

const fam = execFileSync(process.execPath, [
  SWITCH, "add", "--name", "All on B", "--kind", "cursor", "--from", "A", "--identity", "B", "--family", "1",
], { encoding: "utf8" });
assert(JSON.parse(fam).ok, fam);
const store = require("./profile-store");
const p = store.list().find((x) => x.name === "All on B");
assert(p && p.identitySource.includes("GrokBotB"), p);
assert(p.rosterSources.length === 3, "family sources");
store.remove(p.id);
ok("add-family");

console.log(`\n${n}/${n} live profile-switch checks passed`);
