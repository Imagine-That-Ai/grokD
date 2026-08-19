#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const box = require("./box-state");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-box-"));
const assert = (c, m) => { if (!c) throw new Error(m); };
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const remote = path.join(tmp, "remote.json");
fs.writeFileSync(remote, JSON.stringify({
  baseUrl: "https://pod.example.cursorvm.com",
  token: "t",
  headers: { "x-anyrun-network-token": "n" },
  vncProxy: { primaryUrl: "https://v/vnc.html", forkBaseUrl: "https://v2", networkToken: "n" },
}));
assert(box.isRemoteConnection(remote), "https vm is remote");
const local = path.join(tmp, "local.json");
fs.writeFileSync(local, JSON.stringify({ baseUrl: "http://127.0.0.1:1337", token: "fake-gateway-token" }));
assert(!box.isRemoteConnection(local), "loopback is not remote");
ok("remote-detect");

const seat = path.join(tmp, "seat");
fs.mkdirSync(path.join(seat, "sand-data"), { recursive: true });
fs.copyFileSync(local, box.connectionPath(seat));
fs.writeFileSync(path.join(seat, ".env-descriptor-account-bindings.json"), "{}");
box.clearCursorHost(seat);
assert(!fs.existsSync(box.connectionPath(seat)), "cleared connection");
assert(!fs.existsSync(path.join(seat, ".env-descriptor-account-bindings.json")), "cleared bindings");
ok("clear");

const from = path.join(tmp, "from");
fs.mkdirSync(path.join(from, "sand-data"), { recursive: true });
fs.copyFileSync(remote, box.connectionPath(from));
fs.writeFileSync(path.join(from, "sand-data", "settings.json"), JSON.stringify({ version: 1 }));
assert(box.installConnection(box.connectionPath(from), seat), "install remote");
assert(box.isRemoteConnection(box.connectionPath(seat)), "seat now remote");
ok("install");

const dest = path.join(tmp, "profile");
fs.mkdirSync(dest, { recursive: true });
const copied = box.snapshotHost(seat, dest);
assert(copied.includes("sand-data/local-exec-daemon-connection.json"), copied.join(","));
assert(box.isRemoteConnection(path.join(dest, "sand-data", "local-exec-daemon-connection.json")), "snap remote");
ok("snapshot");

const picked = box.pickRemoteConnection([path.join(tmp, "none"), dest, from]);
assert(picked && picked.endsWith("local-exec-daemon-connection.json"), picked);
ok("pick");

const officialMac = path.join(tmp, "official-a");
fs.mkdirSync(officialMac, { recursive: true });
assert(box.officialUsesThisMac(officialMac) === true, "official A with no VM is this Mac");
const staleSnap = path.join(tmp, "stale-a");
fs.mkdirSync(path.join(staleSnap, "sand-data"), { recursive: true });
fs.copyFileSync(remote, box.connectionPath(staleSnap));
assert(box.chooseCursorConnection(officialMac, staleSnap) == null, "do not rehydrate dead snapshot over this-Mac official");
assert(box.chooseCursorConnection(null, staleSnap) === box.connectionPath(staleSnap), "sign-in seat still uses saved VM");
ok("this-mac-not-stale-vm");
assert(box.probeRemoteUrlSync("http://127.0.0.1:1337") === true, "loopback probe ok");
assert(box.probeRemoteUrlSync("https://900322d227ff6573fc34-pod-5vjl3y33brfrhjtdfh5kbhouou-1340.us9.cursorvm.com") === false, "dead vm probe");
ok("probe-dead-vm");

const older = path.join(tmp, "older.json");
const newer = path.join(tmp, "newer.json");
fs.writeFileSync(older, "a");
fs.writeFileSync(newer, "b");
const past = new Date(Date.now() - 60_000);
fs.utimesSync(older, past, past);
assert(box.newerFile(older, newer) === newer, "newer file wins");
assert(box.newerFile(null, newer) === newer, "missing older");
ok("newer-file");

const scoped = path.join(tmp, "scoped.json");
fs.writeFileSync(scoped, JSON.stringify({
  "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cipher",
}));
assert(box.accountScopeFromSecrets(scoped) === "a".repeat(64), "scope from token");
ok("scope-from-token");

const setDir = path.join(tmp, "set");
fs.mkdirSync(path.join(setDir, "sand-data"), { recursive: true });
fs.writeFileSync(path.join(setDir, "sand-data", "settings.json"), JSON.stringify({
  version: 1,
  mcpCustomInstructionsAccountScope: "old-scope",
  hasSeenOnboardingAccountScope: "old-scope",
}));
assert(box.resetForeignSettings(setDir, "new-scope") === true, "reset foreign");
const after = box.readJson(path.join(setDir, "sand-data", "settings.json"));
assert(!after.mcpCustomInstructionsAccountScope, "stripped mcp scope");
assert(!after.hasSeenOnboardingAccountScope, "stripped onboard scope");
ok("reset-settings");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/${n} box-state groups passed`);
