"use strict";
const assert = require("assert");
const secGuard = require("./security-guard");

console.log("▶ Testing UI Injection & Sanitization (Finding 8)...");

// 1. HTML Escaping
const maliciousName = '<script>alert("xss")</script>';
const escapedName = secGuard.escHtml(maliciousName);
assert(!escapedName.includes("<script>"), "script tags must be escaped");
assert(escapedName.includes("&lt;script&gt;"), "script tags must be converted to HTML entities");

const maliciousAttr = '"><img src=x onerror=alert(1)>';
const escapedAttr = secGuard.escAttr(maliciousAttr);
assert(!escapedAttr.includes('">'), "attribute break-out characters must be escaped");
assert(escapedAttr.includes("&quot;&gt;"), "attribute break-out characters must be converted to entities");

// 2. Image URL Sanitization
assert(secGuard.sanitizeImageUrl("https://avatars.githubusercontent.com/u/12345") === "https://avatars.githubusercontent.com/u/12345", "https image url allowed");
assert(secGuard.sanitizeImageUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==").startsWith("data:image/png;base64,"), "safe data URI allowed");
assert(!secGuard.sanitizeImageUrl("javascript:alert(1)"), "javascript URI blocked");
assert(!secGuard.sanitizeImageUrl("data:text/html,<script>alert(1)</script>"), "data text/html URI blocked");
assert(!secGuard.sanitizeImageUrl("vbscript:msgbox(1)"), "vbscript URI blocked");

console.log("✔ UI Injection & Sanitization Tests Passed!");
