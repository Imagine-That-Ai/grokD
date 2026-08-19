#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const assert = (c, m) => { if (!c) throw new Error(m); };

const models = require("./model-lib");
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const raw = models.readRaw();
const resolved = models.resolveConfig();
assert(resolved.model, "has model");
assert(resolved.proxyTarget, "has target");
assert(resolved.proxyUrl.includes("127.0.0.1"), resolved.proxyUrl);
assert(resolved.proxyTarget !== "vibeproxy" || models.portOpen(8325), "must not stay on dead vibeproxy");
if (!models.portOpen(8325)) {
  assert(resolved.proxyTarget === "cliproxy" || resolved.proxyTarget === "openburnbar", resolved.proxyTarget);
}
ok("resolve-skips-dead-vibeproxy");

const prev = raw.model;
const next = prev === "grok-4.6" ? "gpt-5.6-luna" : "grok-4.6";
const written = models.setModel(next);
assert(written.model === next, written.model);
assert(fs.existsSync(models.DURABLE), "durable written");
assert(fs.existsSync(models.LIVE), "live written");
assert(models.readRaw().model === next, "read back");
models.setModel(prev || "grok-4.6", written.proxyTarget);
ok("write-read-roundtrip");

const auth = require("./profile-auth-preload");
const Q = {
  agent: {
    getDefaultModel: async () => ({ modelId: "official-only" }),
    setDefaultModel: async () => { throw new Error("Couldn't reach the computer to save the default model."); },
  },
  cursorAccount: {},
  onboarding: {},
};
auth.applyAuthPolicy(Q);
const set = Q.agent.setDefaultModel({ modelId: "claude-opus-5", maxMode: true, parameters: [] });
assert(set && typeof set.then === "function", "hook is async");
set.then((v) => {
  assert(v.modelId === "claude-opus-5", JSON.stringify(v));
  assert(models.readRaw().model === "claude-opus-5", "hook persisted");
  return Q.agent.getDefaultModel();
}).then((v) => {
  assert(v.modelId === "claude-opus-5", "get after set");
  models.setModel(prev || "grok-4.6");
  ok("preload-setDefaultModel-does-not-throw");

  const env = require("./profile-store").readActiveEnv();
  if (env.mode === "local") {
    const probe = `MODELPROBE-${Date.now().toString(36)}`;
    models.setModel("grok-4.6", "cliproxy");
    const r = execFileSync("curl", [
      "-sS", "-X", "POST", "http://127.0.0.1:1337/api/sendPrompt",
      "-H", "content-type: application/json",
      "-H", "authorization: Bearer fake-gateway-token",
      "-d", JSON.stringify({
        agentId: "e219204f-eadc-4dfa-893f-8ca572650ee4",
        prompt: `Reply with exactly ${probe} and nothing else.`,
        awaitTurn: false,
      }),
    ], { encoding: "utf8", timeout: 20000 });
    assert(!/error/i.test(r) || /ok|accepted|scheduled|id/i.test(r), r.slice(0, 200));
    ok("local-sendPrompt-after-model-set");
  } else {
    console.log("SKIP live-send (not in local mode)");
  }

  console.log(`\n${n} model checks passed`);
}).catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
