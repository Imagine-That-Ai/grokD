#!/usr/bin/env node
"use strict";

const assert = (c, m) => { if (!c) throw new Error(m); };
const api = require("./splash/onboarding.js");
const modelLib = require("./model-lib.js");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

// 1. Blank state schema integrity
const s = api.blank();
assert(s.step === "choose" && !s.completed && !s.skipped, "blank state must start on choose");
assert(Array.isArray(s.cursorProfiles) && s.cursorProfiles.length === 0, "blank accounts array");
assert(s.proxyTarget === null && s.model === null, "blank model targets");
ok("blank-schema");

// 2. shouldShow lifecycle
const mem = {
  _s: { completed: false, skipped: false, step: "choose" },
  readState() { return this._s; },
  writeState(st) { this._s = st; },
};
assert(api.shouldShow(mem) === true, "show when pending");
mem._s.completed = true;
assert(api.shouldShow(mem) === false, "hide when completed");
mem._s.completed = false;
mem._s.skipped = true;
assert(api.shouldShow(mem) === false, "hide when skipped");

// Handling corrupted / empty host state
assert(api.shouldShow({ readState: () => null }) === true, "show when state is null");
assert(api.shouldShow({ readState: () => ({}) }) === true, "show when state is empty object");
ok("should-show-lifecycle");

// 3. OpenBurnBar health payload verification
assert(api.isOpenBurnBarHealthPayload({ status: "ok", service: "openburnbar-proxy", port: 8320 }, 8320) === true, "valid health payload");
assert(api.isOpenBurnBarHealthPayload({ status: "healthy", service: "openburnbar-proxy", port: 8320 }, 8320) === true, "healthy status variant");
assert(api.isOpenBurnBarHealthPayload({ status: "ok", service: "wrong-service", port: 8320 }, 8320) === false, "reject wrong service");
assert(api.isOpenBurnBarHealthPayload({ status: "ok", service: "openburnbar-proxy", port: 9999 }, 8320) === false, "reject wrong port");
assert(api.isOpenBurnBarHealthPayload(null, 8320) === false, "null payload safe");
ok("openburnbar-health-signature");

// 4. August 2026 Models Catalog & LobeHub Provider verification
const models = modelLib.CURATED;
assert(Array.isArray(models) && models.length >= 8, "CURATED models roster must be populated");

const requiredModels = [
  "grok-4.6",
  "gpt-5.6-luna",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "deepseek/deepseek-v4-flash",
  "gemini-2.5-pro",
  "kimi/k3",
  "grok-composer-2.5-fast",
];

requiredModels.forEach((id) => {
  const found = models.find((m) => m.id === id);
  assert(found != null, `Must include August 2026 model ${id}`);
  assert(typeof found.name === "string" && found.name.length > 0, `Model ${id} must have a display name`);
  assert(typeof found.provider === "string" && found.provider.length > 0, `Model ${id} must declare provider`);
  assert(typeof found.tag === "string" && found.tag.length > 0, `Model ${id} must declare capability tag`);
});
ok("august-2026-models-catalog");

// 5. Host API Model Configuration sync
const defCfg = modelLib.defaultConfig();
assert(defCfg.model === "grok-4.6", "default model is grok-4.6");
assert(defCfg.proxyTarget === "openburnbar", "default proxy target is openburnbar");
ok("model-config-defaults");

console.log(`\n${n}/${n} onboarding verification groups passed`);
