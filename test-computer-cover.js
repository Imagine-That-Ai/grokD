#!/usr/bin/env node
"use strict";
const cover = require("./computer-cover");

const assert = (c, m) => { if (!c) throw new Error(m); };
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(cover.pickAction({}) === "none", "empty");
assert(cover.pickAction({ overlay: false }) === "none", "no overlay");
assert(cover.pickAction({ overlay: true, hasRemote: true }) === "retry", "https VM retries");
assert(cover.pickAction({ overlay: true, retries: 9, hasRemote: true }) === "retry", "never auto-recover");
assert(cover.pickAction({ overlay: true, retries: 4, hasRemote: false }) === "none", "no VM: user Recover only");
assert(cover.pickAction({ overlay: true, healthy: true }) === "retry", "healthy overlay is retry");
ok("pick-action");

const paused = cover.lostCopy({ paused: true });
assert(/paused/i.test(paused.description), "paused copy");
assert(!/Recover Grok Bot/i.test(paused.description), "paused copy is not the scare card");
const live = cover.lostCopy({ paused: false });
assert(/Reconnecting/i.test(live.description), "live copy");
ok("copy");

function el(text, kids) {
  return {
    textContent: text,
    children: kids || [],
    querySelectorAll(sel) { return this._nodes || []; },
  };
}
const desc = el("Your Bots, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.");
const retryBtn = { textContent: "Retry" };
const recBtn = { textContent: "Recover Grok Bot's Computer" };
const dialog = {
  children: [desc],
  querySelectorAll(sel) {
    if (sel === "button") return [retryBtn, recBtn];
    return [desc];
  },
};
const doc = {
  querySelector(sel) {
    if (String(sel).includes("couldnt-reach") || String(sel).includes("lifecycle")) return dialog;
    return null;
  },
  querySelectorAll(sel) {
    if (sel === "button") return [retryBtn, recBtn];
    return [desc];
  },
};
assert(cover.overlayShowing(doc) === true, "overlay from recover button");
assert(cover.findRetry(doc) === retryBtn, "retry btn");
assert(cover.findRecover(doc) === recBtn, "recover btn");
assert(cover.restyleLostDialog(doc, { paused: false }) === true, "restyle");
assert(/Reconnecting/.test(desc.textContent), "replaced official scare copy");
ok("dom");

console.log(`\n${n}/${n} computer-cover groups passed`);
