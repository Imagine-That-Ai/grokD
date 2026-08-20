#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-ident-"));
process.env.GROK_PROFILE_ROOT = tmp;
const acc = require("./account-identity");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

{
  const p = acc.parseAuthId("github|user_01JPV3PX04QGGE54KSKTQS8WS5");
  assert(p.provider === "github", p.provider);
  assert(p.subject.startsWith("user_01"), p.subject);
  assert(acc.githubAvatarUrlForAuthId("github|user_01JPV3PX04QGGE54KSKTQS8WS5") === null, "ulid has no github numeric avatar");
  assert(acc.githubAvatarUrlForAuthId("github|12345") === "https://avatars.githubusercontent.com/u/12345?v=4&s=192", "numeric");
  assert(acc.githubPngFromUsername("Imagine-That-Ai") === "https://github.com/Imagine-That-Ai.png?size=192", "username png");
  assert(acc.githubPngFromUsername("bad name") === null, "reject spaces");
  assert(acc.gravatarFromEmail("a@b.co").includes("gravatar.com/avatar/"), "gravatar");
  ok("avatar-urls");
}

{
  const a = acc.formatCursorAccount({
    kind: "logged-in",
    authId: "github|user_01JPV3PX04QGGE54KSKTQS8WS5",
    email: "user@example.com",
    name: "User",
  }, "cursor-c");
  assert(a.title === "C · GitHub", a.title);
  assert(a.detail === "user@example.com", a.detail);
  assert(a.email === "user@example.com", a.email);
  assert(a.hover === "user@example.com", a.hover);
  assert(a.signedIn === true, "signed");
  const b = acc.formatCursorAccount({
    kind: "logged-in",
    authId: "github|user_01JPV3PX04QGGE54KSKTQS8WS5",
  }, "cursor-a");
  assert(b.hover === "No email on this login", b.hover);
  assert(b.detail === "user_01JPV3P…8WS5", b.detail);
  ok("format-email-hover");
}

{
  const claims = acc.identityFromClaims({
    sub: "github|user_01AAA",
    email: "dev@imaginethat.ai",
    name: "Dev",
    picture: "https://avatars.githubusercontent.com/u/1?v=4",
    preferred_username: "imagine-that",
  });
  assert(claims.email === "dev@imaginethat.ai", claims.email);
  assert(claims.pictureUrl.startsWith("https://avatars."), claims.pictureUrl);
  assert(claims.username === "imagine-that", claims.username);
  const pics = acc.pictureCandidates(claims);
  assert(pics[0] === claims.pictureUrl, pics[0]);
  ok("claims");
}

{
  fs.writeFileSync(path.join(tmp, "active-env.json"), JSON.stringify({ mode: "cursor", profileId: "cursor-c" }));
  acc.writeCache("cursor-c", {
    authId: "github|user_01JPV3PX04QGGE54KSKTQS8WS5",
    email: "cached@example.com",
    pictureUrl: "https://example.com/a.png",
  });
  const st = acc.enrichStatus({ kind: "logging-in" }, { profileId: "cursor-c" });
  assert(st.email === "cached@example.com", st.email);
  assert(st.authId.startsWith("github|"), st.authId);
  const other = acc.enrichStatus({
    kind: "logged-in",
    authId: "auth0|other",
  }, { profileId: "cursor-c" });
  assert(!other.email, "do not leak cache onto a different authId");
  ok("cache-enrich");
}

{
  const url = acc.accountAvatarDataUrl({ kind: "logged-in", authId: "github|user_01AAA" });
  assert(url.startsWith("data:image/svg+xml"), url.slice(0, 40));
  assert(decodeURIComponent(url).includes(">G<"), "letter");
  ok("letter-fallback");
}

{
  assert(acc.emailsFromBrowserProfile("missing-seat").length === 0, "empty scrape");
  const fake = path.join(tmp, "browser-profiles", "cursor-x", "Default");
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, "Preferences"), JSON.stringify({
    account_info: [{ email: "pref@example.com" }],
  }));
  const got = acc.emailsFromBrowserProfile("cursor-x");
  assert(got.includes("pref@example.com"), String(got));
  const st = acc.enrichStatus({ kind: "logging-in" }, { profileId: "cursor-x" });
  assert(st.email === "pref@example.com", st.email);
  ok("browser-email");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/${n} account-identity groups passed`);
