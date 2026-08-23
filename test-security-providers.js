"use strict";
const assert = require("assert");
const secGuard = require("./security-guard");

console.log("▶ Testing Provider Hub Security & OAuth Nonces (Finding 4 & 9)...");

// 1. Secret Key Redaction
const rawConfig = {
  activeModel: "claude-opus-5",
  proxyTarget: "openrouter",
  openrouterApiKey: "sk-or-v1-abcdef1234567890abcdef1234567890",
  providers: {
    openrouter: { enabled: true, apiKey: "sk-or-v1-secretkey99999" },
    anthropic: { enabled: true, apiKey: "sk-ant-secretkey88888" },
  }
};

const redacted = secGuard.redactProviderSecrets(rawConfig);
assert(typeof redacted.openrouterApiKey === "string" && !redacted.openrouterApiKey.includes("abcdef1234567890"), "openrouterApiKey must be redacted");
assert(redacted.openrouterApiKey.includes("•••"), "openrouterApiKey must show redaction dots");
assert(redacted.providers.openrouter.apiKey.includes("•••"), "nested apiKey must be redacted");
assert(redacted.activeModel === "claude-opus-5", "non-secret fields must remain untouched");

// 2. Provider Patch Schema Validation
const maliciousPayloadStr = JSON.stringify({
  proxyTarget: "openburnbar",
  model: "grok-4.6",
  evilCommand: "rm -rf /",
  providers: {
    openrouter: {
      enabled: true,
      apiKey: "sk-clean-key",
      baseUrl: "https://openrouter.ai/api/v1",
      evilProp: "hack",
    },
    unapproved_provider: {
      enabled: true,
    }
  }
}).replace('"model":"grok-4.6",', '"model":"grok-4.6","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}},');

const maliciousPatch = JSON.parse(maliciousPayloadStr);

const cleanPatch = secGuard.validateProviderConfigPatch(maliciousPatch);
assert(cleanPatch.proxyTarget === "openburnbar", "allowed key must remain");
assert(cleanPatch.model === "grok-4.6", "allowed model key must remain");
assert(!("evilCommand" in cleanPatch), "unrecognized top-level key must be stripped");
assert(!("unapproved_provider" in cleanPatch.providers), "unapproved provider must be stripped");
assert(!("evilProp" in cleanPatch.providers.openrouter), "unrecognized provider sub-key must be stripped");
assert(cleanPatch.providers.openrouter.apiKey === "sk-clean-key", "clean apiKey must remain");
assert(!({}).polluted, "prototype pollution (__proto__) must be blocked");
assert(!({}).polluted2, "prototype pollution (constructor.prototype) must be blocked");
assert(!Object.prototype.hasOwnProperty.call(cleanPatch, "__proto__"), "cleanPatch must not have own __proto__ key");
assert(!Object.prototype.hasOwnProperty.call(cleanPatch, "constructor"), "cleanPatch must not have own constructor key");

// 4. Provider URL Allowlist & SSRF Protections
assert.strictEqual(secGuard.isApprovedProviderUrl("https://api.openai.com/v1"), true, "known provider allowlisted");
assert.strictEqual(secGuard.isApprovedProviderUrl("https://api.anthropic.com/v1"), true, "anthropic allowlisted");
assert.strictEqual(secGuard.isApprovedProviderUrl("https://openrouter.ai/api/v1"), true, "openrouter allowlisted");
assert.strictEqual(secGuard.isApprovedProviderUrl("http://127.0.0.1:1234/v1"), true, "loopback LM studio allowed");
assert.strictEqual(secGuard.isApprovedProviderUrl("http://localhost:11434/v1"), true, "loopback ollama allowed");

// Rejection of arbitrary unapproved public HTTPS domains
assert.strictEqual(secGuard.isApprovedProviderUrl("https://evil-attacker.com/v1"), false, "arbitrary HTTPS domain rejected");
assert.strictEqual(secGuard.isApprovedProviderUrl("https://attacker.org/chat/completions"), false, "arbitrary HTTPS domain rejected");
assert.strictEqual(secGuard.isApprovedProviderUrl("http://192.168.1.1/v1"), false, "private IP rejected");
assert.strictEqual(secGuard.isApprovedProviderUrl("http://10.0.0.1/v1"), false, "private IP rejected");

// Explicit approved custom domain capability allows destination
assert.strictEqual(secGuard.isApprovedProviderUrl("https://custom-corporate-llm.corp.com/v1", { approvedCustomDomain: true }), true, "explicit approval allows custom domain");

console.log("✔ Provider Hub Security Tests Passed!");
