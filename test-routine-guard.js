#!/usr/bin/env node
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const path = require("path");
const { scanOnce, shouldPark } = require("./routine-guard");

const agentDir = "/tmp/grokbot-hack/box-data/agents/_guardtest";
const file = path.join(agentDir, "automations", "fake", "automation.json");

let n = 0;
const ok = (name) => { n++; console.log(`PASS  ${name}`); };

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({
  name: "Joke flood test",
  prompt: "test",
  schedule: "* * * * *",
  enabled: true,
}, null, 2) + "\n");

try {
  scanOnce();
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(after.enabled === false, `enabled ${after.enabled}`);
  assert(after.schedule === "0 0 1 1 *", `schedule ${after.schedule}`);
  ok("scanOnce parks fake every-minute automation");

  assert(
    shouldPark("9b916ddb-76be-4d38-a62d-abf785a0e49d", "8468e7f8-keep-test", {
      name: "Minute Jokes",
      schedule: "* * * * *",
      enabled: true,
    }) === false,
    "keep id parked"
  );
  ok("shouldPark keeps lol Minute Jokes (8468e7f8)");

  assert(
    shouldPark("9b916ddb-76be-4d38-a62d-abf785a0e49d", "minute-jokes", {
      name: "Minute Jokes",
      schedule: "* * * * *",
      enabled: true,
    }) === true,
    "other lol joke"
  );
  assert(
    shouldPark("e219204f-eadc-4dfa-893f-8ca572650ee4", "harness-pulse", {
      name: "Harness Pulse",
      schedule: "0 0 1 1 *",
      enabled: true,
    }) === true,
    "Harness prefix"
  );
  assert(
    shouldPark("aaaa1111", "daily", {
      name: "Daily digest",
      schedule: "0 9 * * *",
      enabled: true,
    }) === false,
    "unrelated"
  );
  ok("shouldPark joke / harness / leave-alone");
} finally {
  fs.rmSync(agentDir, { recursive: true, force: true });
}

console.log(`\n${n}/3 routine-guard checks passed`);
