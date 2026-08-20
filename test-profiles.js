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
assert(store.get("local-d"), "local-d");
assert(s.activeId === "local-d", "default active");
assert(!store.get("cursor-b"), "no grok b");
assert(!store.get("cursor-c"), "no grok c");
ok("seed");

let retired = false;
try { store.add({ id: "cursor-b", name: "Grok B", kind: "cursor" }); }
catch (e) { retired = /retired/.test(String(e.message || e)); }
assert(retired, "cannot add retired B");
let retiredImport = false;
try { store.importDetected("cursor-b"); }
catch { retiredImport = true; }
assert(retiredImport, "cannot import retired B");
const dirty = store.load();
dirty.profiles.push({ id: "cursor-b", name: "Grok B", kind: "cursor" });
dirty.profiles.push({ id: "cursor-c", name: "Grok C", kind: "cursor" });
store.save(dirty);
assert(!store.get("cursor-b") && !store.get("cursor-c"), "load prunes retired");
ok("retired-bc");

const extra = store.add({ name: "Lab", kind: "local" });
assert(extra.id.startsWith("p-"), extra.id);
assert(store.list().some((p) => p.id === extra.id), "listed");
ok("add-local");

let blockedB = false;
try { store.add({ name: "From B", kind: "cursor", fromSeat: "B" }); }
catch (e) { blockedB = /retired seat B/.test(String(e.message || e)); }
assert(blockedB, "fromSeat B blocked");
let blockedId = false;
try { store.add({ name: "Id B", kind: "cursor", fromSeat: "A", identitySeat: "B" }); }
catch (e) { blockedId = /retired seat B/.test(String(e.message || e)); }
assert(blockedId, "identitySeat B blocked");
const fromA = store.add({ name: "From A", kind: "cursor", fromSeat: "A" });
assert(fromA.identitySource === store.SEATS.A, fromA.identitySource);
ok("block-bc-import");

const own = store.add({ name: "Sign in", kind: "cursor" });
assert(own.kind === "cursor", "sign-in kind");
assert(!own.identitySource && !own.sourceUserData, "sign-in has no seat path");
ok("add-cursor-signin");

const fakeA = path.join(tmp, "Grok Bot");
fs.mkdirSync(fakeA, { recursive: true });
fs.writeFileSync(path.join(fakeA, "sand-secrets.json"), "{}\n");
store.SEATS.A = fakeA;
const imported = store.importDetected("cursor-a");
assert(imported.id === "cursor-a", imported.id);
assert(store.importDetected("cursor-a").id === "cursor-a", "idempotent");
let unknown = false;
try { store.importDetected("cursor-z"); } catch { unknown = true; }
assert(unknown, "unknown import fails closed");
ok("import-detected");

store.setActive(own.id);
assert(store.getActive().id === own.id, "active sign-in");
const envC = store.writeActiveEnv(store.get(own.id));
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
