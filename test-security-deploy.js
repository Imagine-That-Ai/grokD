"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("▶ Testing Release, Packaging & Deployment Safety (Findings 10, 11, 12, 13, 14, 16)...");

// 1. Finding 10: Pinned package versions
const installSh = fs.readFileSync(path.join(__dirname, "install.sh"), "utf8");
assert(installSh.includes('bash "$HERE/asar-cli.sh"'), "install.sh must use the pinned ASAR wrapper");
assert(!installSh.includes("npx asar extract"), "install.sh must not run unpinned asar extract");

const ensureSh = fs.readFileSync(path.join(__dirname, "ensure-local-box.sh"), "utf8");
assert(ensureSh.includes("openburnbar@0.2.0"), "ensure-local-box.sh must use pinned openburnbar@0.2.0");

const packAsarSh = fs.readFileSync(path.join(__dirname, "pack-asar.sh"), "utf8");
assert(packAsarSh.includes("asar-cli.sh"), "pack-asar.sh must use the pinned ASAR wrapper");

const asarCliSh = fs.readFileSync(path.join(__dirname, "asar-cli.sh"), "utf8");
assert(asarCliSh.includes("@electron/asar@4.3.0"), "ASAR wrapper must pin the current canonical package");
assert(asarCliSh.includes("@electron/asar@3.4.1"), "ASAR wrapper must pin its older-Node fallback");
assert(!asarCliSh.includes("asar@" + "3.2.9"), "ASAR wrapper must not reference a nonexistent package version");

// 2. Finding 11: Pinned ref / tag updates
const quickSh = fs.readFileSync(path.join(__dirname, "quick-install.sh"), "utf8");
assert(quickSh.includes("GROK_PINNED_REF"), "quick-install.sh must support pinned ref");

const updateSh = fs.readFileSync(path.join(__dirname, "update.sh"), "utf8");
assert(updateSh.includes("GROK_PINNED_REF"), "update.sh must support pinned ref");

// 3. Finding 12 & 13: Pack Dist & Export Exclusion of Secrets
const packDistSh = fs.readFileSync(path.join(__dirname, "pack-dist.sh"), "utf8");
assert(!packDistSh.includes("model-config.json command-client.js"), "pack-dist.sh must not copy live model-config.json");
assert(packDistSh.includes("model-config.starter.json"), "pack-dist.sh must include model-config.starter.json");
assert(packDistSh.includes("security-guard.js"), "pack-dist.sh must include security-guard.js");

const packDropSh = fs.readFileSync(path.join(__dirname, "pack-drop.sh"), "utf8");
assert(packDropSh.includes("--exclude 'NOTES.md'"), "pack-drop.sh must exclude NOTES.md");
assert(packDropSh.includes("--exclude 'workflows/'"), "pack-drop.sh must exclude workflows/");
assert(packDropSh.includes("--exclude 'deploy.sh'"), "pack-drop.sh must exclude deploy.sh");

const exportSh = fs.readFileSync(path.join(__dirname, "export-public.sh"), "utf8");
assert(exportSh.includes("NOTES.md"), "export-public.sh must exclude NOTES.md");
assert(exportSh.includes("workflows"), "export-public.sh must exclude workflows");

// 4. Finding 14: Fakebox Debug Bodies Suppression & Header Allowlist
const fakeboxJs = fs.readFileSync(path.join(__dirname, "fakebox.js"), "utf8");
assert(fakeboxJs.includes("GROKBOT_DEBUG_BODIES === \"1\""), "fakebox.js must require explicit debug flag for bodies");
assert(fakeboxJs.includes("ALLOWED_HEADERS") || fakeboxJs.includes("[REDACTED]"), "fakebox.js must restrict headers to safe allowlist or redact");

// 5. Finding 16: Safe Fleet Archive Streaming
const deploySh = fs.readFileSync(path.join(__dirname, "deploy.sh"), "utf8");
assert(!deploySh.includes("tar -C \"$SRC\" -cf - $FILES"), "deploy.sh must not expand unquoted $FILES");
assert(deploySh.includes("git -C \"$SRC\" archive HEAD"), "deploy.sh must use safe git archive stream");

console.log("✔ Release, Packaging & Deployment Safety Tests Passed!");
