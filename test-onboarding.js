#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const api = require("./splash/onboarding.js");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const s = api.blank();
assert(s.step === "choose" && !s.completed && !s.skipped, "blank");
ok("blank");

const mem = {
  _s: { completed: false, skipped: false, step: "choose" },
  readState() { return this._s; },
  writeState() {},
};
assert(api.shouldShow(mem) === true, "show when open");
mem._s.completed = true;
assert(api.shouldShow(mem) === false, "hide when done");
mem._s.completed = false;
mem._s.skipped = true;
assert(api.shouldShow(mem) === false, "hide when skipped");
ok("should-show");

console.log(`\n${n}/${n} onboarding groups passed`);
