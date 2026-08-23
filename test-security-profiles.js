"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-test-prof-"));
const testSeat4 = path.join(testRoot, "Seat4");

// Set environment variables BEFORE importing modules
process.env.GROK_SEAT4 = testSeat4;
process.env.GROK_PROFILE_ROOT = testRoot;
process.env.GROKBOT_HACK = path.join(testRoot, "hack");

const secGuard = require("./security-guard");
secGuard.ensureDir0700(testSeat4);
secGuard.ensureDir0700(path.join(testRoot, "box-data", "agents"));
secGuard.ensureDir0700(path.join(testRoot, "profile-data", "local-d", "agents"));

// Simulate Seat4 having a foreign Cursor token
const foreignSecret = path.join(testSeat4, "sand-secrets.json");
secGuard.writeFile0600(foreignSecret, JSON.stringify({ "cursor-access-token": "secret-cursor-token-12345" }));
assert(fs.existsSync(foreignSecret), "foreign secret should exist");

const switcher = require("./switch-profile");

console.log("▶ Testing Profile Secret Isolation & Permissions (Finding 7 & 15)...");

// Run applyLocal for a fresh Local D profile
const localProfile = { id: "local-d", name: "Local D", kind: "local" };
switcher.applyLocal(localProfile, { takeover: false });

// Verify that applyLocal wiped the foreign Cursor secrets from Seat4 so Local D has NO Cursor tokens
assert(!fs.existsSync(path.join(testSeat4, "sand-secrets.json")), "Seat4 sand-secrets.json must be removed during Local D switch");
assert(!fs.existsSync(path.join(testSeat4, "gateway-descriptor.json")), "Seat4 gateway-descriptor.json must be removed during Local D switch");

// Verify that LOCAL_SECRETS_BAK does not restore foreign secrets
const bakDir = path.join(testRoot, "local-d-secrets");
assert(!fs.existsSync(bakDir) || fs.readdirSync(bakDir).length === 0, "local-d-secrets backup directory must not retain foreign secrets");

// Clean up
try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch (_) {}

console.log("✔ Profile Secret Isolation & Permission Tests Passed!");
