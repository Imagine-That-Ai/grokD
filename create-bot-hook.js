// Official "Create new Bot" / Create "Name" goes through the Sand coordinator.
// Preload has no window.desktop (contextBridge is page-world only). Never read
// desktop.agent here — a throw in capture-phase kills the official click.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ENV = path.join(os.homedir(), ".grok", "grokbot-d", "active-env.json");

function mode() {
  try { return JSON.parse(fs.readFileSync(ENV, "utf8")).mode || "local"; }
  catch { return "local"; }
}

function labelOf(el) {
  if (!el) return "";
  const aria = el.getAttribute && el.getAttribute("aria-label");
  return String(aria || el.textContent || "").replace(/\s+/g, " ").trim();
}

function quotedCreateName(label) {
  const m = String(label || "").match(/^Create\s+[“"'](.+?)[”"']$/i);
  return m ? m[1].trim() : "";
}

function typedName(doc) {
  const root = doc || (typeof document !== "undefined" ? document : null);
  if (!root || !root.querySelector) return "";
  const search = root.querySelector("input[placeholder*='Search or create'], input[aria-label*='Search or create']");
  if (search && String(search.value || "").trim()) return String(search.value).trim();
  const nodes = root.querySelectorAll ? root.querySelectorAll("input, [contenteditable='true']") : [];
  for (const el of nodes) {
    const lab = String((el.getAttribute && el.getAttribute("aria-label")) || el.placeholder || "");
    if (!/to:|name/i.test(lab)) continue;
    const v = String(el.value || el.innerText || "").replace(/^To:\s*/i, "").trim();
    if (v) return v;
  }
  const chips = root.querySelectorAll ? root.querySelectorAll("button, [role='option']") : [];
  for (const el of chips) {
    const n = quotedCreateName(labelOf(el));
    if (n) return n;
  }
  return "";
}

function isCreateTarget(el, doc) {
  if (!el) return null;
  let node = el;
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const label = labelOf(node);
    const quoted = quotedCreateName(label);
    if (quoted) return { el: node, name: quoted };
    if (/^Create new Bot$/i.test(label)) return { el: node, name: typedName(doc) || "New Bot" };
    if (/^New chat draft:/i.test(label)) {
      const n = typedName(doc);
      if (n) return { el: node, name: n };
    }
    const isBtn = node.tagName === "BUTTON" || (node.getAttribute && node.getAttribute("role") === "button");
    if (/^Create new$/i.test(label) && isBtn) {
      const n = typedName(doc);
      if (n) return { el: node, name: n };
    }
  }
  return null;
}

function createViaBox(name) {
  const body = JSON.stringify({
    name: name || "New Bot",
    description: "",
    origin: "user",
  });
  const raw = execFileSync("curl", [
    "-sS", "-X", "POST", "http://127.0.0.1:1337/api/createAgent",
    "-H", "content-type: application/json",
    "-H", "authorization: Bearer fake-gateway-token",
    "-d", body,
  ], { encoding: "utf8", timeout: 12000 });
  return JSON.parse(raw);
}

function reconnect() {
  try {
    const { webFrame } = require("electron");
    if (!webFrame || !webFrame.executeJavaScript) return;
    webFrame.executeJavaScript(`(async()=>{
      try { if (window.desktop && window.desktop.forceGatewayReconnect) await window.desktop.forceGatewayReconnect(); } catch (e) {}
      try {
        const aw = window.desktop && window.desktop.appWindow;
        if (aw && aw.forceReconnectGateway) aw.forceReconnectGateway();
      } catch (e) {}
    })()`, true).catch(() => {});
  } catch (e) {}
}

function toast(msg) {
  try { if (typeof window !== "undefined" && window.__gdToast) window.__gdToast(msg); } catch (e) {}
}

function createNamed(name) {
  const r = createViaBox(name);
  const nm = (r && r.agent && r.agent.name) || name;
  toast("Created " + nm);
  reconnect();
  return r;
}

function start() {
  if (typeof document === "undefined") return;
  if (document.documentElement._gdCreateBotHook) return;
  document.documentElement._gdCreateBotHook = true;
  document.addEventListener("click", (e) => {
    try {
      if (mode() !== "local") return;
      const hit = isCreateTarget(e.target, document);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (hit.el._gdCreating) return;
      hit.el._gdCreating = true;
      try { createNamed(hit.name); }
      catch (err) { toast("Create bot failed: " + (err.message || err)); }
      finally { hit.el._gdCreating = false; }
    } catch (err) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[create-bot] " + err + "\n"); } catch (e) {}
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    try {
      if (mode() !== "local") return;
      if (e.key !== "Enter" && e.key !== "Tab") return;
      const name = typedName(document);
      if (!name) return;
      const chip = [...document.querySelectorAll("button, [role='option']")]
        .find((el) => quotedCreateName(labelOf(el)));
      if (!chip) return;
      const ae = document.activeElement;
      const inComposer = !!(ae && (ae.matches && (ae.matches("input") || ae.matches("[contenteditable='true']"))));
      if (!inComposer && e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (chip._gdCreating) return;
      chip._gdCreating = true;
      try { createNamed(name); }
      catch (err) { toast("Create bot failed: " + (err.message || err)); }
      finally { chip._gdCreating = false; }
    } catch (err) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[create-bot-key] " + err + "\n"); } catch (e) {}
    }
  }, true);
}

module.exports = {
  start, createViaBox, isCreateTarget, quotedCreateName, typedName, labelOf, mode,
};
