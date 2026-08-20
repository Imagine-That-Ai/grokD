#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const ui = require("./fallover-ui");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(ui.ROWS.length === 4, "four rows");
assert(ui.ROWS[0].label === "Auto Failover", ui.ROWS[0].label);
assert(ui.ROWS[1].label === "Next Account", ui.ROWS[1].label);
assert(ui.ROWS[2].label === "Locally · Chief Handoff", ui.ROWS[2].label);
assert(ui.ROWS[3].label === "Locally · Continue", ui.ROWS[3].label);
assert(!/Local D/.test(ui.ROWS.map((r) => r.label + r.sub).join(" ")), "no Local D");
ok("labels");

const html = ui.rowHtml({ enabled: true, nextCursor: false }, (on) => on ? "ON" : "OFF");
assert(/Auto Failover/.test(html), "html label");
assert(/Master quota switch/.test(html), "sub");
assert(/data-fo="enabled"/.test(html), "key");
assert(/ON/.test(html) && /OFF/.test(html), "switches");
assert(/halts billing/.test(html), "tooltip");
assert(/cannot keep the same cloud thread/.test(ui.ROWS[3].tip), "clone tip is honest about cloud bots");
ok("html");

assert(ui.TOAST.localClone === "Locally · Continue", ui.TOAST.localClone);
assert(ui.TOAST.localChief === "Locally · Chief Handoff", ui.TOAST.localChief);
ok("toast");

console.log(`\n${n}/3 fallover-ui checks passed`);
