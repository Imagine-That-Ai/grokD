#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clone-"));
process.env.GROK_PROFILE_ROOT = tmp;
process.env.GROKBOT_HACK = path.join(tmp, "hack");
const { cloneAgent } = require("./clone-bot");
const { pickChief, buildPack, writePack } = require("./handoff-pack");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const srcId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const agents = path.join(tmp, "hack", "box-data", "agents");
const src = path.join(agents, srcId);
fs.mkdirSync(path.join(src, "automations", "daily"), { recursive: true });
fs.writeFileSync(path.join(src, "profile.json"), JSON.stringify({ name: "Worker" }) + "\n");
fs.writeFileSync(path.join(src, "settings.json"), "{}\n");
fs.writeFileSync(path.join(src, "store.db"), "db\n");
fs.writeFileSync(path.join(src, "automations", "daily", "automation.json"), JSON.stringify({
  name: "Daily", enabled: true, isEnabled: true, schedule: "0 9 * * *",
}) + "\n");

const cloned = cloneAgent(srcId, { agentsDir: agents, destId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
assert(cloned.destId === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cloned.destId);
assert(fs.existsSync(path.join(agents, cloned.destId, "store.db")), "copied db");
assert(fs.existsSync(src + "/store.db"), "source kept");
const destProf = JSON.parse(fs.readFileSync(path.join(agents, cloned.destId, "profile.json"), "utf8"));
assert(destProf.origin === "failover-clone", destProf.origin);
assert(destProf.clonedFrom.agentId === srcId, "clonedFrom");
assert(/clone/i.test(destProf.name), destProf.name);
const destAuto = JSON.parse(fs.readFileSync(path.join(agents, cloned.destId, "automations", "daily", "automation.json"), "utf8"));
assert(destAuto.enabled === false && destAuto.isEnabled === false, "clone autos parked");
const srcAuto = JSON.parse(fs.readFileSync(path.join(src, "automations", "daily", "automation.json"), "utf8"));
assert(srcAuto.enabled === true, "source auto still on");
ok("clone");

let threw = false;
try { cloneAgent("not-a-uuid", { agentsDir: agents }); } catch { threw = true; }
assert(threw, "bad id");
ok("clone-missing");

const rebuilt = cloneAgent("cccccccc-cccc-cccc-cccc-cccccccccccc", {
  agentsDir: agents,
  destId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  lastUser: "keep going on the hover tip",
  profileId: "cursor-b",
});
assert(rebuilt.reconstructed === true, "reconstructed");
assert(fs.existsSync(path.join(agents, rebuilt.destId, "memory", "log", "failover.md")), "seed memory");
assert(/hover tip/.test(fs.readFileSync(path.join(agents, rebuilt.destId, "memory", "log", "failover.md"), "utf8")), "captured turn");
ok("clone-reconstruct");

const chief = pickChief([
  { id: "1", name: "Worker" },
  { id: "2", name: 'grok"D"' },
  { id: "3", name: "Night Shift Chief" },
], null);
assert(chief && chief.id === "3", JSON.stringify(chief));
assert(pickChief([{ id: "2", name: 'grok"D"' }]).id === "2", "grok d");
assert(pickChief([{ id: "9", name: "Only" }], "9").id === "9", "preferred");
ok("pickChief");

const pack = buildPack({
  from: "cursor-b",
  to: "local-d",
  why: "quota spent",
  lastUser: "finish the hover tip",
  agents: [{ id: "3", name: "Night Shift Chief" }],
});
assert(/Fall-over handoff/.test(pack), pack);
assert(/cursor-b/.test(pack), pack);
assert(/finish the hover tip/.test(pack), pack);
assert(/Night Shift Chief/.test(pack), pack);
const file = writePack(pack);
assert(fs.existsSync(file), file);
assert(fs.readFileSync(file, "utf8") === pack, "written");
ok("pack");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/5 clone-handoff checks passed`);
