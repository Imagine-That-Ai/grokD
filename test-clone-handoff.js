#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clone-"));
process.env.GROK_PROFILE_ROOT = tmp;
process.env.GROKBOT_HACK = path.join(tmp, "hack");
const { cloneAgent, createAgentAtomically } = require("./clone-bot");
const { pickChief, buildPack, writePack, packBody } = require("./handoff-pack");
const { inspectAgentStoreDb } = require("./agent-store-db");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const srcId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const agents = path.join(tmp, "hack", "box-data", "agents");
const src = path.join(agents, srcId);
fs.mkdirSync(path.join(src, "automations", "daily"), { recursive: true });
fs.writeFileSync(path.join(src, "profile.json"), JSON.stringify({ name: "Worker" }) + "\n");
fs.writeFileSync(path.join(src, "settings.json"), "{}\n");
execFileSync("sqlite3", [
  path.join(src, "store.db"),
  "CREATE TABLE transcript_entries (id TEXT, entry TEXT);"
    + " INSERT INTO transcript_entries VALUES ('legacy-turn','{\"kind\":\"message\"}');",
]);
fs.writeFileSync(path.join(src, "automations", "daily", "automation.json"), JSON.stringify({
  name: "Daily", enabled: true, isEnabled: true, schedule: "0 9 * * *",
}) + "\n");

const cloned = cloneAgent(srcId, { agentsDir: agents, destId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
assert(cloned.destId === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cloned.destId);
assert(fs.existsSync(path.join(agents, cloned.destId, "store.db")), "copied db");
assert(fs.existsSync(src + "/store.db"), "source kept");
assert(inspectAgentStoreDb(path.join(agents, cloned.destId, "store.db")).canonical, "clone store not repaired");
assert(
  execFileSync("sqlite3", [
    path.join(agents, cloned.destId, "store.db"),
    "SELECT id FROM transcript_entries;",
  ], { encoding: "utf8" }).trim() === "legacy-turn",
  "clone turn lost"
);
const destProf = JSON.parse(fs.readFileSync(path.join(agents, cloned.destId, "profile.json"), "utf8"));
assert(destProf.origin === "failover-clone", destProf.origin);
assert(destProf.clonedFrom.agentId === srcId, "clonedFrom");
assert(/clone/i.test(destProf.name), destProf.name);
const destAuto = JSON.parse(fs.readFileSync(path.join(agents, cloned.destId, "automations", "daily", "automation.json"), "utf8"));
assert(destAuto.enabled === false && destAuto.isEnabled === false, "clone autos parked");
const srcAuto = JSON.parse(fs.readFileSync(path.join(src, "automations", "daily", "automation.json"), "utf8"));
assert(srcAuto.enabled === true, "source auto still on");
assert(!fs.readdirSync(agents).some((name) => name.startsWith(".grokd-agent-")), "clone staging leaked");
ok("clone");

let threw = false;
try { cloneAgent("not-a-uuid", { agentsDir: agents }); } catch { threw = true; }
assert(threw, "bad id");
ok("clone-missing");

const failedId = "12121212-1212-4212-8212-121212121212";
let visibleBeforePublish = true;
let stagedFailure = false;
try {
  createAgentAtomically(agents, failedId, (staging) => {
    visibleBeforePublish = fs.existsSync(path.join(agents, failedId));
    fs.writeFileSync(path.join(staging, "partial.txt"), "partial\n");
    throw new Error("simulated build failure");
  });
} catch (error) {
  stagedFailure = /simulated build failure/.test(String(error && error.message || error));
}
assert(stagedFailure, "staged agent failure was swallowed");
assert(visibleBeforePublish === false, "UUID directory was visible before publish");
assert(!fs.existsSync(path.join(agents, failedId)), "failed agent was published");
assert(!fs.readdirSync(agents).some((name) => name.includes(failedId)), "failed staging directory remained");
ok("atomic-agent-publish");

const rebuilt = cloneAgent("cccccccc-cccc-cccc-cccc-cccccccccccc", {
  agentsDir: agents,
  destId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  lastUser: "keep going on the hover tip",
  profileId: "cursor-b",
});
assert(rebuilt.reconstructed === true, "reconstructed");
assert(fs.existsSync(path.join(agents, rebuilt.destId, "memory", "log", "failover.md")), "seed memory");
assert(inspectAgentStoreDb(path.join(agents, rebuilt.destId, "store.db")).canonical, "reconstructed store");
const memo = fs.readFileSync(path.join(agents, rebuilt.destId, "memory", "log", "failover.md"), "utf8");
assert(/hover tip/.test(memo), "captured turn");
const withTurns = cloneAgent("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", {
  agentsDir: agents,
  destId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  lastUser: "one",
  excerpts: ["user: keep the hover", "assistant: on it"],
});
assert(/keep the hover/.test(fs.readFileSync(path.join(agents, withTurns.destId, "memory", "log", "failover.md"), "utf8")), "excerpts");
assert(inspectAgentStoreDb(path.join(agents, withTurns.destId, "store.db")).canonical, "excerpt store");
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
assert(packBody(file) === pack, "packBody reads file");
assert(packBody("# already markdown") === "# already markdown", "packBody passthrough");
assert(packBody("/no/such/handoff-missing.md") === "", "missing pack file is empty not a path");
ok("pack");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/6 clone-handoff checks passed`);
