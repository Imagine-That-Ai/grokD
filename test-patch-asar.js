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

{
  const v23 = 'Dc.markPhase("auth_service");let d=await CE(),m=uJn({getStatus:()=>d.getStatus()';
  const w = patch.fuzzyWrapAuth(v23);
  assert(w.status === "patched", w.status);
  assert(w.text.includes("wrapMainAuth"), w.text);
  assert(w.text.includes("let m=uJn"), "kept membership bind: " + w.text);
  const v20 = 'Ic.markPhase("auth_service");let a=await u2(),l=FOn({getStatus:()=>a.getStatus()';
  const w2 = patch.fuzzyWrapAuth(v20);
  assert(w2.status === "patched" && w2.text.includes("wrapMainAuth"), w2.text);
  ok("fuzzy-wrap-auth-0.23");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-asar-"));
const mainFile = path.join(tmp, "main.cjs");
const preFile = path.join(tmp, "preload.cjs");
fs.writeFileSync(mainFile, "console.log('stock')\n");
fs.writeFileSync(preFile, "console.log('pre')\n");
const reportDefault = patch.applyPatches({ mainPath: mainFile, preloadPath: preFile });
assert(reportDefault.ok === false, "Default applyPatches must fail closed when mandatory patches are missing");
const report = patch.applyPatches({ mainPath: mainFile, preloadPath: preFile, requireAll: false });
assert(report.ok === true, JSON.stringify(report));
assert(report.preloadHook === "patched" || report.preloadHook === "already", report.preloadHook);
assert(fs.readFileSync(preFile, "utf8").includes("profile-ui-inject.js"), "hook landed");
assert(report.IPn === "skipped", "Expected IPn to be skipped on stock main: " + report.IPn);
const ipnMain = path.join(tmp, "main-ipn.cjs");
fs.writeFileSync(ipnMain, "return{identity:r,access:await t.readAccess().catch(s3s)}\n");
const reportIpn = patch.applyPatches({ mainPath: ipnMain, preloadPath: preFile, requireAll: false });
assert(reportIpn.IPn === "patched", "Expected IPn patch on matching pattern: " + reportIpn.IPn);
ok("preload-survives-missing-ipn");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/7 patch-asar checks passed`);
