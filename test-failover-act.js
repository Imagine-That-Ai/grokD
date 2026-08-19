#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-foact-"));
process.env.GROK_PROFILE_ROOT = tmp;
const assert = (c, m) => { if (!c) throw new Error(m); };
const { act } = require("./failover-act");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

(async () => {
  const order = [];
  const r = await act({
    action: "soft-stop",
    from: "cursor-b",
    stopFirst: true,
  }, {
    pause: async () => { order.push("pause"); return { paused: true }; },
    switchTo: () => { order.push("switch"); },
  });
  assert(r.ok === true, "ok");
  assert(order.join(",") === "pause", order.join(","));
  ok("soft-stop-pauses-only");

  const r2 = await act(null, { pause: async () => { order.push("nope"); } });
  assert(r2.skipped === true, "skip empty");
  ok("skip-empty");

  const clones = [];
  const packs = [];
  const r3 = await act({
    action: "local-clone",
    from: "cursor-b",
    to: "local-d",
    stopFirst: true,
    reason: "spent",
  }, {
    pause: async () => { order.push("pause"); },
    switchTo: () => { order.push("switch"); },
    sourceAgentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    clone: (id) => { clones.push(id); return { destId: "clone-1" }; },
    pack: {
      buildPack: (o) => { packs.push(o); return "# pack"; },
      writePack: (t) => "/tmp/pack.md",
      pickChief: () => ({ id: "chief", name: "Chief" }),
    },
    sendPrompt: () => true,
  });
  assert(r3.ok === true, "clone act");
  assert(clones[0] === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "cloned source");
  assert(packs.length === 1, "pack built");
  ok("local-clone-lands");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n}/3 failover-act checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
