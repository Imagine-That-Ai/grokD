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
let auroras = [];
let auroraWait = 3;
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

function project(x, y, z, pitch, yaw) {
  const cy = y * Math.cos(pitch) - z * Math.sin(pitch);
  const cz = y * Math.sin(pitch) + z * Math.cos(pitch);
  const cx = x * Math.cos(yaw) - cy * Math.sin(yaw);
  const cy2 = x * Math.sin(yaw) + cy * Math.cos(yaw);
  const sc = 1 + cz * 0.00095;
  return { x: cx * sc, y: cy2 * sc, z: cz, s: sc };
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

function seedHoles() {
  // r is the capture-shadow radius the shader solves for (b_crit), in css px
  // at a 900px reference. inc near edge-on so the far side of the disk lenses
  // up over the top. Both sit in opposite corners, clear of the grok mark.
  return [
    { u: 0.20, v: 0.22, r: 74, inc: 1.38, pa: -0.34, sense: 1,
      tilt: 1.18, yaw: -0.35, spin: 0.07, rs: 2.4 },
    { u: 0.82, v: 0.77, r: 44, inc: 1.30, pa: 0.61, sense: -1,
      tilt: 0.98, yaw: 0.55, spin: -0.05, rs: 1.7 },
  ];
}

// Union of everything the curtains must not cross: the mark and the wordmark.
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

function makeAurora(w, h, t) {
  const rand = rng((t * 997 + w * 13 + auroras.length * 71) | 0);
  // short and local, but a 70px curtain is a speck on a 2000px cover: let it
  // grow with the sky and stop well before it could read as page-length
  const k = Math.max(1, Math.min(1.7, Math.min(w, h) / 900));
  const len = (70 + rand() * 90) * k;
  const wid = (30 + rand() * 26) * k;
  const left = rand() < 0.5;
  let x0 = left ? w * (0.07 + rand() * 0.15) : w * (0.78 + rand() * 0.15);

  // push clear of the mark + wordmark rather than drawing across them
  const span = markSpan();
  if (span) {
    const half = wid * 1.4;
    if (x0 + half > span.x0 && x0 - half < span.x1) {
      x0 = left ? Math.max(w * 0.05, span.x0 - half - 24)
                : Math.min(w * 0.95, span.x1 + half + 24);
    }
  }

  // foot sits mid-sky; the curtain rises from there toward the top edge
  const y0 = h * (0.20 + rand() * 0.16) + len;
  return {
    x0, y0, len, wid,
    seed: rand() * 12.57,
    life: 0,
    max: 6.5 + rand() * 6.0,
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

function drawHoles(ctx, w, h, t) {
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const hx = hole.u * w;
    const hy = hole.v * h;
    const rs = hole.r;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate((hole.yaw + t * hole.spin) * 0.12);
    const disk = ctx.createRadialGradient(-rs * 0.35, 0, rs * 0.2, 0, 0, rs * 4.4);
    disk.addColorStop(0, "rgba(255,210,140,0.22)");
    disk.addColorStop(0.28, "rgba(255,110,40,0.12)");
    disk.addColorStop(0.55, "rgba(40,8,6,0.05)");
    disk.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.ellipse(0, 0, rs * 4.2, rs * 1.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,226,170,0.85)";
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

// Fallback curtain for the no-WebGL path: same short sheet, same altitude
// colours, drawn as a few vertical field-aligned rays.
function drawAuroras(ctx, w, h, t) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < auroras.length; i++) {
    const a = auroras[i];
    const fade = Math.sin((a.life / a.max) * Math.PI);
    if (fade <= 0.02) continue;
    const rays = 9;
    for (let r = 0; r < rays; r++) {
      const u = r / (rays - 1) - 0.5;
      const x = a.x0 + u * a.wid * 1.6
        + Math.sin(t * 0.4 + a.seed + u * 3.1) * a.wid * 0.22;
      const top = a.y0 - a.len;
      const g = ctx.createLinearGradient(0, a.y0, 0, top);
      const k = fade * (0.30 - 0.16 * Math.abs(u * 2));
      g.addColorStop(0.00, "rgba(117,41,184," + (k * 0.8).toFixed(3) + ")");
      g.addColorStop(0.30, "rgba(26,235,117," + k.toFixed(3) + ")");
      g.addColorStop(0.72, "rgba(219,46,64," + (k * 0.5).toFixed(3) + ")");
      g.addColorStop(1.00, "rgba(219,46,64,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = a.wid * 0.16;
      ctx.beginPath();
      ctx.moveTo(x, a.y0);
      ctx.lineTo(x + Math.sin(t * 0.3 + a.seed) * a.wid * 0.3, top);
      ctx.stroke();
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
  drawAuroras(ctx, w, h, t);

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

function ensureSprites(pack) {
  if (!layer) return;
  if (layer.childElementCount === pack.length) return;
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
    const size = (16 + 6 * Math.max(0.7, p.s)) * (s.item.scale || 1);
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

function tickAuroras(dt, w, h, t) {
  for (let i = auroras.length - 1; i >= 0; i--) {
    auroras[i].life += dt;
    if (auroras[i].life > auroras[i].max) auroras.splice(i, 1);
  }
  auroraWait -= dt;
  if (auroraWait <= 0 && auroras.length < 3) {
    auroras.push(makeAurora(w, h, t + auroras.length));
    auroraWait = (auroras.length >= 2 ? 9 : 4) + Math.random() * 8;
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
    tickAuroras(dt, far._w, far._h, t);
  }
  if (mood.special === "pearl" && c.mark) {
    c.mark.style.setProperty("--fg", pearlHex(t));
  }
  const pitch = 1.12 + Math.sin(t * 0.05) * 0.018;
  const yaw = -0.46 + Math.sin(t * 0.033) * 0.03;
  if (glApi) {
    try {
      const field = require(require("os").homedir() + "/.grok/grokbot-d/space-field-gl.js");
      field.frame(glApi, t, holes, auroras);
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
  auroras = [];
  auroraWait = 1.2;
  frameMs = 0;
  if (reduced && far) {
    // one composed frame: two curtains held at full brightness
    auroras = [makeAurora(far._w, far._h, 3), makeAurora(far._w, far._h, 41)];
    auroras.forEach((a) => { a.life = a.max * 0.5; });
  }
  accPrev = null;
  ensureSprites(pack || []);
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
  auroras = [];
  accPrev = null;
}

function isRunning() {
  return running;
}

module.exports = { start, stop, isRunning, setMood };
