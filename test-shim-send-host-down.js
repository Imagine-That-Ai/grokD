#!/usr/bin/env node
// Prove sendPrompt is honest when :1338 is down without touching the live box.
"use strict";
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const crypto = require("crypto");
const HACK = fs.mkdtempSync(path.join(os.tmpdir(), "grok-shim-down-"));
const PROFILE_ROOT = path.join(HACK, "profile-root");
fs.mkdirSync(PROFILE_ROOT, { recursive: true });
const AGENTS = path.join(HACK, "box-data", "agents");
fs.mkdirSync(AGENTS, { recursive: true });

const TEST_TOKEN = crypto.randomBytes(32).toString("hex");
const PORT = 19000 + Math.floor(Math.random() * 1000);
const UP_PORT = PORT + 1;
const UP = `http://127.0.0.1:${UP_PORT}`;

process.env.GROK_PROFILE_ROOT = PROFILE_ROOT;
process.env.SAND_HOST_GATEWAY_TOKEN = TEST_TOKEN;

const child = spawn(process.execPath, [path.join(__dirname, "gateway-shim.js")], {
  env: {
    ...process.env,
    GROKBOT_HACK: HACK,
    GROK_PROFILE_ROOT: PROFILE_ROOT,
    SAND_HOST_GATEWAY_TOKEN: TEST_TOKEN,
    GROK_SHIM_PORT: String(PORT),
    GROK_SHIM_UP: UP,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

function post(method, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = http.request({
      host: "127.0.0.1",
      port: PORT,
      path: `/api/${method}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": data.length,
        authorization: `Bearer ${TEST_TOKEN}`,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      await post("listAgents", {});
      break;
    } catch {
      if (i === 39) throw new Error("shim did not start");
      await sleep(50);
    }
  }
  const listed = await post("listAgents", {});
  if (listed.status !== 200) throw new Error(`listAgents ${listed.status} ${listed.text}`);
  const sent = await post("sendPrompt", {
    agentId: "7fa6a3c4-9f24-46be-9795-396308b0f612",
    prompt: "secret-token-do-not-echo",
    awaitTurn: false,
  });
  if (sent.status === 200 || sent.json?.ok === true || sent.json?.scheduled === true) {
    throw new Error(`sendPrompt lied: ${sent.status} ${sent.text}`);
  }
  if (!String(sent.text).includes("local box host is down")) {
    throw new Error(`sendPrompt missing honest error: ${sent.text}`);
  }
  if (String(sent.text).includes("secret-token-do-not-echo")) {
    throw new Error("sendPrompt echoed prompt");
  }
  const unauth = await new Promise((resolve, reject) => {
    const data = Buffer.from("{}");
    const req = http.request({
      host: "127.0.0.1",
      port: PORT,
      path: "/api/listAgents",
      method: "POST",
      headers: { "content-type": "application/json", "content-length": data.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
  if (unauth.status !== 401) throw new Error(`expected 401, got ${unauth.status} ${unauth.text}`);
  const bc = await post("broadcastToAgents", { targets: ["aaa"], message: "hi" });
  if (bc.status !== 502 || bc.json?.ok !== false) throw new Error(`broadcast lied: ${bc.status} ${bc.text}`);
  console.log("PASS  sendPrompt honest when host is down");
  child.kill("SIGTERM");
  fs.rmSync(HACK, { recursive: true, force: true });
})().catch((err) => {
  child.kill("SIGTERM");
  fs.rmSync(HACK, { recursive: true, force: true });
  console.error("FAIL", err);
  process.exit(1);
});
