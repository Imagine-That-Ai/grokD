#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const q = require("./seat-quota");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const now = 1_700_000_000_000;

{
  const a = q.stampExhausted(null, { percentUsed: 40, at: now, nextResetMs: now + 86400000 }, 98, now);
  assert(a.exhaustedAt == null, "fresh not spent");
  const b = q.stampExhausted(a, { percentUsed: 99, at: now + 1000, nextResetMs: now + 86400000 }, 98, now + 1000);
  assert(b.exhaustedAt === now + 1000, "first spent stamps");
  const c = q.stampExhausted(b, { percentUsed: 100, at: now + 5000, nextResetMs: now + 86400000 }, 98, now + 5000);
  assert(c.exhaustedAt === now + 1000, "keeps first ran-out");
  const d = q.stampExhausted(c, { percentUsed: 12, at: now + 90000000, nextResetMs: now + 180000000 }, 98, now + 90000000);
  assert(d.exhaustedAt == null, "clears after recover");
}
ok("stampExhausted");

{
  const wall = q.formatWall(Date.parse("2026-08-16T20:52:00-05:00"));
  assert(/Aug\s+16,\s*8:52\s*PM/i.test(wall), "formatWall must format month, day, time and AM/PM: " + wall);
  assert(q.formatWall(null) == null, "bad");
}
ok("formatWall");

{
  const text = q.hoverText({
    quota: {
      percentUsed: 100,
      exhaustedAt: Date.parse("2026-08-16T20:52:00-05:00"),
      nextResetMs: Date.parse("2026-08-17T08:22:00-05:00"),
    },
    stoppedAt: Date.parse("2026-08-18T22:10:00-05:00"),
  });
  assert(/100%/.test(text), text);
  assert(/Ran out/.test(text), text);
  assert(/Back/.test(text), text);
  assert(/Stopped/.test(text), text);
  assert(text.split("\n").length >= 4, text);
}
ok("hoverText");

{
  const text = q.hoverText({ quota: { percentUsed: 14.9, nextResetMs: Date.parse("2026-08-25T08:00:00-05:00") } });
  assert(/15%/.test(text), text);
  assert(!/Ran out/.test(text), text);
  assert(/Back/.test(text), text);
  assert(!/Stopped/.test(text), text);
}
ok("hover-not-spent");

console.log(`\n${n}/4 quota-hover checks passed`);
