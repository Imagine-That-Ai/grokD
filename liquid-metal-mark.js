// Chrome pour over a logo silhouette. Port of the studio liquid-metal
// profile (lmProfile + rim-weighted dispersion), CPU, small canvases.
"use strict";

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function fract(x) { return x - Math.floor(x); }
function smoothstep(e0, e1, x) {
  const d = e1 - e0;
  if (d === 0) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / d, 0, 1);
  return t * t * (3 - 2 * t);
}

function profile(s, blur) {
  let ch = 0.04;
  ch += 0.92 * smoothstep(0.0, 0.1 + blur, s);
  ch -= 0.8 * smoothstep(0.12, 0.18 + blur, s);
  ch += 0.66 * smoothstep(0.22, 0.55 + blur, s);
  ch -= 0.72 * smoothstep(0.64 - 0.3 * blur, 0.98, s);
  return clamp(ch, 0.02, 1);
}

function hash(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

const P = {
  repetition: 2,
  softness: 0.1,
  shiftRed: 0.3,
  shiftBlue: 0.3,
  distortion: 0.07,
  contour: 0.4,
  angle: 1.2217,
  scale: 0.62,
};

function buildFields(src, N) {
  const off = document.createElement("canvas");
  off.width = off.height = N;
  const o = off.getContext("2d");
  o.clearRect(0, 0, N, N);
  const pad = N * 0.1;
  o.drawImage(src, pad, pad, N - 2 * pad, N - 2 * pad);
  const data = o.getImageData(0, 0, N, N).data;
  const alpha = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) alpha[i] = data[i * 4 + 3] / 255;

  let buf = Float32Array.from(alpha);
  const tmp = new Float32Array(N * N);
  for (let pass = 0; pass < 4; pass++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let s = 0;
        let c = 0;
        for (let k = -2; k <= 2; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= N) continue;
          s += buf[y * N + xx];
          c++;
        }
        tmp[y * N + x] = s / c;
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let s = 0;
        let c = 0;
        for (let k = -2; k <= 2; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= N) continue;
          s += tmp[yy * N + x];
          c++;
        }
        buf[y * N + x] = s / c;
      }
    }
  }
  const edgeF = new Float32Array(N * N);
  for (let j = 0; j < N * N; j++) edgeF[j] = clamp(1 - buf[j], 0, 1);
  return { N, alpha, edgeF };
}

function paint(ctx, fields, t) {
  const { N, alpha, edgeF } = fields;
  const img = ctx._gdImg || (ctx._gdImg = ctx.createImageData(N, N));
  const d = img.data;
  const dirX = Math.cos(P.angle);
  const dirY = Math.sin(P.angle);
  const ct = smoothstep(0.1, 1.0, P.contour);
  const blur = 0.02 + 0.45 * P.softness;
  const z = 0.55 * P.scale;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const a = alpha[i];
      const o = i * 4;
      if (a <= 0.004) {
        d[o + 3] = 0;
        continue;
      }
      const qx = (x / N - 0.5) / z;
      const qy = (y / N - 0.5) / z;
      const e = edgeF[i];
      const n = vnoise(qx * 1.3, qy * 1.3 + 0.2 * t);
      const ef = clamp(e + (1 - e) * P.distortion * (0.5 + 0.5 * n), 0, 1);
      let dir = dirX * qx + dirY * qy;
      dir *= 1 - ef * ct;
      dir -= 1.7 * ef * ct;
      dir *= 0.9 * P.repetition;
      dir -= 0.1 * t;
      const dw = 0.25 + 0.75 * ef;
      const r = profile(fract(dir + P.shiftRed * 0.05 * dw), blur);
      const g = profile(fract(dir), blur);
      const b = profile(fract(dir - P.shiftBlue * 0.05 * dw), blur);
      const under = profile(fract(dir * 0.47 - 0.06 * t + 0.31), blur + 0.18);
      const m = 1.05 + 0.32 * under;
      const lift = 0.58;
      d[o] = 255 * clamp(lift + r * m * 0.62, 0, 1);
      d[o + 1] = 255 * clamp(lift + g * m * 0.58, 0, 1);
      d[o + 2] = 255 * clamp(lift + b * m * 0.54, 0, 1);
      d[o + 3] = 255 * a;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function svgToImage(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function mount(host, opts) {
  const size = opts.size || 26;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const N = Math.max(48, Math.round(size * dpr));
  const canvas = document.createElement("canvas");
  canvas.className = opts.className || "gd-metal-mark";
  canvas.width = N;
  canvas.height = N;
  canvas.style.cssText = "width:" + size + "px;height:" + size + "px;display:block;pointer-events:none;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.55)) drop-shadow(0 0 7px rgba(226,232,240,0.7));";
  if (opts.title) canvas.title = opts.title;
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let raf = 0;
  svgToImage(opts.svg).then((img) => {
    const fields = buildFields(img, N);
    const tick = (now) => {
      if (!canvas.isConnected) return;
      paint(ctx, fields, now / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }).catch(() => {});
  canvas._gdStop = () => cancelAnimationFrame(raf);
  return canvas;
}

module.exports = { mount, svgToImage };
