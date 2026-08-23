#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS ", name);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-switch-continuation-"));
const seat4 = path.join(root, "seat4");
const hack = path.join(root, "hack");
process.env.GROK_PROFILE_ROOT = root;
process.env.GROK_SEAT4 = seat4;
process.env.GROKBOT_HACK = hack;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

writeJson(path.join(root, "profiles.json"), {
  version: 1,
  activeId: "cursor-a",
  profiles: [
    { id: "local-d", name: "Local D", kind: "local", color: "#c4b5fd" },
    { id: "cursor-a", name: "Official", kind: "cursor", color: "#f4f4f5" },
  ],
});
writeJson(path.join(root, "active-env.json"), { mode: "cursor", profileId: "cursor-a" });
writeJson(path.join(root, "profile-data", "local-d", "secrets", "sand-secrets.json"), {
  "cursor-machine-id": "local-machine",
});
writeJson(path.join(root, "profile-data", "local-d", "box-data", "agents",
  "11111111-1111-4111-8111-111111111111", "profile.json"), {
  name: "Existing local bot",
});
writeJson(path.join(root, "profile-data", "cursor-a", "secrets", "sand-secrets.json"), {
  "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x",
  "cursor-machine-id": "official-machine",
});
writeJson(path.join(seat4, "sand-secrets.json"), {
  "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x",
  "cursor-machine-id": "official-machine",
});
writeJson(path.join(seat4, "sand-client-persistence", "official-thread.json"), {
  schemaVersion: 1,
  value: "official-thread",
});
writeJson(path.join(root, "model-config.json"), {
  proxyTarget: "openburnbar",
  model: "grok-4.6",
});

const store = require("./profile-store");
const switcher = require("./switch-profile");

let failed = false;
try {
  switcher.switchTo("local-d", {
    relaunch: false,
    takeover: true,
    seedContinuation: () => { throw new Error("simulated snapshot failure"); },
  });
} catch (error) {
  failed = /simulated snapshot failure/.test(String(error && error.message || error));
}
assert(failed, "takeover seed failure was swallowed");
assert(store.getActive().id === "cursor-a", `active profile changed to ${store.getActive().id}`);
const restoredEnv = JSON.parse(fs.readFileSync(path.join(root, "active-env.json"), "utf8"));
assert(restoredEnv.mode === "cursor" && restoredEnv.profileId === "cursor-a", JSON.stringify(restoredEnv));
const restoredThread = JSON.parse(
  fs.readFileSync(path.join(seat4, "sand-client-persistence", "official-thread.json"), "utf8")
);
assert(restoredThread.value === "official-thread", JSON.stringify(restoredThread));
ok("failed-copy-restores-official-seat");

const localAgentId = "22222222-2222-4222-8222-222222222222";
const switched = switcher.switchTo("local-d", {
  relaunch: false,
  takeover: true,
  seedContinuation: () => ({
    ok: true,
    id: localAgentId,
    reused: false,
    status: "disposable",
    continueJob: path.join(root, "runtime", "continuation-jobs", `${localAgentId}.json`),
  }),
});
assert(switched.ok && switched.takeover === true, JSON.stringify(switched));
assert(switched.continuation && switched.continuation.id === localAgentId, JSON.stringify(switched));
assert(store.getActive().id === "local-d", store.getActive().id);
ok("successful-copy-commits-local-switch");

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/2 switch-continuation checks passed`);
