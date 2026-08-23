// Official "Create new Bot" / Create "Name" goes through the Sand coordinator.
// Preload has no window.desktop (contextBridge is page-world only). Never read
// desktop.agent here — a throw in capture-phase kills the official click.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const secGuard = require("./security-guard");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const ENV = path.join(ROOT, "active-env.json");

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

function createViaBoxAsync(name) {
  return new Promise((resolve, reject) => {
    const http = require("http");
    const payload = JSON.stringify({
      name: name || "New Bot",
      description: "",
      origin: "user",
    });
    // Mint narrowly-scoped session token for bot creation only
    const token = secGuard.mintSessionJwt({ audience: "bot-create", expiresInSeconds: 15 });
    const req = http.request({
      hostname: "127.0.0.1",
      port: 1337,
      path: "/api/createAgent",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "content-length": Buffer.byteLength(payload),
      },
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Server error ${res.statusCode}: ${text.slice(0, 100)}`));
        }
        try {
          const json = JSON.parse(text);
          if (!json || (!json.agent && !json.id)) {
            return reject(new Error("Invalid server response"));
          }
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.write(payload);
    req.end();
  });
}

function createViaBox(name) {
  // Sync fallback helper for CLI tests
  const syncExec = require("child_process").execFileSync;
  const data = JSON.stringify({ name: name || "New Bot", description: "", origin: "user" });
  const token = secGuard.mintSessionJwt({ audience: "bot-create", expiresInSeconds: 15 });
  const script = `
    const http = require("http");
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const req = http.request({
        hostname: "127.0.0.1",
        port: 1337,
        path: "/api/createAgent",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer " + input.token,
          "content-length": Buffer.byteLength(input.data),
        },
        timeout: 3500,
      }, (res) => {
        let b = "";
        res.on("data", (c) => b += c);
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error("HTTP " + res.statusCode);
            process.exit(1);
          }
          console.log(b);
        });
      });
      req.on("error", (e) => { console.error(e.message); process.exit(1); });
      req.write(input.data);
      req.end();
    });
  `;
  const raw = syncExec("node", ["-e", script], {
    input: JSON.stringify({ token, data }),
    cwd: __dirname,
    encoding: "utf8",
    timeout: 4000,
  });
  return JSON.parse(raw.trim());
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

async function createNamed(name) {
  try {
    const r = await createViaBoxAsync(name);
    const nm = (r && r.agent && r.agent.name) || name;
    toast("Created " + nm);
    reconnect();
    return r;
  } catch (err) {
    toast("Create bot failed: " + (err.message || err));
    throw err;
  }
}

function start() {
  if (typeof document === "undefined") return;
  if (document.documentElement._gdCreateBotHook) return;
  document.documentElement._gdCreateBotHook = true;
  document.addEventListener("click", async (e) => {
    try {
      if (e && e.isTrusted === false) return;
      if (mode() !== "local") return;
      const hit = isCreateTarget(e.target, document);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (hit.el._gdCreating) return;
      hit.el._gdCreating = true;
      try { await createNamed(hit.name); }
      catch { /* createNamed already toasted */ }
      finally { hit.el._gdCreating = false; }
    } catch (err) {
      try { fs.appendFileSync(path.join(ROOT, "runtime", "renderer.log"), "[create-bot] " + err + "\n"); } catch (e) {}
    }
  }, true);
  document.addEventListener("keydown", async (e) => {
    try {
      if (e && e.isTrusted === false) return;
      if (mode() !== "local") return;
      if (e.key !== "Enter" && e.key !== "Tab") return;
      const ae = document.activeElement;
      const isSearchInput = ae && (ae.matches && ae.matches("input[placeholder*='Search or create'], input[aria-label*='Search or create']"));
      if (!isSearchInput) return;

      const name = typedName(document);
      if (!name) return;
      const chip = [...document.querySelectorAll("button, [role='option']")]
        .find((el) => quotedCreateName(labelOf(el)));
      if (!chip) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (chip._gdCreating) return;
      chip._gdCreating = true;
      try { await createNamed(name); }
      catch { /* createNamed already toasted */ }
      finally { chip._gdCreating = false; }
    } catch (err) {
      try { fs.appendFileSync(path.join(ROOT, "runtime", "renderer.log"), "[create-bot-key] " + err + "\n"); } catch (e) {}
    }
  }, true);
}

module.exports = {
  start, createViaBox, isCreateTarget, quotedCreateName, typedName, labelOf, mode,
  createNamed, reconnect,
};
