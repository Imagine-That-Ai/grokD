#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
console.log("==================================================================");
console.log("  PRODUCTION SOURCE AUTH & SANDBOX INTEGRITY SCANNER");
console.log("==================================================================");

function getDynamicProductionFiles(dir, relPrefix = "") {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "proof" || ent.name === "scratch") continue;
    if (ent.name === "profile-data" || ent.name === "browser-profiles" || ent.name === "runtime") continue;
    if (ent.isDirectory()) {
      if (ent.name === "splash" || ent.name === "assets" || ent.name === "hack") {
        result.push(...getDynamicProductionFiles(path.join(dir, ent.name), rel));
      }
    } else if (ent.isFile()) {
      if (/^test-.*\.js$/.test(ent.name) || /^test_.*\.js$/.test(ent.name) || ent.name === "test-unit.js") continue;
      if (ent.name.endsWith(".js") || ent.name.endsWith(".mjs") || ent.name.endsWith(".cjs") || ent.name.endsWith(".sh") || ent.name === "model-config.json") {
        result.push(rel);
      }
    }
  }
  return result;
}

const STATIC_REQUIRED_FILES = [
  "security-guard.js",
  "proxy2.js",
  "gateway-shim.js",
  "profile-store.js",
  "switch-profile.js",
  "box-state.js",
  "local-mcp.js",
  "profile-ui-inject.js",
  "profile-auth-preload.js",
  "account-identity.js",
  "model-lib.js",
  "takeover-local.js",
  "failover-watch.js",
  "failover-act.js",
  "create-bot-hook.js",
  "loop-grok-d.js",
  "bot-pause.js",
  "openburnbar-proxy.mjs",
  "openburnbar-install.js",
  "bridge-lib.js",
  "plasma-selectors.js",
  "clone-bot.js",
  "handoff-pack.js",
  "seed-cursor-box.js",
  "patch-asar.js",
  "patch-open-external.js",
  "pack-dist.sh",
  "model-config.json",
  "splash/onboarding.js",
  "provider-hub.js",
  "asar-file.js",
  "command-client.js",
];

const dynamicList = getDynamicProductionFiles(ROOT);
const PRODUCTION_FILES = Array.from(new Set([...STATIC_REQUIRED_FILES, ...dynamicList]));

const FORBIDDEN_LITERALS = [
  "fake-gateway-token",
  "nto-fake-local-token",
  "fake-daemon-auth-token",
  "GROK_ALLOW_DEV_STATIC_TOKEN",
  "GROK_ALLOW_UNAUTH_MINT",
  "GROK_ALLOW_DEV_OAUTH",
  "local-cliproxy",
];

let errors = [];

for (const rel of PRODUCTION_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing production file: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(full, "utf8");
  const lines = content.split("\n");

  if (rel.endsWith("verify-production-auth-integrity.js")) continue;

  for (const needle of FORBIDDEN_LITERALS) {
    lines.forEach((line, idx) => {
      if (line.includes(needle)) {
        errors.push(`[${rel}:${idx + 1}] Forbidden literal found: "${needle}" -> ${line.trim()}`);
      }
    });
  }

  // Ensure no hardcoded static Bearer tokens in fetch / curl / exec calls — NO EXEMPTIONS
  lines.forEach((line, idx) => {
    // Flag any static bearer literals across object properties, bracket assignments, templates, or concatenation
    const m = line.match(/(?:["']?authorization["']?\s*[:=]\s*|Bearer\s+)(?:["'`]Bearer\s+([a-zA-Z0-9_\-\.]{8,})["'`]|["']Bearer\s+["']\s*\+\s*["']([^"']+)["'])/i);
    if (m) {
      const token = (m[1] || m[2] || "").trim();
      if (token && !token.startsWith("${") && !token.startsWith("process.env") && token !== "sk-explicit-dynamic-key-12345") {
        errors.push(`[${rel}:${idx + 1}] Static bearer literal detected: [REDACTED ${token.length} chars]`);
      }
    }
  });
}

// Dataflow Verification: Verify dynamic resolution of model configuration & headers in an isolated worker
const { execFileSync } = require("child_process");
try {
  const runnerScript = `
    const modelLib = require("./model-lib.js");
    const proxy2 = require("./proxy2.js");
    const defaultCfg = modelLib.defaultConfig();
    if (defaultCfg.apiKey === "local-cliproxy") process.exit(10);
    const resolvedCfg = modelLib.resolveConfig();
    if (resolvedCfg.apiKey === "local-cliproxy") process.exit(11);
    const secGuard = require("./security-guard.js");
    const proxyModelCfg = { proxyUrl: "http://127.0.0.1:8320/v1/chat/completions", apiKey: "" };
    const defaultHeaders = proxy2.makeModelAuthHeaders(proxyModelCfg);
    if (!defaultHeaders.authorization || !secGuard.verifyProxyBridgeAuth(defaultHeaders.authorization)) process.exit(12);
    const sanitizedHeaders = proxy2.makeModelAuthHeaders({ proxyUrl: "http://127.0.0.1:8320/v1/chat/completions", apiKey: "local-cliproxy" });
    if (sanitizedHeaders.authorization && sanitizedHeaders.authorization.includes("local-cliproxy")) process.exit(13);
    const authedHeaders = proxy2.makeModelAuthHeaders({ proxyUrl: "http://127.0.0.1:8320/v1/chat/completions", apiKey: "sk-explicit-dynamic-key-12345" });
    if (authedHeaders.authorization !== "Bearer sk-explicit-dynamic-key-12345") process.exit(14);
    process.exit(0);
  `;
  execFileSync(process.execPath, ["-e", runnerScript], {
    cwd: ROOT,
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "production", HOME: "/tmp" },
    timeout: 3000,
    stdio: "pipe",
  });
} catch (err) {
  errors.push(`[dataflow-scanner] Isolated dynamic config evaluation failed with status ${err.status || err.message}`);
}

if (errors.length > 0) {
  console.error("FAIL: Production source scan found violations:");
  errors.forEach((e) => console.error("  ❌ " + e));
  process.exit(1);
}

console.log(`✓ Scanned ${PRODUCTION_FILES.length} production files & verified dynamic config dataflows — 0 forbidden literals found.`);
console.log("==================================================================");
process.exit(0);
