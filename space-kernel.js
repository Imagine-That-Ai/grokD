// Live gravitational kernel inside the cover. No photographs.
// Kepler dust, Verlet moons, a computed galactic nucleus, pearl + blackhole moods.
"use strict";

const GM = 4.82e4;
const G_MUT = 9.4;
const SOFT2 = 81;
const DT_MAX = 0.02;

let raf = 0;
let running = false;
let wrap = null;
let far = null;
let near = null;
let layer = null;
let glCanvas = null;
let glApi = null;
let sats = [];
let dust = [];
let stars = [];
let galaxy = [];
let holes = [];
let nebulas = [];
let nebulaWait = 3;
let frameMs = 0;
let accPrev = null;
const SUN = { x: -0.62, y: -0.48 };
let t0 = 0;
let last = 0;
let mood = { id: "coral", hex: "#F45B69", glow: "rgba(244,91,105,0.62)", ring: "255,150,158" };
let reduced = false;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wrapPi(a) {
  const t = Math.PI * 2;
  a %= t;
  if (a < 0) a += t;
  return a;
}

function eccentricAnomaly(M, e) {
  let E = M;
  for (let k = 0; k < 5; k++) {
    const s = Math.sin(E);
    const c = Math.cos(E);
    E -= (E - e * s - M) / (1 - e * c || 1e-9);
  }
  return E;
}

function stateFromElements(el) {
  const { a, e, i, O, w, M } = el;
  const E = eccentricAnomaly(M, e);
  const sE = Math.sin(E);
  const cE = Math.cos(E);
  const r = a * (1 - e * cE);
  const x = a * (cE - e);
  const y = a * Math.sqrt(Math.max(0, 1 - e * e)) * sE;
  const n = Math.sqrt(GM / (a * a * a));
  const vx = -n * a * a / r * sE;
  const vy = n * a * a / r * Math.sqrt(Math.max(0, 1 - e * e)) * cE;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cO = Math.cos(O);
  const sO = Math.sin(O);
  const ci = Math.cos(i);
  const si = Math.sin(i);
  const px = cO * cw - sO * sw * ci;
  const py = sO * cw + cO * sw * ci;
  const pz = sw * si;
  const qx = -cO * sw - sO * cw * ci;
  const qy = -sO * sw + cO * cw * ci;
  const qz = cw * si;
  return {
    x: px * x + qx * y,
    y: py * x + qy * y,
    z: pz * x + qz * y,
    vx: px * vx + qx * vy,
    vy: py * vx + qy * vy,
    vz: pz * vx + qz * vy,
  };
}

function cheapKepler(d) {
  const e = d.e;
  const M = d.M;
  const r = d.a * (1 - e * Math.cos(M));
  const th = M + 2 * e * Math.sin(M);
  const ci = Math.cos(d.i);
  const si = Math.sin(d.i);
  const cO = Math.cos(d.O);
  const sO = Math.sin(d.O);
  const x = r * Math.cos(th);
  const y = r * Math.sin(th);
  return {
    x: x * cO - y * ci * sO,
    y: x * sO + y * ci * cO,
    z: y * si,
  };
}

// The deck is the hero of the cover; the orbit around the mark carries it, so
// it is drawn larger than the physics radii would give on their own.
const ORBIT_ZOOM = 1.32;

function project(x, y, z, pitch, yaw) {
  const cy = y * Math.cos(pitch) - z * Math.sin(pitch);
  const cz = y * Math.sin(pitch) + z * Math.cos(pitch);
  const cx = x * Math.cos(yaw) - cy * Math.sin(yaw);
  const cy2 = x * Math.sin(yaw) + cy * Math.cos(yaw);
  const sc = 1 + cz * 0.00095;
  return { x: cx * sc * ORBIT_ZOOM, y: cy2 * sc * ORBIT_ZOOM, z: cz, s: sc };
}

function ringBands() {
  return [
    { r0: 50, r1: 60, dens: 0.2 },
    { r0: 64, r1: 86, dens: 0.45 },
    { r0: 90, r1: 122, dens: 1 },
    { r0: 138, r1: 172, dens: 0.62 },
    { r0: 182, r1: 190, dens: 0.28 },
  ];
}

function seedStars() {
  const rand = rng(0x5a17);
  const temps = [
    "196,214,255",
    "228,230,236",
    "255,236,210",
    "255,214,176",
    "210,226,255",
  ];
  const out = [];
  for (let i = 0; i < 860; i++) {
    const mag = Math.pow(rand(), 2.15);
    out.push({
      u: rand(),
      v: rand(),
      mag,
      tw: 0.28 + rand() * 2.2,
      ph: rand() * Math.PI * 2,
      r: 0.35 + mag * 1.5,
      c: temps[(rand() * temps.length) | 0],
    });
  }
  return out;
}

function seedGalaxy() {
  const rand = rng(0x6e01);
  const out = [];
  for (let i = 0; i < 900; i++) {
    const along = rand();
    const off = (rand() - 0.5) * (0.04 + along * 0.05);
    out.push({
      u: 0.08 + along * 0.84 + (rand() - 0.5) * 0.03,
      v: 0.18 + along * 0.52 + off,
      a0: 0.04 + (1 - Math.abs(off) * 8) * 0.1 * rand(),
      c: rand() > 0.55 ? "210,200,188" : "186,198,214",
    });
  }
  return out;
}

// r is the capture-shadow radius the shader solves for (b_crit), in css px at a
// 900px reference. inc near edge-on so the far side of the disk lenses up over
// the top. Nothing here is fixed: the sky carries between HOLE_MIN and HOLE_MAX
// holes, each drifting, breathing and eventually giving its slot to a new one.
const HOLE_MIN = 2;
const HOLE_MAX = 4;              // must match MAXH in space-field-gl.js
const HOLE_BUDGET = 196;         // total shadow radius; the march cost is area
const HOLE_CLEAR = { u0: 0.28, u1: 0.72, v0: 0.30, v1: 0.70 }; // the mark's box
let holeWait = 0;

// Two incommensurate sines per axis: the pattern never lands on itself twice.
function wobble(base, w1, p1, a1, w2, p2, a2, t) {
  return base + Math.sin(t * w1 + p1) * a1 + Math.sin(t * w2 + p2) * a2;
}

function clearOfMark(u, v) {
  return u < HOLE_CLEAR.u0 || u > HOLE_CLEAR.u1 || v < HOLE_CLEAR.v0 || v > HOLE_CLEAR.v1;
}

// The shader marches a neighbourhood around each hole and keeps the first one
// a pixel falls into, so a disk that reaches inside a neighbour's march circle
// gets cut off along it. MARCH_R and DISK_R are that geometry in units of the
// shadow radius (RMARCH / BCRIT and ROUT / BCRIT in space-field-gl.js).
const MARCH_R = 3.85;
const DISK_R = 2.25;

// The cover is measured in css px; hole radii are quoted against a 900px sky,
// so placement has to compare the two in the same units.
function refSize() {
  const w = (far && far._w) || 1200;
  const h = (far && far._h) || 900;
  const scale = Math.min(w, h) / 900;
  return { w: w / scale, h: h / scale };
}

function makeHole(existing) {
  const rand = Math.random;
  const others = existing || [];
  const spent = others.reduce((sum, x) => sum + x.r, 0);
  const room = HOLE_BUDGET - spent;
  if (room < 24) return null;
  const ref = refSize();
  const r = Math.max(20, Math.min(room, 24 + rand() * 58));
  let u = -1;
  let v = -1;
  for (let tries = 0; tries < 40; tries++) {
    const tu = 0.05 + rand() * 0.90;
    const tv = 0.06 + rand() * 0.88;
    if (!clearOfMark(tu, tv)) continue;
    const clash = others.some((x) => {
      const du = (x.u - tu) * ref.w;
      const dv = (x.v - tv) * ref.h;
      const need = Math.max(x.r * MARCH_R + r * DISK_R, r * MARCH_R + x.r * DISK_R) * 1.05;
      return Math.sqrt(du * du + dv * dv) < need;
    });
    if (!clash) { u = tu; v = tv; break; }
  }
  if (u < 0) return null; // no room left in this sky, stay at the current count
  return {
    u0: u, v0: v, r0: r,
    u, v, r,
    // most disks read gold; a hot blue-white one is the exception, so skew low
    temp: Math.pow(rand(), 1.7),
    gain: 0.78 + rand() * 0.5,
    inc: 1.04 + rand() * 0.42,
    pa: rand() * Math.PI * 2,
    sense: rand() < 0.5 ? 1 : -1,
    spin: (0.003 + rand() * 0.009) * (rand() < 0.5 ? 1 : -1),
    rs: 1.5 + rand() * 1.1,
    drift: {
      w1: 0.011 + rand() * 0.026, p1: rand() * 6.28, a1: 0.018 + rand() * 0.05,
      w2: 0.007 + rand() * 0.017, p2: rand() * 6.28, a2: 0.010 + rand() * 0.030,
      w3: 0.013 + rand() * 0.023, p3: rand() * 6.28, a3: 0.014 + rand() * 0.042,
      w4: 0.006 + rand() * 0.015, p4: rand() * 6.28, a4: 0.008 + rand() * 0.024,
    },
    breathe: {
      w1: 0.022 + rand() * 0.055, p1: rand() * 6.28, a1: 0.10 + rand() * 0.20,
      w2: 0.009 + rand() * 0.031, p2: rand() * 6.28, a2: 0.05 + rand() * 0.11,
    },
    life: 0,
    grow: 5 + rand() * 6,
    max: 48 + rand() * 90,
    sink: 7 + rand() * 8,
    fade: 0,
  };
}

function seedHoles() {
  const out = [];
  const n = HOLE_MIN + Math.floor(Math.random() * (HOLE_MAX - HOLE_MIN + 1));
  for (let i = 0; i < n; i++) {
    const hole = makeHole(out);
    if (hole) out.push(hole);
  }
  // the opening frame should already be a sky, not a fade-in
  out.forEach((hole) => { hole.life = hole.grow; hole.fade = 1; });
  holeWait = 16 + Math.random() * 20;
  return out;
}

// Position and radius are recomputed from the seed each frame, so drift never
// accumulates and a paused cover resumes exactly where the clock says it is.
function tickHoles(list, dt, t) {
  for (let i = list.length - 1; i >= 0; i--) {
    const hole = list[i];
    hole.life += dt;
    if (hole.life > hole.max + hole.sink) { list.splice(i, 1); continue; }
    hole.fade = hole.life < hole.grow
      ? hole.life / hole.grow
      : (hole.life > hole.max ? Math.max(0, 1 - (hole.life - hole.max) / hole.sink) : 1);
    const d = hole.drift;
    let u = wobble(hole.u0, d.w1, d.p1, d.a1, d.w2, d.p2, d.a2, t);
    let v = wobble(hole.v0, d.w3, d.p3, d.a3, d.w4, d.p4, d.a4, t);
    if (!clearOfMark(u, v)) {
      // push back out the way it came rather than letting it cross the mark
      const du = u - 0.5;
      const dv = v - 0.5;
      const scale = Math.max(Math.abs(du) / 0.22, Math.abs(dv) / 0.20, 1e-3);
      u = 0.5 + du / scale;
      v = 0.5 + dv / scale;
    }
    hole.u = Math.max(0.02, Math.min(0.98, u));
    hole.v = Math.max(0.04, Math.min(0.96, v));
    const b = hole.breathe;
    const swell = 1 + Math.sin(t * b.w1 + b.p1) * b.a1 + Math.sin(t * b.w2 + b.p2) * b.a2;
    hole.r = Math.max(6, hole.r0 * swell);
  }
  // drift is slow but two neighbours can still close on each other; the younger
  // one gives way rather than letting a disk get sliced along a march circle
  const ref = refSize();
  for (let i = 1; i < list.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = list[j];
      const b = list[i];
      const du = (a.u - b.u) * ref.w;
      const dv = (a.v - b.v) * ref.h;
      const d = Math.sqrt(du * du + dv * dv) || 1e-3;
      const need = Math.max(a.r * MARCH_R + b.r * DISK_R, b.r * MARCH_R + a.r * DISK_R);
      if (d >= need) continue;
      const push = (need - d) / ref.w;
      b.u = Math.max(0.02, Math.min(0.98, b.u - (du / d) * push));
      b.v = Math.max(0.04, Math.min(0.96, b.v - (dv / d) * push * (ref.w / ref.h)));
      b.u0 = b.u;
      b.v0 = b.v;
    }
  }
  holeWait -= dt;
  if (holeWait <= 0) {
    holeWait = 15 + Math.random() * 26;
    if (list.length < HOLE_MAX) {
      const born = makeHole(list);
      if (born) list.push(born);
    }
  }
  for (let guard = 0; list.length < HOLE_MIN && guard < 8; guard++) {
    const born = makeHole(list);
    if (!born) break;
    list.push(born);
  }
  return list;
}

// Union of everything a cloud core must not cross: the mark and the wordmark.
function markSpan() {
  if (!wrap) return null;
  const wb = wrap.getBoundingClientRect();
  let x0 = Infinity;
  let x1 = -Infinity;
  const sel = [".sand-grok-bot-mark", "#sand-access-cover-heading", ".sand-access-cover h1"];
  for (let i = 0; i < sel.length; i++) {
    const n = document.querySelector(sel[i]);
    if (!n) continue;
    const r = n.getBoundingClientRect();
    if (!r.width) continue;
    x0 = Math.min(x0, r.left - wb.left);
    x1 = Math.max(x1, r.right - wb.left);
  }
  return x0 < x1 ? { x0: x0 - 46, x1: x1 + 46 } : null;
}

function makeNebula(w, h, t) {
  const rand = rng((t * 997 + w * 13 + nebulas.length * 71) | 0);
  // a nebula is a big soft cloud; it is sized against the sky, not the copy
  const k = Math.max(1, Math.min(1.9, Math.min(w, h) / 900));
  const r = (150 + rand() * 210) * k;
  const aspect = 0.62 + rand() * 0.9;
  const left = rand() < 0.5;
  let cx = left ? w * (0.04 + rand() * 0.26) : w * (0.70 + rand() * 0.26);

  // the copy stays readable: keep the cloud's core off the mark and wordmark
  const span = markSpan();
  if (span) {
    const half = r * 0.75;
    if (cx + half > span.x0 && cx - half < span.x1) {
      cx = left ? Math.max(w * 0.03, span.x0 - half - 30)
                : Math.min(w * 0.97, span.x1 + half + 30);
    }
  }

  // energy drives the churn and how hot the core burns; hue slides Ha crimson
  // through to a blue reflection cloud
  const energy = Math.pow(rand(), 1.3);
  return {
    cx,
    cy: h * (0.12 + rand() * 0.62),
    r,
    aspect,
    seed: rand() * 12.57,
    hue: Math.pow(rand(), 1.25),
    energy,
    life: 0,
    max: 26 + rand() * 34,
  };
}

function seedDust() {
  const rand = rng(0x51a7);
  const bands = ringBands();
  const out = [];
  const total = 2200;
  const weight = bands.reduce((s, b) => s + b.dens * (b.r1 - b.r0), 0);
  bands.forEach((b) => {
    const n = Math.round(total * (b.dens * (b.r1 - b.r0)) / weight);
    for (let i = 0; i < n; i++) {
      const a = b.r0 + (b.r1 - b.r0) * Math.pow(rand(), 0.7);
      out.push({
        a,
        e: 0.006 + rand() * 0.014,
        M: rand() * Math.PI * 2,
        O: (rand() - 0.5) * 0.05,
        i: (rand() - 0.5) * 0.028,
        n: Math.sqrt(GM / (a * a * a)),
        s: 0.55 + rand() * 1.15,
        lum: 0.35 + rand() * 0.65,
      });
    }
  });
  return out;
}

function seedSats(pack) {
  const belts = [72, 80, 100, 112, 150, 162, 184];
  const rand = rng(0xc0de);
  return pack.map((item, i) => {
    const a = belts[i % belts.length] + (rand() - 0.5) * 3;
    const el = {
      a,
      e: 0.016 + rand() * 0.03,
      i: (rand() - 0.5) * 0.085,
      O: (i / pack.length) * 0.3,
      w: rand() * Math.PI * 2,
      M: (i / pack.length) * Math.PI * 2 + rand() * 0.18,
    };
    const st = stateFromElements(el);
    return {
      item,
      m: 0.65 + rand() * 0.8,
      x: st.x, y: st.y, z: st.z,
      vx: st.vx, vy: st.vy, vz: st.vz,
      spin: rand() * Math.PI * 2,
      spinR: 0.55 + rand() * 1.5,
      el: null,
    };
  });
}

function accelSats() {
  const n = sats.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const az = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = sats[i];
    const r2 = s.x * s.x + s.y * s.y + s.z * s.z;
    const r = Math.sqrt(r2) || 1e-6;
    const inv = GM / (r2 * r);
    ax[i] = -s.x * inv;
    ay[i] = -s.y * inv;
    az[i] = -s.z * inv - s.z * 0.35;
    for (let j = i + 1; j < n; j++) {
      const o = sats[j];
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const dz = s.z - o.z;
      const d2 = dx * dx + dy * dy + dz * dz + SOFT2;
      const d = Math.sqrt(d2);
      const f = G_MUT / (d2 * d);
      ax[i] -= dx * f * o.m;
      ay[i] -= dy * f * o.m;
      az[i] -= dz * f * o.m;
      ax[j] += dx * f * s.m;
      ay[j] += dy * f * s.m;
      az[j] += dz * f * s.m;
    }
  }
  return { ax, ay, az };
}

function stepSats(dt) {
  if (!sats.length) return;
  const a0 = accPrev || accelSats();
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    s.x += s.vx * dt + 0.5 * a0.ax[i] * dt * dt;
    s.y += s.vy * dt + 0.5 * a0.ay[i] * dt * dt;
    s.z += s.vz * dt + 0.5 * a0.az[i] * dt * dt;
  }
  const a1 = accelSats();
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    s.vx += 0.5 * (a0.ax[i] + a1.ax[i]) * dt;
    s.vy += 0.5 * (a0.ay[i] + a1.ay[i]) * dt;
    s.vz += 0.5 * (a0.az[i] + a1.az[i]) * dt;
    s.spin += s.spinR * dt;
  }
  accPrev = a1;
}

function botCenter() {
  const mark = document.querySelector(".sand-grok-bot-mark");
  if (!mark || !wrap) return null;
  const mb = mark.getBoundingClientRect();
  const wb = wrap.getBoundingClientRect();
  return {
    x: mb.left + mb.width / 2 - wb.left,
    y: mb.top + mb.height / 2 - wb.top,
    mark,
  };
}

function resizeCanvases() {
  if (!wrap || !far || !near) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  [far, near].forEach((c) => {
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    const ctx = c.getContext("2d", { alpha: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c._ctx = ctx;
    c._w = w;
    c._h = h;
  });
  if (glApi) {
    try {
      require(require("os").homedir() + "/.grok/grokbot-d/space-field-gl.js").resize(glApi, w, h, dpr);
    } catch (_) {}
  }
}

function ringRgb() {
  return mood.ring || "255,170,176";
}

function lensXY(x, y, w, h, cx, cy) {
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const hx = hole.u * w;
    const hy = hole.v * h;
    const dx = x - hx;
    const dy = y - hy;
    const r2 = dx * dx + dy * dy;
    const ein = hole.r * hole.r * hole.rs;
    const f = 1 + ein / Math.max(r2, hole.r * hole.r * 0.35);
    x = hx + dx * f;
    y = hy + dy * f;
  }
  if (mood.special === "blackhole") {
    const dx = x - cx;
    const dy = y - cy;
    const r2 = dx * dx + dy * dy;
    const f = 1 + 1400 / Math.max(r2, 1600);
    x = cx + dx * f;
    y = cy + dy * f;
  }
  return { x, y };
}

// Same temperature ramp as the shader, coarse: gold disk cool, blue-white hot.
function diskRgb(temp, hot) {
  const k = Math.max(0, Math.min(1, temp == null ? 0.2 : temp));
  const r = Math.round((hot ? 255 : 255) - k * (hot ? 40 : 70));
  const g = Math.round((hot ? 210 : 110) + k * (hot ? 20 : 60));
  const b = Math.round((hot ? 140 : 40) + k * (hot ? 110 : 175));
  return r + "," + g + "," + b;
}

function drawHoles(ctx, w, h, t) {
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const rs = hole.r * (hole.fade == null ? 1 : hole.fade);
    if (rs < 2) continue;
    ctx.save();
    ctx.translate(hole.u * w, hole.v * h);
    ctx.rotate((hole.pa + t * hole.spin) * 0.12);
    const disk = ctx.createRadialGradient(-rs * 0.35, 0, rs * 0.2, 0, 0, rs * 4.4);
    disk.addColorStop(0, "rgba(" + diskRgb(hole.temp, true) + ",0.22)");
    disk.addColorStop(0.28, "rgba(" + diskRgb(hole.temp, false) + ",0.12)");
    disk.addColorStop(0.55, "rgba(40,8,6,0.05)");
    disk.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.ellipse(0, 0, rs * 4.2, rs * 1.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(" + diskRgb(hole.temp, true) + ",0.85)";
    ctx.lineWidth = Math.max(1.4, rs * 0.045);
    ctx.beginPath();
    ctx.arc(0, 0, rs * 1.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(0, 0, rs * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Fallback for the no-WebGL path: soft radial clouds, faded to nothing at
// every edge. No noise here, so it reads as haze rather than structure.
function drawNebulas(ctx, w, h, t) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < nebulas.length; i++) {
    const n = nebulas[i];
    const fade = Math.sin((n.life / n.max) * Math.PI);
    if (fade <= 0.02) continue;
    const hue = n.hue == null ? 0.3 : n.hue;
    const core = "rgba(" + Math.round(200 - hue * 140) + "," + Math.round(60 + hue * 90) + "," +
      Math.round(80 + hue * 150) + ",";
    for (let lobe = 0; lobe < 3; lobe++) {
      const ph = t * 0.05 + n.seed + lobe * 2.1;
      const rx = n.r * (0.55 + lobe * 0.22) * (1 + Math.sin(ph) * 0.08);
      const ry = rx * n.aspect;
      const ox = Math.cos(ph * 0.7) * n.r * 0.16;
      const oy = Math.sin(ph * 0.9) * n.r * 0.12;
      const g = ctx.createRadialGradient(n.cx + ox, n.cy + oy, 0, n.cx + ox, n.cy + oy, rx);
      const a = fade * (0.09 - lobe * 0.022) * (0.6 + 0.7 * (n.energy || 0.4));
      g.addColorStop(0, core + a.toFixed(3) + ")");
      g.addColorStop(0.45, "rgba(60,120,150," + (a * 0.5).toFixed(3) + ")");
      g.addColorStop(1, "rgba(20,10,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(n.cx + ox, n.cy + oy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawField(ctx, w, h, t, cx, cy) {
  ctx.fillStyle = "#06060a";
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < galaxy.length; i++) {
    const p = galaxy[i];
    ctx.fillStyle = "rgba(" + p.c + "," + p.a0.toFixed(3) + ")";
    ctx.fillRect(p.u * w, p.v * h, 1.05, 1.05);
  }

  drawHoles(ctx, w, h, t);
  drawNebulas(ctx, w, h, t);

  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph));
    const p = lensXY(s.u * w, s.v * h, w, h, cx, cy);
    ctx.fillStyle = "rgba(" + s.c + "," + (s.mag * tw).toFixed(3) + ")";
    ctx.fillRect(p.x, p.y, s.r, s.r);
  }
}

function drawRings(ctx, cx, cy, pitch, yaw) {
  const rgb = ringRgb();
  ctx.save();
  ctx.translate(cx, cy);
  ringBands().forEach((b) => {
    for (let k = 0; k < 6; k++) {
      const r = b.r0 + (b.r1 - b.r0) * (k / 5);
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * Math.PI * 2;
        const p = project(r * Math.cos(th), r * Math.sin(th), 0, pitch, yaw);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(" + rgb + "," + (0.09 + b.dens * 0.1).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  });
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2;
    const p = project(130 * Math.cos(th), 130 * Math.sin(th), 0, pitch, yaw);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawAccretion(ctx, cx, cy, pitch, yaw, t) {
  if (mood.special !== "blackhole") return;
  ctx.save();
  ctx.translate(cx, cy);
  for (let k = 0; k < 10; k++) {
    const r = 36 + k * 2.1;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const th = (i / 80) * Math.PI * 2;
      const p = project(r * Math.cos(th), r * Math.sin(th), Math.sin(th * 2 + t) * 0.6, pitch, yaw);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const hot = k < 4;
    ctx.strokeStyle = hot
      ? "rgba(255," + (120 + k * 16) + ",70," + (0.22 - k * 0.012).toFixed(3) + ")"
      : "rgba(196,60,180," + (0.12 - (k - 4) * 0.01).toFixed(3) + ")";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

function drawDust(ctx, cx, cy, pitch, yaw, front) {
  const rgb = ringRgb();
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < dust.length; i++) {
    const d = dust[i];
    const st = cheapKepler(d);
    const p = project(st.x, st.y, st.z, pitch, yaw);
    if ((p.z >= 0) !== front) continue;
    const sun = 0.28 + 0.72 * Math.max(0, (st.x * SUN.x + st.y * SUN.y) / (d.a || 1) * -1 + 0.35);
    const a = d.lum * sun * (front ? 0.95 : 0.42);
    ctx.fillStyle = "rgba(" + rgb + "," + a.toFixed(3) + ")";
    const sz = d.s * (front ? 1 : 0.75);
    ctx.fillRect(p.x, p.y, sz, sz);
  }
  ctx.restore();
}

function ensureSprites() {
  if (!layer) return;
  if (layer.childElementCount === sats.length && sats.every((s) => s.el && s.el.isConnected)) return;
  layer.innerHTML = "";
  sats.forEach((s) => {
    const el = document.createElement("div");
    el.className = "gd-sat";
    el.title = s.item.title || s.item.id || "";
    el.innerHTML = s.item.svg || "";
    layer.appendChild(el);
    s.el = el;
  });
}

function placeSats(cx, cy, pitch, yaw) {
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    if (!s.el) continue;
    const p = project(s.x, s.y, s.z, pitch, yaw);
    const front = p.z >= 0;
    const size = (22 + 8 * Math.max(0.7, p.s)) * (s.item.scale || 1);
    s.el.style.transform =
      "translate(" + (cx + p.x - size / 2).toFixed(2) + "px," +
      (cy + p.y - size / 2).toFixed(2) + "px) rotate(" +
      (s.spin * 16).toFixed(2) + "deg)";
    s.el.style.zIndex = String(front ? 8 : 1);
    s.el.style.opacity = front ? "0.97" : "0.36";
    s.el.style.width = size.toFixed(1) + "px";
    s.el.style.height = size.toFixed(1) + "px";
  }
}

function hideLava() {
  const n = document.getElementById("pure-lava-orbs-root");
  if (n) n.style.display = "none";
}

function tickDust(dt) {
  for (let i = 0; i < dust.length; i++) dust[i].M = wrapPi(dust[i].M + dust[i].n * dt);
}

function tickNebulas(dt, w, h, t) {
  for (let i = nebulas.length - 1; i >= 0; i--) {
    nebulas[i].life += dt;
    if (nebulas[i].life > nebulas[i].max) nebulas.splice(i, 1);
  }
  nebulaWait -= dt;
  if (nebulaWait <= 0 && nebulas.length < 4) {
    nebulas.push(makeNebula(w, h, t + nebulas.length));
    nebulaWait = (nebulas.length >= 3 ? 7 : 3) + Math.random() * 6;
  }
}

function pearlHex(t) {
  const a = 0.5 + 0.5 * Math.sin(t * 0.7);
  const b = 0.5 + 0.5 * Math.sin(t * 0.7 + 2.1);
  const r = Math.round(246 + a * 9);
  const g = Math.round(236 - a * 10 + b * 8);
  const bl = Math.round(228 + b * 18);
  return "rgb(" + r + "," + g + "," + bl + ")";
}

function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const cover = document.querySelector(".sand-access-cover");
  if (!cover) {
    stop();
    return;
  }
  const c = botCenter();
  if (!c || !far || !far._ctx) return;
  const dt = reduced ? 0 : Math.min(DT_MAX, last ? (now - last) / 1000 : 0.016);
  last = now;
  const t = reduced ? 9.4 : (now - t0) / 1000;
  if (!reduced) {
    stepSats(dt);
    tickDust(dt);
    tickHoles(holes, dt, t);
    tickNebulas(dt, far._w, far._h, t);
  }
  if (mood.special === "pearl" && c.mark) {
    c.mark.style.setProperty("--fg", pearlHex(t));
  }
  const pitch = 1.12 + Math.sin(t * 0.05) * 0.018;
  const yaw = -0.46 + Math.sin(t * 0.033) * 0.03;
  if (glApi) {
    try {
      const field = require(require("os").homedir() + "/.grok/grokbot-d/space-field-gl.js");
      field.frame(glApi, t, holes, nebulas);
      if (!reduced && dt > 0) {
        frameMs = frameMs ? frameMs * 0.9 + dt * 100 : dt * 1000;
        field.retune(glApi, frameMs);
      }
    } catch (_) {
      drawField(far._ctx, far._w, far._h, t, c.x, c.y);
    }
    far._ctx.clearRect(0, 0, far._w, far._h);
  } else {
    drawField(far._ctx, far._w, far._h, t, c.x, c.y);
  }
  drawRings(far._ctx, c.x, c.y, pitch, yaw);
  drawAccretion(far._ctx, c.x, c.y, pitch, yaw, t);
  drawDust(far._ctx, c.x, c.y, pitch, yaw, false);
  near._ctx.clearRect(0, 0, near._w, near._h);
  drawDust(near._ctx, c.x, c.y, pitch, yaw, true);
  placeSats(c.x, c.y, pitch, yaw);
  hideLava();
}

function ensureDom() {
  const cover = document.querySelector(".sand-access-cover");
  if (!cover) return false;
  if (getComputedStyle(cover).position === "static") cover.style.position = "relative";
  wrap = document.getElementById("gd-kernel");
  if (!wrap || wrap.parentNode !== cover) {
    if (wrap) wrap.remove();
    wrap = document.createElement("div");
    wrap.id = "gd-kernel";
    wrap.setAttribute("aria-hidden", "true");
    glCanvas = document.createElement("canvas");
    glCanvas.id = "gd-kernel-gl";
    far = document.createElement("canvas");
    far.id = "gd-kernel-far";
    near = document.createElement("canvas");
    near.id = "gd-kernel-near";
    layer = document.createElement("div");
    layer.id = "gd-sats";
    wrap.appendChild(glCanvas);
    wrap.appendChild(far);
    wrap.appendChild(near);
    wrap.appendChild(layer);
    try {
      glApi = require(require("os").homedir() + "/.grok/grokbot-d/space-field-gl.js").create(glCanvas);
    } catch (e) {
      try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[gl] " + e + "\n"); } catch (_) {}
      glApi = null;
    }
    cover.insertBefore(wrap, cover.firstChild);
  } else {
    far = document.getElementById("gd-kernel-far");
    near = document.getElementById("gd-kernel-near");
    layer = document.getElementById("gd-sats");
    glCanvas = document.getElementById("gd-kernel-gl");
    if (glCanvas && !glApi) {
      try { glApi = require(require("os").homedir() + "/.grok/grokbot-d/space-field-gl.js").create(glCanvas); }
      catch (_) { glApi = null; }
    }
  }
  resizeCanvases();
  return true;
}

function setMood(next) {
  if (!next) return;
  mood = typeof next === "string"
    ? { id: "flat", hex: next, glow: next, ring: "220,210,200" }
    : next;
}

function start(pack) {
  reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (running && document.getElementById("gd-kernel") && sats.length) {
    ensureDom();
    ensureSprites();
    return;
  }
  const leftover = document.getElementById("gd-orbit");
  if (leftover) leftover.remove();
  ["gd-kernel-far", "gd-kernel-near", "gd-sats"].forEach((id) => {
    const n = document.getElementById(id);
    if (n && n.parentNode && n.parentNode.id !== "gd-kernel") n.remove();
  });
  if (!ensureDom()) return;
  stars = seedStars();
  galaxy = seedGalaxy();
  holes = seedHoles();
  dust = seedDust();
  sats = seedSats(pack || []);
  nebulas = [];
  nebulaWait = 1.2;
  frameMs = 0;
  if (reduced && far) {
    // one composed frame: two clouds held at full brightness
    nebulas = [makeNebula(far._w, far._h, 3), makeNebula(far._w, far._h, 41)];
    nebulas.forEach((n) => { n.life = n.max * 0.5; });
  }
  accPrev = null;
  ensureSprites();
  t0 = performance.now();
  last = 0;
  running = true;
  hideLava();
  if (!window._gdKernelResize) {
    window._gdKernelResize = () => { if (running) resizeCanvases(); };
    window.addEventListener("resize", window._gdKernelResize);
  }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
  const n = document.getElementById("gd-kernel");
  if (n) n.remove();
  wrap = far = near = layer = glCanvas = glApi = null;
  sats = [];
  dust = [];
  stars = [];
  galaxy = [];
  holes = [];
  nebulas = [];
  accPrev = null;
}

function isRunning() {
  return running;
}

module.exports = {
  start, stop, isRunning, setMood,
  seedHoles, makeHole, tickHoles, clearOfMark, refSize, makeNebula, tickNebulas,
  HOLE_MIN, HOLE_MAX, MARCH_R, DISK_R,
};
