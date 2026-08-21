#!/usr/bin/env node
// The cover's sky is generated, so the checks are on its invariants: never the
// same twice, always clear of the mark, and never two holes close enough that
// the shader would slice one disk along the other's march circle.
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const k = require("./space-kernel");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

// same units the placement rule uses: a 900px-tall reference sky
const REF = k.refSize();
function gap(a, b) {
  const du = (a.u - b.u) * REF.w;
  const dv = (a.v - b.v) * REF.h;
  return Math.sqrt(du * du + dv * dv);
}
function need(a, b) {
  return Math.max(a.r * k.MARCH_R + b.r * k.DISK_R, b.r * k.MARCH_R + a.r * k.DISK_R);
}
function checkSky(holes, slack, where) {
  assert(holes.length >= 1, where + " empty sky");
  for (const h of holes) {
    assert(h.u >= 0 && h.u <= 1 && h.v >= 0 && h.v <= 1, where + " on screen");
    assert(h.r > 0 && h.r < 200, where + " radius " + h.r);
    assert(h.temp >= 0 && h.temp <= 1, where + " temp " + h.temp);
    assert(h.fade >= 0 && h.fade <= 1, where + " fade " + h.fade);
  }
  for (let i = 1; i < holes.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = gap(holes[i], holes[j]);
      assert(d >= need(holes[i], holes[j]) * slack,
        where + " overlap: " + d.toFixed(0) + " < " + need(holes[i], holes[j]).toFixed(0));
    }
  }
}

{
  const sky = k.seedHoles();
  assert(sky.length === 1, "one horizon: " + sky.length);
  sky.forEach((h) => assert(k.clearOfMark(h.u, h.v), "clear of the mark"));
  sky.forEach((h) => assert(h.fade === 1, "opens as a sky, not a fade-in"));
  checkSky(sky, 1.0, "seed");
}
ok("seedHoles");

{
  assert(k.clearOfMark(0.06, 0.5) && k.clearOfMark(0.5, 0.05), "edges are clear");
  assert(!k.clearOfMark(0.5, 0.5) && !k.clearOfMark(0.3, 0.45), "the mark's box is not");
}
ok("clearOfMark");

{
  // no two skies alike: count, placement or size has to differ
  const a = k.seedHoles();
  const b = k.seedHoles();
  const key = (sky) => sky.map((h) => [h.u, h.v, h.r, h.temp].map((x) => x.toFixed(3)).join()).join("|");
  assert(key(a) !== key(b), "two skies came out identical");
}
ok("never-the-same");

{
  // half an hour at 30fps: holes must drift, breathe, turn over, and never
  // crowd each other. The push-apart runs once per tick, so a tick can end
  // mid-correction — hence the slack.
  let sky = k.seedHoles();
  const watch = sky[0];
  let minR = Infinity;
  let maxR = 0;
  let travel = 0;
  // a dying hole is replaced inside the same tick, so succession shows up as
  // new identities, not as a change in count
  const lived = new Set(sky);
  let counts = new Set();
  let seen = sky.length;
  const dt = 1 / 30;
  for (let step = 0; step < 30 * 60 * 30; step++) {
    const has = sky.includes(watch);
    sky = k.tickHoles(sky, dt, step * dt);
    sky.forEach((h) => lived.add(h));
    counts.add(sky.length);
    seen = Math.max(seen, sky.length);
    if (has && sky.includes(watch)) {
      minR = Math.min(minR, watch.r);
      maxR = Math.max(maxR, watch.r);
      travel = Math.max(travel, Math.abs(watch.u - watch.u0) + Math.abs(watch.v - watch.v0));
    }
    if (step % 97 === 0) checkSky(sky, 0.72, "tick " + step);
  }
  assert(sky.length >= k.HOLE_MIN, "never starves: " + sky.length);
  assert(maxR / minR > 1.08, "radius breathes: " + minR.toFixed(1) + ".." + maxR.toFixed(1));
  assert(travel > 0.01, "position drifts: " + travel.toFixed(4));
  assert(lived.size > 3, "the sky turns over: " + lived.size + " holes in half an hour");
  assert(!sky.includes(watch), "the one it opened with is long gone");
  assert([...counts].every((c) => c === 1), "one horizon at a time: " + [...counts].join());
  assert(seen === k.HOLE_MAX, "never past the slot: " + seen);
}
ok("tickHoles");

{
  // the placement rule still holds if the ceiling is ever raised again
  const packed = [];
  for (let i = 0; i < 12; i++) {
    const born = k.makeHole(packed);
    if (born) packed.push(born);
  }
  assert(packed.length <= 8, "placement gives up instead of overlapping: " + packed.length);
  checkSky(packed, 1.0, "packed");
}
ok("makeHole-declines");

{
  // one slot, so the variety is in the succession: each hole has to differ from
  // the one it replaced, in size and in disk temperature
  let sizeJump = 0;
  let tempJump = 0;
  let prev = k.makeHole([]);
  for (let i = 0; i < 40; i++) {
    const next = k.makeHole([]);
    sizeJump += Math.max(next.r0, prev.r0) / Math.min(next.r0, prev.r0);
    tempJump += Math.abs(next.temp - prev.temp);
    prev = next;
  }
  assert(sizeJump / 40 > 1.5, "the next hole is a different size: " + (sizeJump / 40).toFixed(2) + "x");
  assert(tempJump / 40 > 0.25, "and a different colour: " + (tempJump / 40).toFixed(2));
  assert(k.pickBand(k.SIZE_BANDS, [80], () => 0.5) < 50, "picks a band away from the last one");
}
ok("succession");

{
  const auto = k.setScheme("");
  assert(auto.scheme === "auto", "auto follows the app");
  const light = k.setScheme("light");
  assert(light.scheme === "light" && light.light === true, "light override");
  const dark = k.setScheme("dark");
  assert(dark.scheme === "dark" && dark.light === false, "dark override");
  k.setScheme("");
}
ok("setScheme");

{
  assert(k.isListAvatar(null) === false, "null");
  assert(k.isListAvatar({}) === false, "plain object");
  assert(typeof k.officialHeroMark === "function", "hero picker");
  assert(typeof k.onSky === "function", "sky host");
  const src = require("fs").readFileSync(require("path").join(__dirname, "space-kernel.js"), "utf8");
  assert(src.includes("gd-grok-hero"), "kernel paints the grok bot in the hole");
  assert(src.includes("isListAvatar"), "ignores sidebar avatars");
}
ok("hero-mark");

console.log(`\n${n}/8 space-hole checks passed`);
