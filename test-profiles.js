#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-profiles-"));
process.env.GROK_PROFILE_ROOT = tmp;
const store = require("./profile-store");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

store.ensureDirs();
let s = store.load();
assert(s.profiles.length >= 4, "seeded");
assert(s.activeId === "local-d", "default active");
assert(store.get("cursor-b").kind === "cursor", "b cursor");
assert(store.get("cursor-b").sourceUserData.includes("GrokBotB"), "b path");
ok("seed");

const extra = store.add({ name: "Lab", kind: "local" });
assert(extra.id.startsWith("p-"), extra.id);
assert(store.list().some((p) => p.id === extra.id), "listed");
ok("add-local");

const fam = store.add({
  name: "All on B",
  kind: "cursor",
  fromSeat: "A",
  identitySeat: "B",
  rosterSources: [store.SEATS.A, store.SEATS.B, store.SEATS.C],
});
assert(fam.identitySource === store.SEATS.B, fam.identitySource);
assert(fam.rosterSources.length === 3, "family roster");
ok("add-family-cursor");

const own = store.add({ name: "Sign in", kind: "cursor" });
assert(own.kind === "cursor", "sign-in kind");
assert(!own.identitySource && !own.sourceUserData, "sign-in has no seat path");
ok("add-cursor-signin");

store.setActive("cursor-b");
assert(store.getActive().id === "cursor-b", "active b");
const envC = store.writeActiveEnv(store.get("cursor-b"));
assert(envC.mode === "cursor", "cursor env");
assert(!envC.SAND_HOST_GATEWAY_URL, "no local gateway");
store.setActive("local-d");
const envL = store.writeActiveEnv(store.get("local-d"));
assert(envL.mode === "local" && envL.SAND_HOST_GATEWAY_URL.includes("1337"), "local env");
ok("env");

let threw = false;
try { store.remove("local-d"); } catch { threw = true; }
assert(threw, "protect local-d");
store.setActive("local-d");
const extraDir = store.profileDataDir(extra.id);
store.remove(extra.id);
assert(!store.get(extra.id), "removed lab");
assert(!fs.existsSync(extraDir), "data dir removed");
ok("remove-rules");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/${n} profile-store groups passed`);
