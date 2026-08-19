#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-br-"));
process.env.GROK_PROFILE_ROOT = tmp;
const br = require("./browser-login");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(br.isLoginUrl("https://cursor.com/loginDeepControl?challenge=x&uuid=y&mode=login"), "deep");
assert(br.isLoginUrl("https://www.cursor.com/login?x=1"), "login path");
assert(br.isLoginUrl("https://authenticator.cursor.sh/?x=1"), "authenticator");
assert(!br.isLoginUrl("https://cursor.com/docs"), "docs");
assert(!br.isLoginUrl("https://github.com/login"), "github");
assert(!br.isLoginUrl("not-a-url"), "garbage");
ok("login-urls");

{
  const a = br.formatCursorAccount({
    kind: "logged-in",
    authId: "github|user_01JPV3PX04QGGE54KSKTQS8WS5",
  }, "cursor-a");
  assert(a.title === "A · GitHub", a.title);
  assert(a.detail === "user_01JPV3P…8WS5", a.detail);
  assert(a.signedIn === true, "signed in");
  const b = br.formatCursorAccount({
    kind: "logged-in",
    authId: "auth0|user_01KV1GVXW0JB5KVV1R1YE402VP",
    email: "alberto@example.com",
  }, "cursor-b");
  assert(b.title === "B · Auth0", b.title);
  assert(b.detail === "alberto@example.com", b.detail);
  const out = br.formatCursorAccount({ kind: "logged-out" }, "cursor-c");
  assert(out.title === "C · signed out", out.title);
  assert(out.signedIn === false, "out");
  ok("account-label");
}

{
  const url = br.accountAvatarDataUrl({ kind: "logged-in", authId: "github|user_01JPV3PX04QGGE54KSKTQS8WS5" });
  assert(url.startsWith("data:image/svg+xml"), url.slice(0, 40));
  assert(decodeURIComponent(url).includes(">G<"), "github letter");
  const a0 = br.accountAvatarDataUrl({ kind: "logged-in", authId: "auth0|user_01KV1" });
  assert(decodeURIComponent(a0).includes(">0<"), "auth0 letter");
  const a = br.accountAvatarDataUrl({ kind: "logged-in", authId: "github|user_01AAA" });
  const b = br.accountAvatarDataUrl({ kind: "logged-in", authId: "github|user_01BBB" });
  assert(a !== b, "different accounts get different faces");
  ok("account-avatar");
}

fs.writeFileSync(path.join(tmp, "active-env.json"), JSON.stringify({ mode: "cursor", profileId: "cursor-a" }));
assert(br.activeProfileId() === "cursor-a", "env id");
assert(br.profileDir("cursor-a").endsWith("/cursor-a"), "dir a");
assert(br.profileDir("cursor-b").endsWith("/cursor-b"), "dir b");
assert(br.profileDir("cursor-c").endsWith("/cursor-c"), "dir c");
assert(br.profileDir("../evil").endsWith("..-evil"), "sanitize");
ok("per-seat-dirs");

const dir = br.prepareProfile("cursor-a");
assert(fs.existsSync(path.join(dir, "First Run")), "first run");
fs.writeFileSync(path.join(dir, "Cookie"), "old");
br.resetProfile("cursor-a");
assert(!fs.existsSync(path.join(dir, "Cookie")), "reset wipes");
ok("reset-clean");

const a = br.profileDir("cursor-a");
const b = br.profileDir("cursor-b");
assert(a !== b, "a and b isolated");
ok("isolated");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/${n} browser-login groups passed`);
