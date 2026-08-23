"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const secGuard = require("./security-guard");
const shim = require("./gateway-shim");

console.log("▶ Testing Gateway Capability & Permissions (Finding 2 & 15)...");

// 1. Gateway Token Generation & Permissions
const token = secGuard.getGatewayToken();
assert(typeof token === "string" && token.length >= 32, "gateway token should be at least 32 chars");

const tokenFile = path.join(paths.ROOT, "gateway.token");
if (fs.existsSync(tokenFile)) {
  const stat = fs.statSync(tokenFile);
  const mode = stat.mode & 0o777;
  assert((mode & 0o077) === 0, `gateway.token must have mode 0600, got ${mode.toString(8)}`);
}

// 2. Gateway Auth Verification
assert(secGuard.verifyGatewayAuth(`Bearer ${token}`), "valid gateway token must pass");
assert(!secGuard.verifyGatewayAuth("Bearer wrong-token-12345"), "wrong token must fail");
assert(!secGuard.verifyGatewayAuth("Bearer fake-gateway-token"), "static token must fail in secure mode");
assert(!secGuard.verifyGatewayAuth("Bearer local-cliproxy"), "local-cliproxy static bearer must fail");
assert(!secGuard.verifyGatewayAuth("Bearer evil-grokbot-local-bypass"), "substring token must fail");
assert(!secGuard.verifyGatewayAuth(""), "empty auth must fail");
assert(!secGuard.verifyGatewayAuth("Basic 12345"), "non-bearer must fail");

// 3. Gateway Shim Route Mutating Authorization
assert(shim.authorizationMatches(`Bearer ${token}`), "shim must authorize dynamic token");
assert(!shim.authorizationMatches("Bearer wrong-token"), "shim must reject invalid token");
assert(!shim.authorizationMatches("Bearer local-cliproxy"), "shim must reject local-cliproxy");
assert(!shim.authorizationMatches("Bearer arbitrary-grokbot-local-token"), "shim must reject substring token");

console.log("✔ Gateway Security & Capability Tests Passed!");
