#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fo = require("./failover");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const now = 1_000_000;
const profiles = [
  { id: "local-d", kind: "local", name: "Local D" },
  { id: "cursor-a", kind: "cursor", name: "Grok A", seat: "A" },
  { id: "cursor-b", kind: "cursor", name: "Grok B", seat: "B" },
  { id: "cursor-c", kind: "cursor", name: "Grok C", seat: "C" },
];
const q = (pct, extra) => Object.assign({
  percentUsed: pct,
  hasLimit: true,
  at: now,
  nextResetMs: now + 86_400_000,
}, extra || {});

function ev(over) {
  return fo.evaluate(Object.assign({
    profiles,
    activeId: "cursor-b",
    payingProfileId: "cursor-b",
    rails: "cursor",
    quotas: { "cursor-a": q(10), "cursor-b": q(99), "cursor-c": q(20) },
    config: fo.defaultConfig({ enabled: true, nextCursor: true, localChief: true, localClone: true }),
    now,
    paused: false,
  }, over));
}

assert(fo.isExhausted(q(99), 98, now, 600000) === true, "99 exhausted");
assert(fo.isExhausted(q(50), 98, now, 600000) === false, "50 ok");
assert(fo.isExhausted(q(99, { at: now - 700000 }), 98, now, 600000) === false, "stale");
assert(fo.isExhausted(q(99, { nextResetMs: now - 1 }), 98, now, 600000) === false, "reset past");
assert(fo.isExhausted(null, 98, now, 600000) === false, "missing");
ok("isExhausted");

{
  const d = ev();
  assert(d && d.action === "cursor", d && d.action);
  assert(d.to === "cursor-a", d.to);
  assert(d.from === "cursor-b", d.from);
  assert(d.stopFirst === true, "stopFirst");
  assert(d.sameThread === false, "official not same thread");
}
ok("next-cursor");

{
  const d = ev({
    quotas: { "cursor-a": q(99), "cursor-b": q(99), "cursor-c": q(20) },
  });
  assert(d && d.to === "cursor-c", d && d.to);
}
ok("next-cursor-skip-spent-a");

{
  const d = ev({
    quotas: { "cursor-a": q(99), "cursor-b": q(99), "cursor-c": q(99) },
  });
  assert(d && d.action === "local-chief", d && d.action);
  assert(d.to === "local-d", d.to);
  assert(d.stopFirst === true, "chief stopFirst");
}
ok("all-cursor-spent-chief");

{
  const d = ev({
    quotas: { "cursor-a": q(99), "cursor-b": q(99), "cursor-c": q(99) },
    config: fo.defaultConfig({ enabled: true, nextCursor: true, localChief: false, localClone: true }),
  });
  assert(d && d.action === "local-clone", d.action);
}
ok("clone-last");

{
  const d = ev({
    config: fo.defaultConfig({ enabled: true, nextCursor: false, localChief: false, localClone: false }),
  });
  assert(d == null, "all toggles off");
}
ok("all-off");

{
  const d = ev({ config: fo.defaultConfig({ enabled: false, nextCursor: true }) });
  assert(d == null, "master off");
}
ok("master-off");

{
  const d = ev({
    activeId: "local-d",
    payingProfileId: "cursor-b",
    rails: "local",
    quotas: { "cursor-a": q(99), "cursor-b": q(99), "cursor-c": q(20) },
  });
  assert(d && d.action === "pin-account", d && d.action);
  assert(d.to === "cursor-c", d.to);
  assert(d.sameThread === true, "local rails same thread");
  assert(d.stopFirst === true, "pin stopFirst");
}
ok("local-pin");

{
  const d = ev({
    quotas: { "cursor-a": q(10), "cursor-b": q(92), "cursor-c": q(20) },
    paused: false,
  });
  assert(d && d.action === "soft-stop", d && d.action);
  assert(d.to == null, "soft-stop stays");
}
ok("soft-stop-warn");

{
  const d = ev({
    quotas: { "cursor-a": q(10), "cursor-b": q(92), "cursor-c": q(20) },
    paused: true,
  });
  assert(d == null, "already paused at warn");
}
ok("soft-stop-skip-if-paused");

{
  const d = ev({
    lastFireAt: now - 60_000,
    config: fo.defaultConfig({ enabled: true, nextCursor: true, cooldownMs: 15 * 60 * 1000 }),
  });
  assert(d == null, "cooldown");
}
ok("cooldown");

{
  const d = ev({ activeId: "cursor-c", payingProfileId: "cursor-c" });
  assert(d == null, "current not exhausted");
}
ok("not-exhausted");

{
  const d = ev({
    pausedIds: { "local-d": true },
    quotas: { "cursor-a": q(10), "cursor-b": q(92), "cursor-c": q(20) },
  });
  assert(d && d.action === "soft-stop", d && d.action);
}
ok("paused-other-seat-still-warns");

{
  const d = ev({
    pausedIds: { "cursor-a": true },
    quotas: { "cursor-a": q(10), "cursor-b": q(99), "cursor-c": q(20) },
  });
  assert(d && d.to === "cursor-c", d && d.to);
}
ok("skip-paused-destination");

console.log(`\n${n}/14 failover checks passed`);
