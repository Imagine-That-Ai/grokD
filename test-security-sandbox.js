"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const secGuard = require("./security-guard");

console.log("▶ Testing Workspace Sandboxing & SSRF/TLS Protections (Finding 5 & 6)...");

// 1. Workspace Boundaries & Sensitive Paths
const home = os.homedir();
assert(secGuard.isPathInWorkspace(path.join(home, "Documents", "Developer", "test-project", "file.js")), "developer directory is in workspace");
assert(secGuard.isPathInWorkspace("/tmp/grokbot-hack/box-data/workspace/agent-1/main.js"), "box workspace is in workspace");

// Sensitive path rejection
assert(!secGuard.isPathInWorkspace(path.join(home, ".ssh", "id_rsa")), "ssh keys must be denied");
assert(!secGuard.isPathInWorkspace(path.join(home, "Library", "Keychains", "login.keychain-db")), "keychain must be denied");
assert(!secGuard.isPathInWorkspace(path.join(home, ".aws", "credentials")), "aws credentials must be denied");
assert(!secGuard.isPathInWorkspace(path.join(home, ".bash_history")), "bash history must be denied");
assert(!secGuard.isPathInWorkspace("/tmp/sand-secrets.json"), "sand-secrets.json must be denied");

// 2. SSRF Protection on WebFetch
assert(secGuard.isUrlSafeForWebFetch("https://api.github.com/repos/test"), "public https url must be allowed");
assert(secGuard.isUrlSafeForWebFetch("https://news.ycombinator.com/item?id=123"), "public website must be allowed");

// SSRF targets must be rejected
assert(!secGuard.isUrlSafeForWebFetch("http://127.0.0.1:8787/secrets"), "loopback IPv4 must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("http://localhost:1337/admin"), "localhost must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("http://169.254.169.254/latest/meta-data/"), "cloud metadata IP must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("http://10.0.0.5/internal"), "10.0.0.0/8 private network must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("http://192.168.1.1/router"), "192.168.0.0/16 private network must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("http://172.20.0.10/admin"), "172.16.0.0/12 private network must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("file:///etc/passwd"), "file:// protocol must be blocked");
assert(!secGuard.isUrlSafeForWebFetch("gopher://localhost:70/"), "non-http/https must be blocked");

// 3. Remote Descriptor TLS & Domain Validation
assert(secGuard.isApprovedRemoteDescriptor("https://api2.cursor.sh"), "cursor.sh must be approved");
assert(secGuard.isApprovedRemoteDescriptor("https://api.cursor.com/v1"), "cursor.com must be approved");
assert(secGuard.isApprovedRemoteDescriptor("https://openrouter.ai/api/v1"), "openrouter.ai must be approved");
assert(secGuard.isApprovedRemoteDescriptor("https://api.x.ai/v1"), "x.ai must be approved");

// Insecure protocols and unapproved remote domains
assert(!secGuard.isApprovedRemoteDescriptor("http://api2.cursor.sh"), "http:// must be rejected (must be https)");
assert(!secGuard.isApprovedRemoteDescriptor("https://evil-attacker.com/steal"), "unapproved domains must be rejected");
assert(!secGuard.isApprovedRemoteDescriptor("https://cursor.sh.evil.com"), "domain suffix spoofing must be rejected");

console.log("✔ Workspace Sandboxing & SSRF/TLS Tests Passed!");
