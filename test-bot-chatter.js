#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const bc = require("./bot-chatter");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

{
  const hit = bc.parseChatter("[Bot-to-bot from sally]: Reply with exactly MSG-1 and nothing else.");
  assert(hit && hit.from === "sally", JSON.stringify(hit));
  assert(hit.body === "Reply with exactly MSG-1 and nothing else.", hit.body);
  assert(bc.parseChatter("just a normal prompt") == null, "plain prompt");
  assert(bc.parseChatter("") == null, "empty");
}
ok("parseChatter");

{
  assert(bc.sameBot("sally", "sally the seashell slinging slut"), "prefix name");
  assert(bc.sameBot("Chief Mini Me", "chief mini me "), "case + space");
  assert(!bc.sameBot("sally", "salt lake"), "different bot");
  assert(!bc.sameBot("Y", "Yolanda"), "two-letter name is not a prefix match");
  assert(!bc.sameBot("", "sally"), "empty");
}
ok("sameBot");

{
  const a = bc.markFor("CLI Guy");
  const b = bc.markFor("CLI Guy");
  assert(a.hex === b.hex && a.shape === b.shape, "stable per name");
  const unk = bc.markFor("Factory Commander");
  assert(/^#[0-9a-fA-F]{6}$/i.test(unk.hex), "unknown name gets a valid hex color");
  assert(bc.COLORS.some((c) => c.hex.toLowerCase() === unk.hex.toLowerCase()), "unknown name color maps to palette");
  const set = bc.markFor("grok\"D\"", { avatarShape: "hex", avatarColor: "purple" });
  assert(set.shape === "hex", set.shape);
  assert(set.hex === bc.COLORS.find((c) => c.key === "violet").hex, set.hex);
  assert(!bc.COLORS.some((c) => /^#e2e8f0$/i.test(c.hex)), "no near-white mark colour");
}
ok("markFor");

{
  const grad = bc.gradientOf([bc.markFor("a"), bc.markFor("b"), bc.markFor("c")]);
  assert(/linear-gradient/.test(grad) && grad.split("#").length === 4, grad);
  assert(bc.gradientOf([bc.markFor("a")]).split("#").length === 3, "single bot fades its own colour");
}
ok("gradientOf");

{
  assert(bc.readableTint("light-dark(#A97EFE, #804EE0)") === "light-dark(#804EE0, #A97EFE)",
    bc.readableTint("light-dark(#A97EFE, #804EE0)"));
  assert(bc.readableTint("#ff1e56") === "#ff1e56", "plain colour passes through");
  assert(bc.readableTint("") === "", "empty");
}
ok("readableTint");

// user prompt, bot answer, then a two-message exchange with sally, then a
// normal user prompt again.
const entries = [
  { id: "t0u", kind: "message", role: "user", content: "tell me a joke", ts: 1000 },
  { id: "t0s0", kind: "send-message", role: "assistant", content: "here you go", ts: 1100 },
  { id: "t1u", kind: "message", role: "user", content: "[Bot-to-bot from sally]: ping", ts: 2000 },
  { id: "t1s0", kind: "send-message", role: "assistant", content: "pong", ts: 2100 },
  { id: "t2u", kind: "message", role: "user", content: "[Bot-to-bot from CLI Guy]: status?", ts: 2200 },
  { id: "t2s0", kind: "send-message", role: "assistant", content: "green", ts: 2300 },
  { id: "t3u", kind: "message", role: "user", content: "thanks", ts: 3000 },
];

{
  const { runs, byKey } = bc.buildRuns(entries, []);
  assert(runs.length === 1, "one run: " + runs.length);
  const run = runs[0];
  assert(run.kind === "hidden" && run.headKey === "t1u", JSON.stringify(run));
  assert(run.hide.join(",") === "t1u,t1s0,t2u,t2s0", run.hide.join(","));
  assert(run.inCount === 2 && run.outCount === 0, "answers hide but do not count: " + run.inCount);
  assert(run.partners.length === 2, run.partners.join("|"));
  assert(byKey.get("t1u") === run, "head keyed to the run");
  assert(byKey.get("t2s0").hidden === true, "later rows hide");
  assert(!byKey.has("t0u") && !byKey.has("t3u"), "normal rows untouched");
}
ok("buildRuns-hidden");

{
  // a send with no reply anchors under the row it followed
  const { runs, byKey, afterKey } = bc.buildRuns(entries, [{ to: "Factory Commander", ts: 3100, text: "go" }]);
  const anchor = runs.find((r) => r.kind === "anchor");
  assert(anchor && anchor.headKey === "t3u", JSON.stringify(anchor));
  assert(anchor.outCount === 1 && anchor.inCount === 0, "outbound only");
  assert(afterKey.get("t3u") === anchor, "anchored under its row");
  assert(!byKey.has("t3u"), "the row itself still renders");
}
ok("buildRuns-anchor");

{
  // a send that the run right after it answers folds into that run
  const { runs } = bc.buildRuns(entries, [{ to: "sally", ts: 1500, text: "you up?" }]);
  const hidden = runs.find((r) => r.kind === "hidden");
  assert(runs.filter((r) => r.kind === "anchor").length === 0, "no stray anchor");
  assert(hidden.outCount === 1 && hidden.inCount === 2, hidden.outCount + "/" + hidden.inCount);
}
ok("buildRuns-absorb");

{
  const one = bc.runLabel({ inCount: 3, outCount: 0, partners: ["Chief Mini Me"] });
  assert(one.count === "3" && one.lead === "messages with" && one.name === "Chief Mini Me", JSON.stringify(one));
  const many = bc.runLabel({ inCount: 2, outCount: 2, partners: ["a", "b"] });
  assert(many.count === "4" && many.name === "2 Bots", JSON.stringify(many));
  const sent = bc.runLabel({ inCount: 0, outCount: 3, partners: ["a", "b", "c"] });
  assert(sent.count === "" && sent.lead === "Messaged" && sent.name === "3 Bots", JSON.stringify(sent));
  const solo = bc.runLabel({ inCount: 1, outCount: 0, partners: ["sally"] });
  assert(solo.lead === "message with", solo.lead);
}
ok("runLabel");

{
  const mine = [
    { id: "a1", content: "[Bot-to-bot from sally]: pong", ts: 200 },
    { id: "a2", content: "a normal prompt", ts: 250 },
  ];
  const theirs = [
    { id: "b1", content: "[Bot-to-bot from Robust Bench]: ping", ts: 100 },
    { id: "b2", content: "[Bot-to-bot from someone else]: hi", ts: 150 },
  ];
  const thread = bc.mergeThread("Robust Bench", "sally the seashell slinging slut", mine, theirs);
  assert(thread.length === 2, JSON.stringify(thread));
  assert(thread[0].dir === "out" && thread[0].text === "ping", JSON.stringify(thread[0]));
  assert(thread[1].dir === "in" && thread[1].text === "pong", JSON.stringify(thread[1]));
}
ok("mergeThread");

{
  const grok = bc.modelBadge("grok-4.5");
  assert(grok.logo === "grok.svg" && grok.short === "4.5", JSON.stringify(grok));
  assert(bc.modelBadge("grok-composer-2.5-fast").short === "Composer 2.5", "composer");
  assert(bc.modelBadge("claude-opus-5").short === "Opus 5", bc.modelBadge("claude-opus-5").short);
  assert(bc.modelBadge("claude-sonnet-4-6").short === "Sonnet 4.6", bc.modelBadge("claude-sonnet-4-6").short);
  assert(bc.modelBadge("gpt-5.6-luna").short === "GPT 5.6", bc.modelBadge("gpt-5.6-luna").short);
  assert(bc.modelBadge("deepseek/deepseek-v4-flash").logo === "deepseek-color.svg", "deepseek");
  assert(bc.modelBadge("kimi/k3").short === "K3", bc.modelBadge("kimi/k3").short);
  const odd = bc.modelBadge("some/unknown-model");
  assert(odd.logo === "xai.svg" && odd.short === "unknown-model", JSON.stringify(odd));
}
ok("modelBadge");

{
  const svg = bc.logoSvg("grok.svg", 11, "#F4F4F5");
  assert(/width="11"/.test(svg) && /height="11"/.test(svg), "sized");
  assert(!/currentColor/.test(svg), "filled");
  assert(/<svg/.test(bc.logoSvg("claude-color.svg", 12)), "colour logo reads");
  assert(bc.logoSvg("nope.svg", 11) === "", "missing logo is empty, not a throw");
}
ok("logoSvg");

{
  assert(bc.esc('<b>"x"</b>') === "&lt;b&gt;&quot;x&quot;&lt;/b&gt;", bc.esc('<b>"x"</b>'));
  assert(bc.clockTime(0) === "", "no stamp");
  const clock = bc.clockTime(Date.parse("2026-08-19T01:06:00-05:00"));
  assert(/^(0?1:06\s*AM)$/i.test(clock.trim()), "clockTime matches 1:06 AM: " + clock);
}
ok("esc+clockTime");

console.log(`\n${n}/13 bot-chatter checks passed`);
