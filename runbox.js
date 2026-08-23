#!/usr/bin/env node
// Grok Bot LOCAL BOX — runs the real host-main.cjs from the app bundle on this Mac,
// with inference pointed at our proxy (which bridges to CLIProxyAPI).
const { spawn } = require("child_process");
const fs = require("fs");

const path = require("path");
const os = require("os");
const paths = require("./paths");
const HACK = paths.existingHack();
const DURABLE = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const HOST = [
  process.env.GROK_HOST_MAIN,
  path.join(DURABLE, "host", "host-main.cjs"),
].find((p) => p && fs.existsSync(p));
const DATA_ROOT = path.join(HACK, "box-data");
const TOKEN_FILE = path.join(HACK, "box-token.json");
if (!HOST) throw new Error("host-main.cjs not found — run install-runtime.sh / pack-asar extract");

const secGuard = require("./security-guard");

secGuard.ensureDir0700(DATA_ROOT);
secGuard.ensureDir0700(DATA_ROOT + "/workspace");

// Valid local JWT with subject claim for inference service with synchronized 30-day expiry
const EXPIRY_SECONDS = 30 * 24 * 60 * 60;
const localJwt = secGuard.mintSessionJwt({ sub: "grokbot-local", email: "local@grokbot", audience: "local-mcp", expiresInSeconds: EXPIRY_SECONDS });
secGuard.writeFile0600(TOKEN_FILE, JSON.stringify({
  accessToken: localJwt,
  expiresAtMs: Date.now() + EXPIRY_SECONDS * 1000,
}));

function buildCleanEnv() {
  const allowedKeys = [
    "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
    "SHELL", "USER", "LOGNAME", "NODE_ENV", "ELECTRON_RUN_AS_NODE"
  ];
  const clean = {};
  for (const k of allowedKeys) {
    if (process.env[k] != null) clean[k] = process.env[k];
  }
  clean.PATH = clean.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  clean.SAND_DATA_ROOT = DATA_ROOT;
  clean.SAND_DEV_INFERENCE_TOKEN_FILE = TOKEN_FILE;
  clean.SAND_BACKEND_URL = "http://127.0.0.1:8787";
  clean.HOME = DATA_ROOT; // isolate host state
  clean.SAND_HOST_DEV_ERROR_DETAIL = "1";
  clean.SAND_HOST_PORT = (process.env.SAND_HOST_PORT && /^\d+$/.test(process.env.SAND_HOST_PORT)) ? process.env.SAND_HOST_PORT : "1338";
  clean.SAND_GATEWAY_TOKEN = secGuard.getGatewayToken();
  clean.SAND_GATEWAY_REQUIRE_AUTH = "1";
  clean.DEBUG = "";
  return require("./node-deps").applyNodePath(clean);
}

const env = buildCleanEnv();

let currentChild = null;
let restarting = false;
let restartCount = 0;
const MAX_RESTARTS = 5;

function forwardSig(sig) {
  restarting = true;
  if (currentChild) {
    try { currentChild.kill(sig); } catch (_) {}
    const timer = setTimeout(() => {
      try { currentChild.kill("SIGKILL"); } catch (_) {}
      process.exit(0);
    }, 3000);
    currentChild.on("exit", () => {
      clearTimeout(timer);
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.once("SIGTERM", () => forwardSig("SIGTERM"));
process.once("SIGINT", () => forwardSig("SIGINT"));

function launchHost() {
  console.log(`starting host-main.cjs (local box, attempt ${restartCount + 1})...`);
  const p = spawn(process.execPath, [HOST], { env, stdio: ["ignore", "pipe", "pipe"] });
  currentChild = p;
  p.stdout.on("data", (d) => process.stdout.write("[box] " + d));
  p.stderr.on("data", (d) => process.stderr.write("[box!] " + d));
  p.on("error", (err) => {
    console.error("[box] spawn error:", err.message);
  });
  p.on("exit", (code, signal) => {
    if (currentChild === p) currentChild = null;
    console.log(`host exited: code=${code}, signal=${signal}`);
    if (signal === "SIGTERM" || signal === "SIGINT" || restarting) return;
    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      const delay = Math.min(1000 * Math.pow(2, restartCount), 10000);
      console.log(`[box] restarting host in ${delay}ms...`);
      setTimeout(launchHost, delay);
    } else {
      console.error("[box] max host restarts reached, exiting.");
      process.exit(code || 1);
    }
  });
}

launchHost();
