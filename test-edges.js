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
const scopeOf = (seatPath) => {
  const g = JSON.parse(fs.readFileSync(path.join(seatPath, "gateway-descriptor.json"), "utf8"));
  return g.accountScope || "";
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

const markerDir = "/tmp/grokbot-hack/box-data/agents/_edge_marker";
fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, "probe.txt"), "edge-keep");

execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "pipe" });
assert(env().mode === "local", "start local");
ok("local");

const seats = [
  { id: "cursor-a", path: store.SEATS.A, name: "A" },
  { id: "cursor-b", path: store.SEATS.B, name: "B" },
  { id: "cursor-c", path: store.SEATS.C, name: "C" },
];
const scopes = seats.map((s) => scopeOf(s.path));
assert(new Set(scopes).size === 3, `scopes must differ: ${scopes.map((s) => s.slice(0, 8)).join(",")}`);
ok("abc-scopes-differ");

for (const s of seats) {
  execFileSync(process.execPath, [SWITCH, "switch", s.id, "--no-relaunch"], { stdio: "pipe" });
  assert(env().mode === "cursor", `${s.name} env`);
  const got = secrets()["cursor-access-token"] || "";
  const want = tokenOf(s.path);
  assert(got && got === want, `${s.name} token mismatch`);
  const gd = JSON.parse(fs.readFileSync(path.join(SEAT4, "gateway-descriptor.json"), "utf8"));
  assert(gd.accountScope === scopeOf(s.path), `${s.name} scope`);
  ok(`files-${s.name.toLowerCase()}`);
}

execFileSync(process.execPath, [SWITCH, "switch", "local-d", "--no-relaunch"], { stdio: "pipe" });
assert(env().mode === "local", "restored local");
assert(!Object.prototype.hasOwnProperty.call(secrets(), "cursor-access-token"), "local must drop cursor token");
assert(fs.existsSync(path.join(markerDir, "probe.txt")), "local agents restored");
ok("restore-drops-token");

assert(bUp(), "B still running");
assert(tokenOf(BDIR) === bTokenBefore, "B token file unchanged");
assert(fs.statSync(path.join(BDIR, "sand-secrets.json")).mtimeMs === bMtimeBefore, "B secrets mtime unchanged");
ok("b-untouched");

fs.rmSync(markerDir, { recursive: true, force: true });
console.log(`\n${n}/${n} edge checks passed`);
