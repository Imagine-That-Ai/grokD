#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const lg = require("./liquid-glass-btn");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(typeof lg.start === "function" && typeof lg.stop === "function", "api");
assert(lg.start(null) === false, "no root");
ok("api");

assert(lg.FRAG.includes("sdRoundBox"), "sdf");
assert(lg.FRAG.includes("dFdx"), "volume normals");
assert(lg.FRAG.includes("1.14") && lg.FRAG.includes("0.86"), "chromatic split");
assert(lg.FRAG.includes("uMouse"), "cursor light");
assert(lg.FRAG.includes("uHover") && lg.FRAG.includes("uPress"), "spring hover/press");
assert(/cau/.test(lg.FRAG), "caustics");
assert(!lg.FRAG.includes("backdrop"), "not a blur panel");
ok("shader");

lg.stop();
console.log(`\n${n}/2 liquid-glass-btn checks passed`);
