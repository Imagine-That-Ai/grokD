#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const acc = require("./onboard-accounts");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

assert(acc.nextSignInName([]) === "My Cursor", "first name");
assert(acc.nextSignInName([{ kind: "local" }]) === "My Cursor", "ignore local");
assert(acc.nextSignInName([{ kind: "cursor" }]) === "Cursor 2", "second sign-in");
assert(acc.nextSignInName([
  { kind: "cursor", sourceUserData: "/x" },
]) === "My Cursor", "import is not a sign-in");
ok("next-name");

const a = acc.alreadyIds({ cursorProfile: "p1", cursorProfiles: [{ id: "p1" }, { id: "p2" }] });
assert(a.join(",") === "p1,p2", a.join(","));
assert(acc.alreadyIds({}).length === 0, "empty");
ok("already-ids");

const remembered = acc.remember({ cursorProfiles: [] }, { id: "p1", name: "A", source: "signin" });
assert(remembered.cursorProfile === "p1", "active");
assert(remembered.cursorProfiles.length === 1, "one");
const two = acc.remember(remembered, { id: "p2", name: "B", source: "import" });
assert(two.cursorProfiles.length === 2 && two.cursorProfile === "p2", "two");
const upd = acc.remember(two, { id: "p1", name: "you@x.com", email: "you@x.com" });
assert(upd.cursorProfiles[0].name === "you@x.com", "rename in place");
ok("remember");

const left = acc.unusedImports(
  [{ id: "cursor-a", name: "Grok A" }, { id: "extra", name: "Other" }],
  ["cursor-a"]
);
assert(left.length === 1 && left[0].id === "extra", "unused import");
ok("unused-imports");

assert(acc.displayName({ email: "a@b.com", name: "Nope" }) === "a@b.com", "email wins");
assert(acc.displayName({ name: "Pat" }) === "Pat", "name");
assert(acc.displayName({}, "Cursor") === "Cursor", "fallback");
ok("display-name");

const created = [];
const p = acc.addSignInProfile({
  list() { return created; },
  add(opts) {
    const row = { id: "p-" + (created.length + 1), kind: "cursor", name: opts.name };
    created.push(row);
    return row;
  },
});
assert(p.name === "My Cursor", p.name);
const p2 = acc.addSignInProfile({
  list() { return created; },
  add(opts) {
    const row = { id: "p-" + (created.length + 1), kind: "cursor", name: opts.name };
    created.push(row);
    return row;
  },
});
assert(p2.name === "Cursor 2" && p.id !== p2.id, "unique seats");
ok("add-sign-in");

const blank = require("./splash/onboarding.js").blank();
assert(Array.isArray(blank.cursorProfiles) && blank.cursorProfiles.length === 0, "blank list");
ok("blank-multi");

console.log(`\n${n}/${n} onboard-account groups passed`);
