#!/usr/bin/env node
// Type into D's composer and click Send. Used by the seat matrix.
"use strict";
const { execFileSync } = require("child_process");
const path = require("path");
const CDP = path.join(__dirname, "cdp-eval.js");

function evalJs(expr) {
  const out = execFileSync(process.execPath, [CDP, expr], { encoding: "utf8", timeout: 12000 });
  const j = JSON.parse(out);
  return (j && j.result && "value" in j.result) ? j.result.value : j;
}

function send(text, token, timeoutMs = 70000) {
  const typed = evalJs(`(function(){
    const el = document.querySelector("[contenteditable=true]") || document.querySelector("[role=textbox]") || document.querySelector("textarea");
    if (!el) return { ok:false, err:"no composer" };
    el.focus();
    try { document.execCommand("selectAll"); } catch (e) {}
    try { document.execCommand("insertText", false, ${JSON.stringify(text)}); } catch (e) {}
    if (!(el.innerText || el.value || "").includes(${JSON.stringify(token || text.slice(0, 8))})) {
      if ("value" in el) el.value = ${JSON.stringify(text)};
      else el.textContent = ${JSON.stringify(text)};
      el.dispatchEvent(new InputEvent("input", { bubbles:true, data:${JSON.stringify(text)}, inputType:"insertText" }));
    }
    return { ok:true, typed:true };
  })()`);
  if (!typed || !typed.ok) return { ok: false, typed };
  execFileSync("sleep", ["0.25"]);
  const clicked = evalJs(`(function(){
    const sels = [
      "button[aria-label='Send message']",
      "button[type='submit']",
      "button[aria-label*='Send' i]",
    ];
    let btn = null;
    for (const s of sels) { btn = document.querySelector(s); if (btn) break; }
    if (!btn) btn = [...document.querySelectorAll("button")].find((b) => /send/i.test(b.getAttribute("aria-label") || ""));
    if (btn) { btn.click(); return { clicked:true }; }
    const el = document.querySelector("[contenteditable=true]") || document.querySelector("[role=textbox]");
    if (el) el.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", code:"Enter", keyCode:13, which:13, bubbles:true }));
    return { clicked:false };
  })()`);
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    const snap = evalJs(`(function(){
      const t = document.body ? document.body.innerText : "";
      return { t, rec:/Will send when reconnected/.test(t), working:/is working/i.test(t) };
    })()`);
    const body = (snap && snap.t) || "";
    const idx = body.lastIndexOf(token);
    if (idx >= 0) {
      const after = body.slice(idx + token.length);
      if (after.includes(token) || /is working/i.test(after) || after.length > last.length + 12) {
        if (after.includes(token) || Date.now() - t0 > 8000) {
          return { ok: after.includes(token) || snap.working, typed, rec: snap.rec, matched: after.includes(token), tokenLen: token.length };
        }
      }
      last = after;
    }
    execFileSync("sleep", ["1"]);
  }
  return { ok: false, typed, timeout: true };
}

if (require.main === module) {
  const text = process.argv[2];
  const token = process.argv[3] || (text || "").slice(0, 12);
  if (!text) {
    console.error("usage: cdp-send.js <text> [token]");
    process.exit(2);
  }
  console.log(JSON.stringify(send(text, token), null, 2));
}

module.exports = { send, evalJs };
