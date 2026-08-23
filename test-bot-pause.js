#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-pause-"));
process.env.GROK_PROFILE_ROOT = tmp;
process.env.GROKBOT_HACK = path.join(tmp, "hack");
process.env.GROK_SEAT4 = path.join(tmp, "seat4");

const pause = require("./bot-pause");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

function writeAuto(root, agentId, folder, cfg) {
  const f = path.join(root, agentId, "automations", folder, "automation.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
  return f;
}

const agents = path.join(process.env.GROKBOT_HACK, "box-data", "agents");
const joke = writeAuto(agents, "9b916ddb-76be-4d38-a62d-abf785a0e49d", "8468e7f8-aec9-4ebf-a8f6-5511f0b5a7b4", {
  name: "Minute Jokes",
  schedule: "* * * * *",
  enabled: true,
  isEnabled: true,
});
const daily = writeAuto(agents, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "daily", {
  name: "Daily digest",
  schedule: "30 7 * * 1-5",
  enabled: true,
});
const already = writeAuto(agents, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "off", {
  name: "Already off",
  schedule: "0 9 * * *",
  enabled: false,
});

(async () => {
try {
assert(pause.isPaused() === false, "starts unpaused");
assert(pause.isPaused("local-d") === false, "local not paused");
ok("not-paused");

const r1 = await pause.pause({ seats: ["local-d"], computers: [] });
assert(r1.paused === true, "pause returns paused");
assert(pause.isPaused("local-d") === true, "local paused");
assert(Number(pause.pausedAt("local-d")) > 0, "stopped at stamped");
assert(pause.isPaused("cursor-a") === false, "A not paused");
assert(JSON.parse(fs.readFileSync(joke, "utf8")).enabled === false, "joke disabled");
assert(JSON.parse(fs.readFileSync(daily, "utf8")).enabled === false, "daily disabled");
assert(JSON.parse(fs.readFileSync(already, "utf8")).enabled === false, "already-off stays off");
assert(r1.localDisabled >= 2, `localDisabled ${r1.localDisabled}`);
assert(r1.saved.some((s) => s.name === "Minute Jokes"), "saved joke");
assert(!r1.saved.some((s) => s.name === "Already off"), "did not save already-off");
ok("pause-local");

const r1b = await pause.pause({ seats: ["local-d"], computers: [] });
assert(r1b.already === true, "second pause is already");
ok("pause-idempotent");

const r2 = await pause.resume({ seats: ["local-d"], computers: [] });
assert(pause.isPaused("local-d") === false, "local resumed");
assert(JSON.parse(fs.readFileSync(joke, "utf8")).enabled === true, "joke re-enabled");
assert(JSON.parse(fs.readFileSync(daily, "utf8")).enabled === true, "daily re-enabled");
assert(JSON.parse(fs.readFileSync(already, "utf8")).enabled === false, "already-off stays off");
assert(r2.localRestored >= 2, `localRestored ${r2.localRestored}`);
ok("resume-local");

const calls = [];
const fakePost = async (conn, method, body) => {
  const tag = conn && conn.tag ? conn.tag : "cursor-a";
  calls.push({ tag, method, body });
  if (method === "listAgents") {
    return [
      { id: "run-1", name: "Factory Commander", isRunning: true },
      { id: "idle-1", name: "Idle Bot", isRunning: false },
    ];
  }
  if (method === "getAgentAutomations") {
    return [
      { id: "cron-a", name: "Morning", isEnabled: true },
      { id: "cron-b", name: "Off", isEnabled: false },
    ];
  }
  if (method === "interruptAgentRun") return { hadActiveRun: true };
  if (method === "setAgentAutomationEnabled") return [];
  throw new Error("unexpected " + method);
};

await pause.pause({
  seats: ["cursor-a"],
  computers: [
    { tag: "cursor-a", baseUrl: "https://pod.example/a", token: "t" },
    { tag: "cursor-b", baseUrl: "https://pod.example/b", token: "t" },
  ],
  post: fakePost,
});
assert(calls.some((c) => c.tag === "cursor-a" && c.method === "setAgentAutomationEnabled" && c.body.isEnabled === false), "disable A cron");
assert(!calls.some((c) => c.tag === "cursor-b"), "did not touch B cron");
assert(calls.some((c) => c.tag === "cursor-a" && c.method === "interruptAgentRun" && c.body.id === "run-1"), "interrupt A");
assert(!calls.some((c) => c.tag === "cursor-b"), "did not touch B");
assert(pause.isPaused("cursor-a") === true, "A paused");
assert(pause.isPaused("cursor-b") === false, "B running");
assert(pause.isPaused("local-d") === false, "local still running");
ok("pause-seat-a-only");

const r3 = await pause.resume({
  seats: ["cursor-a"],
  computers: [
    { tag: "cursor-a", baseUrl: "https://pod.example/a", token: "t" },
    { tag: "cursor-b", baseUrl: "https://pod.example/b", token: "t" },
  ],
  post: fakePost,
});
assert(calls.some((c) => c.tag === "cursor-a" && c.method === "setAgentAutomationEnabled" && c.body.isEnabled === true), "resume A cron");
assert(pause.isPaused("cursor-a") === false, "A cleared");
ok("resume-seat-a");

assert(pause.shouldFireAutomation() === true, "unpaused fires");
await pause.pause({ seats: ["local-d"], computers: [] });
assert(pause.shouldFireAutomation() === false, "local paused does not fire");
await pause.resume({ seats: ["local-d"], computers: [] });
await pause.pause({ seats: ["cursor-a"], computers: [{ tag: "cursor-a", baseUrl: "https://pod.example/a", token: "t" }], post: fakePost });
assert(pause.shouldFireAutomation() === true, "A paused still allows local crons");
ok("shouldFire-per-seat");

const started = Date.now();
const fast = await pause.pause({
  seats: ["cursor-c"],
  computers: [{ tag: "cursor-c", baseUrl: "https://pod.example/c", token: "t" }],
  post: () => new Promise(() => {}),
  waitRemote: false,
});
assert(fast.pendingRemote === true, "returns before remote");
assert(pause.isPaused("cursor-c") === true, "marked paused immediately");
assert(Date.now() - started < 200, "did not wait on hung remote");
ok("pause-fast");

console.log(`\n${n}/8 bot-pause checks passed`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
})().catch((e) => { console.error(e); process.exit(1); });
