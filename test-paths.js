#!/usr/bin/env node
"use strict";
const path = require("path");
const paths = require("./paths");
const assert = (c, m) => { if (!c) throw new Error(m); };
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const c = paths.appCandidates();
assert(c.some((p) => p.endsWith(path.join("Applications", 'grok"D".app'))), "prefers grok\"D\".app");
const bundle = paths.appBundle();
assert(paths.appCandidates().includes(bundle), "appBundle must be one of the registered appCandidates");
assert(bundle.endsWith(".app"), "appBundle must point to an .app bundle directory");
ok("app-bundle-candidates");

console.log(`\n${n}/${n} paths groups passed`);
