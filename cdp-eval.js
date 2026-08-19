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

async function main() {
  const expr = process.argv[2];
  if (!expr) {
    console.error("usage: cdp-eval.js <js>");
    process.exit(2);
  }
  const pages = await get("http://127.0.0.1:9224/json");
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("error", reject);
    ws.addEventListener("open", resolve);
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) resolve(msg);
    });
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }));
    setTimeout(() => reject(new Error("cdp timeout")), 8000);
  });
  ws.close();
  console.log(JSON.stringify(result.result || result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
