#!/usr/bin/env node
// One-shot: are the saved Cursor computers reachable? Recover if not.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { execFileSync } = require("child_process");

const HOME = os.homedir();
const ROOT = path.join(HOME, ".grok", "grokbot-d");
const SEAT4 = path.join(HOME, "Library/Application Support/GrokBotSeat4");

const secGuard = require("./security-guard");

function readUrl(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || typeof j.baseUrl !== "string") return null;
    const u = j.baseUrl;
    if (u === "http://127.0.0.1:1337" || u === "http://localhost:1337") {
      return u;
    }
    if (secGuard.isApprovedRemoteComputerDescriptor(u)) {
      return u;
    }
    return null;
  } catch { return null; }
}

async function probe(url) {
  if (!url || typeof url !== "string") return { code: 0, body: "no-url" };
  let u;
  try {
    u = new URL(url.replace(/\/$/, "") + "/health");
  } catch {
    return { code: 0, body: "invalid-url" };
  }

  const isLocal = (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.protocol === "http:" && u.port === "1337";
  if (!isLocal) {
    if (u.protocol !== "https:" || !secGuard.isApprovedRemoteComputerDescriptor(url)) {
      return { code: 0, body: "unapproved-descriptor" };
    }
    const pinnedIp = await secGuard.resolveAndCheckHost(u.hostname);
    if (!pinnedIp) {
      return { code: 0, body: "dns-rebind-rejected" };
    }
    return new Promise((resolve) => {
      let settled = false;
      let hardTimer;
      let req;
      const done = (res) => {
        if (settled) return;
        settled = true;
        if (hardTimer) clearTimeout(hardTimer);
        resolve(res);
      };
      hardTimer = setTimeout(() => {
        try { if (req) req.destroy(); } catch (_) {}
        done({ code: 0, body: "timeout" });
      }, 6500);

      req = https.get({
        protocol: "https:",
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        lookup: (_hostname, _options, callback) => callback(null, pinnedIp, 4),
        headers: { host: u.host, accept: "application/json" },
        timeout: 6000,
        servername: u.hostname,
      }, (res) => {
        res.resume();
        done({ code: res.statusCode, body: res.statusCode === 200 || res.statusCode === 204 ? "ok" : "not-ok" });
      });
      req.on("timeout", () => { req.destroy(); done({ code: 0, body: "socket-timeout" }); });
      req.on("error", (e) => done({ code: 0, body: "connection-error" }));
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let hardTimer;
    let req;
    const done = (res) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      resolve(res);
    };
    hardTimer = setTimeout(() => {
      try { if (req) req.destroy(); } catch (_) {}
      done({ code: 0, body: "timeout" });
    }, 4000);

    req = http.get("http://127.0.0.1:1337/health", { timeout: 3500 }, (res) => {
      res.resume();
      done({ code: res.statusCode, body: res.statusCode === 200 ? "ok" : "not-ok" });
    });
    req.on("timeout", () => { req.destroy(); done({ code: 0, body: "socket-timeout" }); });
    req.on("error", () => done({ code: 0, body: "connect-refused" }));
  });
}

function cdp(expr, timeoutMs = 8000) {
  const pages = JSON.parse(execFileSync("curl", ["-sS", "--max-time", "2", "http://127.0.0.1:9224/json"], { encoding: "utf8" }));
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no CDP page");
  const script = `
    const WS = typeof WebSocket !== "undefined" ? WebSocket : require("ws");
    const ws = new WS(${JSON.stringify(page.webSocketDebuggerUrl)});
    ws.addEventListener("error", (e) => { console.error(e); process.exit(1); });
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: ${JSON.stringify(expr)}, awaitPromise: true, returnByValue: true },
      }));
    });
    const t = setTimeout(() => { console.error("cdp-timeout"); process.exit(1); }, ${timeoutMs});
    ws.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : ev;
      const msg = JSON.parse(raw);
      if (msg.id !== 1) return;
      clearTimeout(t);
      ws.close();
      console.log(JSON.stringify((msg.result && msg.result.result && msg.result.result.value) || msg.result || null));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: timeoutMs + 2000,
  }));
}

async function main() {
  const boxes = {
    A: readUrl(path.join(ROOT, "profile-data", "cursor-a", "sand-data", "local-exec-daemon-connection.json"))
      || readUrl(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json")),
    B: readUrl(path.join(ROOT, "profile-data", "cursor-b", "sand-data", "local-exec-daemon-connection.json")),
    C: readUrl(path.join(ROOT, "profile-data", "cursor-c", "sand-data", "local-exec-daemon-connection.json")),
    Dlive: readUrl(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json")),
    local: "http://127.0.0.1:1337",
  };
  const report = { ts: Date.now(), ping: {}, ui: null, after: {} };
  for (const [k, u] of Object.entries(boxes)) {
    report.ping[k] = Object.assign({ url: u }, await probe(u));
  }
  try {
    report.ui = cdp(`(async()=>{
      const s = await window.desktop.cursorAccount.getStatus();
      let usage = null;
      try { usage = await window.desktop.cursorAccount.getUsageSummary(); }
      catch (e) { usage = String(e && e.message || e); }
      const t = document.body.innerText || "";
      const rec = [...document.querySelectorAll("button")].find((b) => /Recover Grok Bot/i.test(b.textContent || ""));
      return {
        kind: s && s.kind, authId: s && s.authId,
        usage: typeof usage === "string" ? usage.slice(0, 120) : usage,
        recover: /Couldn.?t Reach|Recover Grok Bot/i.test(t),
        clicked: false,
        recoverVisible: !!rec,
      };
    })()`, 20000);
  } catch (e) {
    report.ui = { error: String(e.message || e) };
  }
  await new Promise((r) => setTimeout(r, 4000));
  report.after.Dlive = Object.assign(
    { url: readUrl(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json")) },
    await probe(readUrl(path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json")))
  );
  console.log(JSON.stringify(report, null, 2));
  const live = report.after.Dlive;
  const ok = live && live.code && live.code >= 200 && live.code < 400 && !/not be routed/i.test(live.body || "");
  process.exit(ok ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
