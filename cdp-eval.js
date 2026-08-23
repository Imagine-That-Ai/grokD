#!/usr/bin/env node
"use strict";
const http = require("http");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(c).toString("utf8"))); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function decodeExpression(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0 && !trimmed.includes(" ")) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      if (decoded && (decoded.includes("(") || decoded.includes(";") || decoded.includes("function") || decoded.includes("return") || decoded.includes("document") || decoded.includes("{") || decoded.includes("."))) {
        return decoded;
      }
    } catch (_) {}
  }
  return raw;
}

async function main() {
  const rawExpr = process.argv[2];
  if (!rawExpr) {
    console.error("usage: cdp-eval.js <js>");
    process.exit(2);
  }
  const expr = decodeExpression(rawExpr);
  const pages = await get("http://127.0.0.1:9224/json");
  if (!Array.isArray(pages)) throw new Error("invalid CDP response");
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page || !page.webSocketDebuggerUrl) throw new Error("no active CDP page found");

  const dbgUrl = new URL(page.webSocketDebuggerUrl);
  if (dbgUrl.protocol !== "ws:" || (dbgUrl.hostname !== "127.0.0.1" && dbgUrl.hostname !== "localhost") || dbgUrl.port !== "9224") {
    throw new Error("untrusted CDP debugger URL: " + page.webSocketDebuggerUrl);
  }

  let WS = typeof WebSocket !== "undefined" ? WebSocket : null;
  if (!WS) {
    try { WS = require("ws"); } catch (_) {}
  }
  if (!WS) {
    throw new Error("WebSocket runtime is unavailable; please run on Node >= 21 or provide ws module");
  }
  const ws = new WS(dbgUrl.toString());
  await new Promise((resolve, reject) => {
    if (ws.on) {
      ws.on("error", reject);
      ws.on("open", resolve);
    } else {
      ws.addEventListener("error", reject);
      ws.addEventListener("open", resolve);
    }
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp timeout")), 8000);
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.close();
  console.log(JSON.stringify(result.result || result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
