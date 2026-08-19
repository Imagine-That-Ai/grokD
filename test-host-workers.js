#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const host = path.join(__dirname, "host");
const worker = path.join(host, "agent-isolation", "agent-store-worker.cjs");
const mirror = path.join(host, "agent-isolation", "transcript-mirror-worker.cjs");
if (!fs.existsSync(path.join(host, "host-main.cjs"))) {
  console.log("SKIP  host-workers (extract host-main.cjs from official Grok Bot)");
  process.exit(0);
}
assert(fs.existsSync(worker), "agent-store-worker next to host-main");
assert(fs.existsSync(mirror), "transcript-mirror-worker");
assert(fs.statSync(worker).size > 1000, "worker not empty");
console.log("PASS  host-workers");
