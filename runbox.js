#!/usr/bin/env node
// Grok Bot LOCAL BOX — runs the real host-main.cjs from the app bundle on this Mac,
// with inference pointed at our proxy (which bridges to CLIProxyAPI).
const { spawn } = require("child_process");
const fs = require("fs");

const path = require("path");
const os = require("os");
const DURABLE = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const HACK = process.env.GROKBOT_HACK || path.join(DURABLE, "hack");
const HOST = [
  process.env.GROK_HOST_MAIN,
  path.join(DURABLE, "host", "host-main.cjs"),
  "/tmp/grokbot-asar/dist/host/host-main.cjs",
].find((p) => p && fs.existsSync(p));
const DATA_ROOT = path.join(HACK, "box-data");
const TOKEN_FILE = path.join(HACK, "box-token.json");
if (!HOST) throw new Error("host-main.cjs not found — run install-runtime.sh / pack-asar extract");

fs.mkdirSync(DATA_ROOT, { recursive: true });
fs.mkdirSync(DATA_ROOT + "/workspace", { recursive: true });

// Valid local JWT with subject claim for inference service
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const localJwt = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: "grokbot-local", email: "local@grokbot", exp: Math.floor(Date.now() / 1000) + 86400 * 365 })}.localsig`;
fs.writeFileSync(TOKEN_FILE, JSON.stringify({
  accessToken: localJwt,
  expiresAtMs: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year
}));

const env = {
  ...process.env,
  SAND_DATA_ROOT: DATA_ROOT,
  SAND_DEV_INFERENCE_TOKEN_FILE: TOKEN_FILE,
  SAND_BACKEND_URL: "http://127.0.0.1:8787",
  HOME: DATA_ROOT, // isolate host state
  SAND_HOST_DEV_ERROR_DETAIL: "1",
  SAND_HOST_PORT: process.env.SAND_HOST_PORT || "1338",
  SAND_GATEWAY_TOKEN: "fake-gateway-token",
  DEBUG: "",
};
// Desktop gateway URL must not leak into the box — host would call itself via the shim and deadlock.
delete env.SAND_HOST_GATEWAY_URL;
delete env.SAND_HOST_GATEWAY_TOKEN;

console.log("starting host-main.cjs (local box)...");
const p = spawn(process.execPath, [HOST], { env, stdio: ["ignore", "pipe", "pipe"] });
p.stdout.on("data", (d) => process.stdout.write("[box] " + d));
p.stderr.on("data", (d) => process.stderr.write("[box!] " + d));
p.on("exit", (c) => console.log("host exited:", c));
process.on("SIGTERM", () => p.kill("SIGTERM"));
