// After the sky landing: open the official chat surface (agent list, composer,
// or a thread). Hiding the landing without this leaves a black window.
"use strict";

function textOf(el) {
  if (!el) return "";
  const aria = el.getAttribute && el.getAttribute("aria-label");
  return String(aria || el.textContent || "").replace(/\s+/g, " ").trim();
}

function isShown(el) {
  let n = el;
  for (let i = 0; n && i < 16; i++) {
    if (n.style && n.style.display === "none") return false;
    n = n.parentElement || n.parentNode || null;
  }
  return !!el;
}

function chatSurface(doc) {
  doc = doc || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.querySelector !== "function") {
    return { composer: false, agent: false, thread: false, ok: false };
  }
  const composerEl = doc.querySelector('[contenteditable="true"]')
    || doc.querySelector('[role="textbox"]')
    || doc.querySelector("textarea");
  const agentEl = doc.querySelector(".sand-agent-item");
  const threadEl = doc.querySelector("[class*='transcript']")
    || doc.querySelector("[class*='message-list']");
  const composer = isShown(composerEl);
  const agent = isShown(agentEl);
  const thread = isShown(threadEl);
  return { composer, agent, thread, ok: !!(composer || agent || thread) };
}

function clickFirst(doc, sel) {
  const el = doc.querySelector(sel);
  if (el && typeof el.click === "function") {
    el.click();
    return el;
  }
  return null;
}

function clickLabeled(doc, re) {
  let nodes = [];
  try { nodes = doc.querySelectorAll("button, [role='button'], a"); } catch (_) { return ""; }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const t = textOf(n);
    if (re.test(t)) {
      if (typeof n.click === "function") n.click();
      return t;
    }
  }
  return "";
}

function revealLandings(doc) {
  let nodes = [];
  try { nodes = doc.querySelectorAll(".sand-access-cover, .sand-onboarding__landing"); } catch (_) { return 0; }
  let n = 0;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.style && el.style.display === "none") {
      el.style.display = "";
      n += 1;
    }
    if (el.removeAttribute) el.removeAttribute("aria-hidden");
  }
  return n;
}

function enterChat(doc, opts) {
  opts = opts || {};
  doc = doc || (typeof document !== "undefined" ? document : null);
  if (!doc) return { action: "no-doc", ok: false };
  const have = chatSurface(doc);
  if (have.ok) {
    if (typeof opts.onOpen === "function") opts.onOpen(have);
    return { action: "already", ok: true, composer: have.composer, agent: have.agent, thread: have.thread };
  }
  revealLandings(doc);
  if (clickFirst(doc, ".sand-agent-item")) {
    return { action: "clicked-agent", ok: false };
  }
  const created = clickLabeled(doc, /^Create new Bot$/i) || clickLabeled(doc, /^Create new$/i);
  if (created) return { action: "clicked-create", label: created, ok: false };
  if (typeof opts.createNamed === "function") {
    try {
      opts.createNamed("New Bot");
      return { action: "box-create", ok: false };
    } catch (e) {
      return { action: "create-failed", ok: false, error: String(e && e.message || e) };
    }
  }
  return { action: "no-target", ok: false };
}

module.exports = { chatSurface, enterChat, revealLandings, textOf };
