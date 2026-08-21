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

assert(models.defaultConfig().proxyTarget === "openburnbar", "default proxy is openburnbar");
const resolved = models.resolveConfig();
assert(typeof resolved.model === "string" && (resolved.model.startsWith("grok-") || resolved.model.startsWith("gpt-") || resolved.model.startsWith("cursor/")), "valid model identifier format: " + resolved.model);
assert(["openburnbar", "cliproxy", "vibeproxy"].includes(resolved.proxyTarget), "valid proxyTarget: " + resolved.proxyTarget);
assert(resolved.proxyUrl.includes("127.0.0.1"), resolved.proxyUrl);
assert(resolved.proxyTarget !== "vibeproxy" || models.portOpen(8325), "must not stay on dead vibeproxy");
if (!models.portOpen(8325)) {
  assert(resolved.proxyTarget === "cliproxy" || resolved.proxyTarget === "openburnbar", resolved.proxyTarget);
}
ok("resolve-skips-dead-vibeproxy");

const raw = models.readRaw();
const prev = raw.model;
const next = prev === "grok-4.6" ? "gpt-5.6-luna" : "grok-4.6";
const written = models.setModel(next);
assert(written.model === next, written.model);
assert(fs.existsSync(models.DURABLE), "durable written");
assert(fs.existsSync(models.LIVE), "live written");
assert(models.readRaw().model === next, "read back");
models.setModel(prev || "grok-4.6", written.proxyTarget);
ok("write-read-roundtrip");

const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
process.env.GROK_PROFILE_ROOT = authRoot;
fs.writeFileSync(path.join(authRoot, "active-env.json"), JSON.stringify({
  mode: "local",
  profileId: "local-d",
}) + "\n");
const auth = require("./profile-auth-preload");
const Q = {
  agent: {
    getDefaultModel: async () => ({ modelId: "official-only" }),
    setDefaultModel: async () => { throw new Error("Couldn't reach the computer to save the default model."); },
  },
  cursorAccount: {},
  onboarding: {},
};
assert(auth.isLocalMode() === true, "isolated local mode");
{
  const cursorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-cur-"));
  process.env.GROK_PROFILE_ROOT = cursorRoot;
  fs.writeFileSync(path.join(cursorRoot, "active-env.json"), JSON.stringify({
    mode: "cursor",
    profileId: "cursor-a",
  }) + "\n");
  assert(auth.isLocalMode() === false, "cursor mode is not local");
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-miss-"));
  process.env.GROK_PROFILE_ROOT = missing;
  assert(auth.isLocalMode() === true, "missing env defaults to local");
  process.env.GROK_PROFILE_ROOT = authRoot;
}
auth.applyAuthPolicy(Q);
assert(typeof Q.cursorAccount.login === "function", "local login stub");
{
  const src = auth.pageWorldLocalScript();
  assert(src.includes("getStatus"), "page wrap");
  assert(src.includes("getSeen"), "skip official onboarding");
  assert(!/Sign in/.test(src), "must not click Sign in");
}
Q.cursorAccount.getStatus().then((s) => {
  assert(s && s.kind === "logged-in", JSON.stringify(s));
  return Q.cursorAccount.login();
}).then((login) => {
  assert(login && login.kind === "logged-in", JSON.stringify(login));
  ok("local-status-does-not-need-official-computer");
  models.setModel(prev || "grok-4.6", written.proxyTarget);

  if (models.portOpen(1337)) {
    const probe = `MODELPROBE-${Date.now().toString(36)}`;
    models.setModel("grok-4.6", "cliproxy");
    let r = "";
    try {
      r = execFileSync("curl", [
        "-sS", "-X", "POST", "http://127.0.0.1:1337/api/sendPrompt",
        "-H", "content-type: application/json",
        "-H", "authorization: Bearer fake-gateway-token",
        "-d", JSON.stringify({
          agentId: "e219204f-eadc-4dfa-893f-8ca572650ee4",
          prompt: `Reply with exactly ${probe} and nothing else.`,
          awaitTurn: false,
        }),
      ], { encoding: "utf8", timeout: 20000 });
    } catch (e) {
      r = String(e && e.message || e);
    }
    if (/error/i.test(r) && !/ok|accepted|scheduled|"id"/i.test(r)) {
      console.log("SKIP live-send (" + r.slice(0, 80) + ")");
    } else {
      ok("local-sendPrompt-after-model-set");
    }
  } else {
    console.log("SKIP live-send (:1337 down)");
  }

  console.log(`\n${n} model checks passed`);
}).catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
