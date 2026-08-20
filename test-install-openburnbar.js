#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const info = require("./openburnbar-install").info();
const models = require("./model-lib");

assert(info.npmProxy === false, "npm does not ship the proxy");
assert(/npx -y openburnbar app install/.test(info.install.macApp), info.install.macApp);
assert(info.proxy.daemon.indexOf(":8317") >= 0, info.proxy.daemon);
assert(models.defaultConfig().proxyTarget === "openburnbar", models.defaultConfig().proxyTarget);
assert(models.FALLBACK_ORDER[0] === "openburnbar", models.FALLBACK_ORDER.join(","));
console.log("PASS  npm-proxy-is-app-only");
console.log("PASS  grokD-default-is-openburnbar");

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const PORT = 19339;
const child = spawn(process.execPath, [path.join(__dirname, "gateway-shim.js")], {
  env: { ...process.env, GROK_SHIM_PORT: String(PORT), GROK_SHIM_UP: "http://127.0.0.1:19338" },
  stdio: ["ignore", "pipe", "pipe"],
});
function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") }));
    });
    req.on("error", reject);
  });
}
(async () => {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const r = await get("/install/openburnbar");
    assert(r.status === 200 && r.json.npmProxy === false, JSON.stringify(r));
    console.log("PASS  install-route");
    console.log("\n3/3 openburnbar install contract checks passed");
  } finally {
    child.kill("SIGTERM");
  }
})().catch((e) => {
  child.kill("SIGTERM");
  console.error("FAIL", e);
  process.exit(1);
});
