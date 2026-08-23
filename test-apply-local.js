#!/usr/bin/env node
// Isolated applyLocal / takeover checks. Does not touch live Seat4 or B.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const assert = (c, m) => { if (!c) throw new Error(m); };
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "gd-local-"));
const SEAT4 = path.join(ROOT, "seat4");
const HACK = path.join(ROOT, "hack");
const SWITCH = path.join(__dirname, "switch-profile.js");

function env() {
  return {
    ...process.env,
    GROK_PROFILE_ROOT: ROOT,
    GROK_SEAT4: SEAT4,
    GROKBOT_HACK: HACK,
  };
}

function run(args) {
  return execFileSync(process.execPath, [SWITCH, ...args], {
    encoding: "utf8",
    env: env(),
  });
}

function write(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n");
}

function seedStore() {
  write(path.join(ROOT, "profiles.json"), {
    version: 1,
    activeId: "cursor-a",
    profiles: [
      { id: "local-d", name: "Local D", kind: "local", color: "#c4b5fd" },
      { id: "cursor-a", name: "Grok A", kind: "cursor", color: "#f4f4f5", seat: "A" },
    ],
  });
  write(path.join(ROOT, "profile-data", "local-d", "secrets", "sand-secrets.json"), {
    "cursor-machine-id": "local-machine",
  });
  write(path.join(ROOT, "profile-data", "local-d", "persistence", "local-only.json"), {
    schemaVersion: 1, value: "local-persist",
  });
  write(path.join(ROOT, "profile-data", "local-d", "box-data", "agents", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "profile.json"), {
    name: "Local Bench",
  });
  write(path.join(ROOT, "profile-data", "local-d", "model-config.json"), {
    proxyTarget: "cliproxy",
    model: "grok-4.6",
    apiKey: "",
  });
  write(path.join(ROOT, "profile-data", "cursor-a", "secrets", "sand-secrets.json"), {
    "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x",
    "cursor-machine-id": "cursor-machine",
  });
  write(path.join(SEAT4, "sand-secrets.json"), {
    "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x",
    "cursor-refresh-token": "refresh",
    "cursor-machine-id": "cursor-machine",
  });
  write(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json"), {
    baseUrl: "https://example.cursorvm.com",
    token: "vm-token",
  });
  write(path.join(SEAT4, "gateway-descriptor.json"), { encrypted: "nope", accountScope: "aaa" });
  write(path.join(SEAT4, "sand-client-persistence", "cursor-thread.json"), {
    schemaVersion: 1, value: "cursor-chat",
  });
  write(path.join(ROOT, "model-config.json"), {
    proxyTarget: "openburnbar",
    model: "gpt-5.6-luna",
  });
}

seedStore();

const out = run(["switch", "local-d", "--no-relaunch"]);
const r = JSON.parse(out);
assert(r.ok && r.to === "local-d" && !r.takeover, out);
const conn = JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json"), "utf8"));
assert(conn.baseUrl === "http://127.0.0.1:1337", conn.baseUrl);
assert(!fs.existsSync(path.join(SEAT4, "gateway-descriptor.json")), "gd leftover");
const sec = JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-secrets.json"), "utf8"));
assert(!sec["cursor-access-token"], "token leftover");
const persist = JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-client-persistence", "local-only.json"), "utf8"));
assert(persist.value === "local-persist", persist);
assert(!fs.existsSync(path.join(SEAT4, "sand-client-persistence", "cursor-thread.json")), "cursor persist stayed");
const agent = JSON.parse(fs.readFileSync(path.join(HACK, "box-data", "agents", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "profile.json"), "utf8"));
assert(agent.name === "Local Bench", agent.name);
const model = JSON.parse(fs.readFileSync(path.join(ROOT, "model-config.json"), "utf8"));
assert(model.model === "grok-4.6" && model.proxyTarget === "cliproxy", JSON.stringify(model));
ok("restore-local-config");

// Back to a fake cursor seat, then continue.
write(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json"), {
  baseUrl: "https://example.cursorvm.com",
  token: "vm-token",
});
write(path.join(SEAT4, "gateway-descriptor.json"), { encrypted: "nope" });
write(path.join(SEAT4, "sand-secrets.json"), {
  "cursor-access-token": "scoped:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x",
});
write(path.join(SEAT4, "sand-client-persistence", "live-thread.json"), {
  schemaVersion: 1, value: "keep-me",
});
write(path.join(ROOT, "model-config.json"), {
  proxyTarget: "openburnbar",
  model: "grok-4.6",
});
write(path.join(ROOT, "active-env.json"), { mode: "cursor", profileId: "cursor-a" });
write(path.join(ROOT, "profiles.json"), {
  version: 1,
  activeId: "cursor-a",
  profiles: [
    { id: "local-d", name: "Local D", kind: "local", color: "#c4b5fd" },
    { id: "cursor-a", name: "Grok A", kind: "cursor", color: "#f4f4f5", seat: "A" },
  ],
});
write(path.join(ROOT, "runtime", "takeover.json"), {
  sourceProfileId: "cursor-a",
  sourceProfileName: "Grok A",
  sourceAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceAgentName: "Official release bot",
  sourceAgentDescription: "Finish releases carefully.",
  model: "grok-4.6",
  lastUser: "finish the hover tip",
  turns: [
    { id: "official-user", role: "user", text: "finish the hover tip" },
    { id: "official-assistant", role: "assistant", text: "Factory Commander said ok" },
  ],
  capturedAt: Date.now(),
});

const out2 = run(["switch", "local-d", "--takeover", "--no-relaunch"]);
const r2 = JSON.parse(out2);
assert(r2.ok && r2.takeover === true, out2);
assert(r2.continuation && r2.continuation.id, out2);
const conn2 = JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json"), "utf8"));
assert(conn2.baseUrl === "http://127.0.0.1:1337", conn2.baseUrl);
assert(!fs.existsSync(path.join(SEAT4, "gateway-descriptor.json")), "gd leftover after takeover");
const live = JSON.parse(fs.readFileSync(path.join(SEAT4, "sand-client-persistence", "live-thread.json"), "utf8"));
assert(live.value === "keep-me", "takeover must keep the open thread");
const model2 = JSON.parse(fs.readFileSync(path.join(ROOT, "model-config.json"), "utf8"));
assert(model2.proxyTarget === "cliproxy", model2.proxyTarget);
assert(model2.model === "grok-4.6", model2.model);
const agentsDir = path.join(HACK, "box-data", "agents");
const names = fs.readdirSync(agentsDir)
  .filter((id) => fs.existsSync(path.join(agentsDir, id, "profile.json")))
  .map((id) => JSON.parse(fs.readFileSync(path.join(agentsDir, id, "profile.json"), "utf8")).name);
assert(names.includes("Official release bot · Local"), names.join(","));
const continuationMeta = JSON.parse(
  fs.readFileSync(path.join(agentsDir, r2.continuation.id, "continuation.json"), "utf8")
);
assert(continuationMeta.source.agentId === "cccccccc-cccc-4ccc-8ccc-cccccccccccc", JSON.stringify(continuationMeta));
assert(r2.continuation.continueJob && fs.existsSync(r2.continuation.continueJob), JSON.stringify(r2.continuation));
assert(!fs.existsSync(path.join(ROOT, "runtime", "takeover.json")), "takeover payload was not consumed");
ok("continue-keeps-thread");

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${n}/2 apply-local checks passed`);
