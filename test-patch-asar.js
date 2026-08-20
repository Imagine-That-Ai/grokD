#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const patch = require("./patch-asar");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const r1 = patch.tryReplace("abc", "b", "B", "x");
assert(r1.status === "patched" && r1.text === "aBc", r1.text);
ok("exact-patch");

const r2 = patch.tryReplace("aBc", "b", "B", "x");
assert(r2.status === "already", r2.status);
ok("already");

const r3 = patch.tryReplace("aaa", "zzz", "Q", "x");
assert(r3.status === "skipped" && r3.reason === "no-match", r3.reason);
ok("no-match-does-not-throw");

const r4 = patch.tryReplace("xx xx", "xx", "Y", "x");
assert(r4.status === "skipped" && /ambiguous/.test(r4.reason), r4.reason);
ok("ambiguous-skip");

const fuzzy = patch.fuzzyIpn('return{identity:r,access:await t.readAccess().catch(s3s)}');
assert(fuzzy.status === "patched" && /granted/.test(fuzzy.text), fuzzy.text);
ok("fuzzy-ipn");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-asar-"));
const mainFile = path.join(tmp, "main.cjs");
const preFile = path.join(tmp, "preload.cjs");
fs.writeFileSync(mainFile, "console.log('stock')\n");
fs.writeFileSync(preFile, "console.log('pre')\n");
const report = patch.applyPatches({ mainPath: mainFile, preloadPath: preFile });
assert(report.ok === true, JSON.stringify(report));
assert(report.preloadHook === "patched", report.preloadHook);
assert(fs.readFileSync(preFile, "utf8").includes("profile-ui-inject.js"), "hook landed");
assert(report.IPn === "skipped", "Expected IPn to be skipped on stock main: " + report.IPn);
const ipnMain = path.join(tmp, "main-ipn.cjs");
fs.writeFileSync(ipnMain, "return{identity:r,access:await t.readAccess().catch(s3s)}\n");
const reportIpn = patch.applyPatches({ mainPath: ipnMain, preloadPath: preFile });
assert(reportIpn.IPn === "patched", "Expected IPn patch on matching pattern: " + reportIpn.IPn);
ok("preload-survives-missing-ipn");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/6 patch-asar checks passed`);
