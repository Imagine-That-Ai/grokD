#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-apply-"));
process.env.GROK_PROFILE_ROOT = path.join(tmp, "root");
process.env.GROK_SEAT4 = path.join(tmp, "seat4");

const store = require("./profile-store");
const box = require("./box-state");
const sw = require("./switch-profile");

const origProbe = box.probeRemoteUrlSync;
box.probeRemoteUrlSync = (url) => {
  if (/dead-pod|leftover/.test(String(url || ""))) return false;
  if (/cursorvm\.com/.test(String(url || ""))) return true;
  return origProbe(url);
};

const assert = (c, m) => { if (!c) throw new Error(m); };
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

store.ensureDirs();
const seat4 = process.env.GROK_SEAT4;
fs.mkdirSync(path.join(seat4, "sand-data"), { recursive: true });
fs.writeFileSync(box.connectionPath(seat4), JSON.stringify({
  baseUrl: "http://127.0.0.1:1337",
  token: "fake-gateway-token",
}));

const signin = store.add({ name: "My Cursor", kind: "cursor" });
assert(!signin.identitySource, "sign-in has no sibling");
sw.applyCursor(signin);
assert(!fs.existsSync(box.connectionPath(seat4)), "sign-in must not keep leftover local box");
assert(store.readActiveEnv().mode === "cursor", "cursor env");
ok("sign-in-clears-host");

fs.writeFileSync(path.join(seat4, "sand-secrets.json"), JSON.stringify({
  "cursor-access-token": "leftover-from-account-1",
}));
const second = store.add({ name: "Cursor 2", kind: "cursor" });
sw.applyCursor(second);
assert(!fs.existsSync(path.join(seat4, "sand-secrets.json")), "fresh sign-in drops previous tokens");
ok("fresh-signin-wipes-leftover-secrets");

const saved = store.profileDataDir(signin.id);
fs.mkdirSync(path.join(saved, "sand-data"), { recursive: true });
fs.writeFileSync(path.join(saved, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
  baseUrl: "https://pod.example.cursorvm.com",
  token: "saved-token",
}));
fs.mkdirSync(path.join(saved, "secrets"), { recursive: true });
fs.writeFileSync(path.join(saved, "secrets", "sand-secrets.json"), JSON.stringify({
  "cursor-access-token": "aaa",
  "cursor-refresh-token": "bbb",
}));
sw.applyCursor(signin);
const back = box.readJson(box.connectionPath(seat4));
assert(back && back.baseUrl.includes("cursorvm.com"), "uses this profile's saved box");
assert(back.token === "saved-token", "saved token");
ok("saved-box-without-sibling");

const official = path.join(tmp, "official-a");
fs.mkdirSync(official, { recursive: true });
const olderTok = JSON.stringify({ "cursor-access-token": "official-old", "cursor-refresh-token": "old-r" });
fs.writeFileSync(path.join(official, "sand-secrets.json"), olderTok);
const past = new Date(Date.now() - 120_000);
fs.utimesSync(path.join(official, "sand-secrets.json"), past, past);
const signed = store.add({
  name: "Signed A",
  kind: "cursor",
  sourceUserData: official,
  identitySource: official,
});
const signedDir = store.profileDataDir(signed.id);
fs.mkdirSync(path.join(signedDir, "secrets"), { recursive: true });
fs.writeFileSync(path.join(signedDir, "secrets", "sand-secrets.json"), JSON.stringify({
  "cursor-access-token": "d-login-new",
  "cursor-refresh-token": "new-r",
}));
fs.writeFileSync(path.join(seat4, "sand-data", "settings.json"), JSON.stringify({
  version: 1,
  mcpCustomInstructionsAccountScope: "leftover-local",
}));
sw.applyCursor(signed);
const kept = box.readJson(path.join(seat4, "sand-secrets.json"));
assert(kept && kept["cursor-access-token"] === "d-login-new", "in-app login wins over older official seed");
const setAfter = box.readJson(path.join(seat4, "sand-data", "settings.json"));
assert(!setAfter.mcpCustomInstructionsAccountScope, "foreign settings scope stripped");
ok("saved-login-wins");

const officialMac = path.join(tmp, "official-mac");
fs.mkdirSync(officialMac, { recursive: true });
fs.writeFileSync(path.join(officialMac, "sand-secrets.json"), JSON.stringify({
  "cursor-access-token": "mac-tok",
  "cursor-refresh-token": "mac-r",
}));
const macSeat = store.add({
  name: "Official Mac A",
  kind: "cursor",
  sourceUserData: officialMac,
  identitySource: officialMac,
});
fs.mkdirSync(path.join(store.profileDataDir(macSeat.id), "sand-data"), { recursive: true });
fs.writeFileSync(box.connectionPath(store.profileDataDir(macSeat.id)), JSON.stringify({
  baseUrl: "https://dead-pod.cursorvm.com",
  token: "stale",
}));
fs.writeFileSync(box.connectionPath(seat4), JSON.stringify({
  baseUrl: "https://leftover.cursorvm.com",
  token: "leftover",
}));
sw.applyCursor(macSeat);
const keptDead = box.readJson(box.connectionPath(seat4));
assert(keptDead && keptDead.baseUrl === "https://dead-pod.cursorvm.com", "saved https VM stays even if probe fails");
ok("official-this-mac-keeps-saved-vm");

fs.mkdirSync(path.join(seat4, "daemon-data"), { recursive: true });
fs.writeFileSync(box.daemonConnectionPath(seat4), JSON.stringify({
  baseUrl: "http://127.0.0.1:1337",
  token: "fake-gateway-token",
}));
const healthyMac = store.add({
  name: "Official Mac healthy",
  kind: "cursor",
  sourceUserData: officialMac,
  identitySource: officialMac,
});
fs.mkdirSync(path.join(store.profileDataDir(healthyMac.id), "sand-data"), { recursive: true });
fs.writeFileSync(box.connectionPath(store.profileDataDir(healthyMac.id)), JSON.stringify({
  baseUrl: "https://live.cursorvm.com",
  token: "live",
}));
sw.applyCursor(healthyMac);
const keptVm = box.readJson(box.connectionPath(seat4));
assert(keptVm && keptVm.baseUrl === "https://live.cursorvm.com", "healthy saved VM is installed for this-Mac official A");
assert(!fs.existsSync(box.daemonConnectionPath(seat4)), "cursor apply drops leftover local daemon-data");
ok("official-this-mac-keeps-healthy-vm");

const other = store.add({ name: "Other Cursor", kind: "cursor" });
sw.applyCursor(other);
assert(!fs.existsSync(box.connectionPath(seat4)), "next sign-in must drop previous VM");
ok("no-cross-profile-box");

const ghostDir = path.join(tmp, "missing-seat");
const ghost = store.add({ name: "Ghost", kind: "cursor", sourceUserData: ghostDir, identitySource: ghostDir });
let threw = false;
try { sw.applyCursor(ghost); } catch { threw = true; }
assert(threw, "import with no secrets fails closed");
ok("import-missing-fails");

sw.snapshot({ id: signin.id, kind: "cursor" });
// put a live remote on seat4 then snapshot
fs.mkdirSync(path.join(seat4, "sand-data"), { recursive: true });
fs.writeFileSync(box.connectionPath(seat4), JSON.stringify({
  baseUrl: "https://fresh.cursorvm.com",
  token: "fresh",
}));
sw.snapshot({ id: signin.id, kind: "cursor" });
const snap = box.readJson(path.join(store.profileDataDir(signin.id), "sand-data", "local-exec-daemon-connection.json"));
assert(snap && snap.baseUrl.includes("fresh.cursorvm.com"), "snapshot keeps the live box");
ok("snapshot-saves-box");

fs.rmSync(tmp, { recursive: true, force: true });
const localP = store.add({ name: "Local box", kind: "local" });
fs.writeFileSync(path.join(process.env.GROK_PROFILE_ROOT, "model-config.json"), JSON.stringify({
  proxyTarget: "openburnbar", model: "grok-4.6",
}));
sw.snapshot({ id: localP.id, kind: "local" });
fs.writeFileSync(path.join(process.env.GROK_PROFILE_ROOT, "model-config.json"), JSON.stringify({
  proxyTarget: "cliproxy", model: "grok-4.6",
}));
sw.applyLocal(store.get(localP.id));
const restored = JSON.parse(fs.readFileSync(path.join(process.env.GROK_PROFILE_ROOT, "model-config.json"), "utf8"));
assert(restored.proxyTarget === "openburnbar", "local seat restores its own proxy");
ok("per-seat-proxy");

console.log(`\n${n}/${n} apply-cursor groups passed`);
