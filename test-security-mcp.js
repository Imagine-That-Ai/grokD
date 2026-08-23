"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-test-mcp-"));
process.env.GROK_PROFILE_ROOT = tmpRoot;

try {
  const secGuard = require("./security-guard");
  const localMcp = require("./local-mcp");

  console.log("▶ Testing MCP Capabilities & Account Resolution (Finding 3 & 5)...");

  // 1. JWT Minting and Verification
  const jwt = secGuard.mintSessionJwt({ sub: "test-user", email: "user@test", audience: "local-mcp", expiresInSeconds: 60 });
  assert(typeof jwt === "string" && jwt.split(".").length === 3, "jwt should have 3 segments");

  const verified = secGuard.verifySessionJwt(jwt, "local-mcp");
  assert(verified && verified.sub === "test-user" && verified.email === "user@test", "jwt should verify successfully");

  // Rejection of invalid / expired / wrong audience JWTs
  assert(!secGuard.verifySessionJwt(jwt, "wrong-audience"), "wrong audience must fail");
  assert(!secGuard.verifySessionJwt(jwt.slice(0, -5) + "aaaaa", "local-mcp"), "tampered signature must fail");
  assert(!secGuard.verifySessionJwt("not.a.jwt", "local-mcp"), "malformed jwt must fail");

  // Rejection of substring tokens in bridge
  assert(secGuard.verifyProxyBridgeAuth(`Bearer ${jwt}`), "valid bridge JWT must pass");
  assert(!secGuard.verifyProxyBridgeAuth("Bearer local-fake-token-extra"), "substring token must fail");
  assert(!secGuard.verifyProxyBridgeAuth("Bearer malicious-localsig-token"), "substring localsig must fail");

  // 2. Strict Slot Resolution (Unknown Account Keys must NOT fallback to Slot 0)
  const unknownSpec = localMcp.resolveSpec("x--unknown_account_xyz");
  assert(unknownSpec === null, "unknown account slot must return null, not fallback to slot 0");

  const defaultSpec = localMcp.resolveSpec("x");
  assert(defaultSpec !== null && defaultSpec.serverIdentifier, "default slot should resolve");

  const githubSpec = localMcp.resolveSpec("github");
  assert(githubSpec !== null && githubSpec.accountKey === "default", "github default slot should resolve");

  // 3. Mutating tool deny-by-default (variable unset)
  delete process.env.GROK_ALLOW_MUTATING_MCP_TOOLS;
  assert.strictEqual(localMcp.isMutationAuthorized("create_repository"), false, "mutating tool denied by default");
  assert.strictEqual(localMcp.isMutationAuthorized("create_repository", { approved: true }), true, "mutating tool allowed with approved capability");
  assert.strictEqual(localMcp.isMutationAuthorized("list_repositories"), true, "read-only tool allowed by default");

  console.log("✔ MCP Security & Account Resolution Tests Passed!");
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}
