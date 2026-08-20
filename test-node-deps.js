#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const deps = require("./node-deps");
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(Array.isArray(deps.candidates()) && deps.candidates().length >= 4, "candidates");
ok("candidates");

const env = deps.applyNodePath({ PATH: "/usr/bin" });
const found = deps.resolveNodeDeps();
if (found) {
  assert(env.NODE_PATH && env.NODE_PATH.indexOf("tree-sitter") === -1, "path is deps root");
  assert(env.NODE_PATH.indexOf("app.asar.unpacked") >= 0 || env.NODE_PATH === found, env.NODE_PATH);
  ok("apply-when-present");
} else {
  assert(!env.NODE_PATH, "no path when missing");
  ok("apply-when-absent");
}

console.log(`\n${n}/2 node-deps checks passed`);
