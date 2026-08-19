#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const { extractIndex, scopeCss, hardenScript } = require("./splash-extract");

const html = fs.readFileSync(path.join(__dirname, "splash", "index.html"), "utf8");
const { style, stage, script } = extractIndex(html);
assert(style.includes("--font-grok") || style.includes("grokd-splash-stage"), "style");
assert(stage.includes("mascot-creature-head"), "new mascot");
assert(stage.includes("naked-stud") || stage.includes("nstud-"), "stud logos");
assert(!stage.includes("boot sequence · click/drag"), "not the old control-bar splash");
assert(script.includes("class GrokDSplash"), "controller");
assert(script.includes("animateTwoLiveOrbsCasino") || script.includes("d-shivering"), "new timeline");
ok("extract-new-splash");

const css = scopeCss("*\n{margin:0}\nbody, html { height:100%; overflow:hidden; }\n.foo{color:red}");
assert(!/\*\s*\{/.test(css), "no global star");
assert(!/body,\s*html/.test(css), "no body html");
assert(css.includes(".grokd-splash-stage"), "scoped");
ok("scope-css");

const hard = hardenScript('if (card) card.className = "mascot-creature-head";\nlet splashInstance = new GrokDSplash();');
assert(hard.includes('setAttribute("class", "mascot-creature-head")'), hard);
assert(hard.includes("window.__grokDSplashInstance"), "instance");
ok("harden");

function ok(name) { console.log("PASS ", name); }
console.log("\n3/3 splash-extract groups passed");
