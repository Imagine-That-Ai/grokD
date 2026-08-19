// Fullscreen WebGL1 field for the grok"D" cover.
//
// Black holes are back-traced null geodesics, not stacked smoothstep rings.
// Each pixel inside a hole's neighbourhood launches an orthographic ray at
// impact parameter b and integrates the Schwarzschild photon equation
//   d2r/dl2 = -3/2 h^2 r / |r|^5      (M = 1, horizon r = 2, b_crit = 3*sqrt(3))
// so the capture shadow, the photon ring, the lensed second image of the disk
// and the deflected star field all fall out of the same integration. The disk
// carries ISCO truncation, Keplerian shear, gravitational redshift and
// relativistic Doppler beaming.
//
// Auroras are short local curtains: a folded sheet seen edge-on, vertical
// field-aligned rays, crisp lower border, and altitude colour (N2 purple foot,
// 557.7 green body, 630.0 red top).
"use strict";

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uSteps;

// xy = centre px, z = shadow radius px (b_crit), w = spin sense
uniform vec4 uH0;
uniform vec4 uH1;
// x = disk inclination, y = position angle
uniform vec2 uO0;
uniform vec2 uO1;

uniform vec4 uA0;
uniform vec4 uA1;
uniform vec4 uA2;
uniform vec2 uAL0;
uniform vec2 uAL1;
uniform vec2 uAL2;
uniform float uAN;

const float BCRIT = 5.19615242;   // 3*sqrt(3) M
const float RH    = 2.0;          // horizon
const float RISCO = 6.0;
const float ROUT  = 11.5;
const float ZFAR  = 26.0;         // star plane behind the hole, sets Einstein radius
const float RMARCH = 20.0;        // march out to here in M, weak field beyond
const int   MAXSTEP = 160;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.07 + 13.1;
    a *= 0.55;
  }
  return v;
}

// ---------------------------------------------------------------- star field

vec3 starField(vec2 p) {
  vec3 sum = vec3(0.0);
  vec2 gp = p * 0.026;
  for (int i = 0; i < 3; i++) {
    vec2 cell = floor(gp);
    vec2 f = fract(gp) - 0.5;
    float n = hash(cell + float(i) * 17.3);
    vec2 offs = vec2(hash(cell + 3.1), hash(cell + 9.7)) - 0.5;
    float d = length(f - offs * 0.62);
    float mag = pow(n, 9.5);
    float tw = 0.82 + 0.18 * sin(uTime * (0.6 + n * 2.2) + n * 31.0);
    // faint colour index so the field is not uniformly white
    vec3 tint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.87, 0.70), hash(cell + 5.7));
    sum += tint * mag * tw * smoothstep(0.030, 0.0, d);
    gp *= 1.93;
  }
  return sum;
}

// Thin-lens deflection for pixels outside the marched neighbourhood, matched to
// the marched geometry so the two meet without a seam.
vec2 weakLens(vec2 p, vec4 H) {
  float mpx = H.z / BCRIT;
  vec2 d = p - H.xy;
  float bpx = length(d);
  float b = bpx / mpx;
  if (b < 0.001 || b > RMARCH * 4.0) return p;
  float sky = b - 4.0 * ZFAR / b;
  return H.xy + d / bpx * (sky * mpx);
}

vec3 background(vec2 p) {
  vec2 q = weakLens(p, uH0);
  q = weakLens(q, uH1);
  vec3 col = vec3(0.021, 0.021, 0.034);
  col += starField(q);
  return col;
}

// ------------------------------------------------------------------ the disk

vec3 diskEmit(vec3 x, vec3 vel, vec3 n, vec3 e1, vec3 e2, float rd, float spin) {
  vec3 rhat = x / rd;
  vec3 vdir = normalize(cross(n, rhat)) * (spin >= 0.0 ? 1.0 : -1.0);

  // circular orbit speed, capped so gamma stays finite near ISCO
  float beta = min(1.0 / sqrt(max(rd - RH, 0.75)), 0.74);
  float gamma = 1.0 / sqrt(1.0 - beta * beta);

  // back-traced ray: direction to the observer is against travel
  vec3 toObs = normalize(-vel);
  float dopp = 1.0 / (gamma * (1.0 - beta * dot(vdir, toObs)));
  float grav = sqrt(max(1.0 - RH / rd, 0.02));
  float g = dopp * grav;

  // Keplerian shear: inner annuli wind faster
  float phi = atan(dot(x, e2), dot(x, e1));
  float omega = uTime * 2.6 * pow(max(rd, 1.0), -1.5);
  float sw = fbm(vec2(rd * 0.62, (phi - omega) * 1.7));
  float sw2 = fbm(vec2(rd * 2.3 + 11.0, (phi - omega) * 3.8));
  float spiral = 0.5 + 0.5 * sin(phi * 2.0 - log(max(rd, 1.2)) * 5.5 - omega);
  float texture = 0.30 + 1.05 * sw * sw + 0.42 * sw2 + 0.30 * spiral;

  float edgeIn = smoothstep(RISCO, RISCO + 0.9, rd);
  float edgeOut = smoothstep(ROUT, ROUT - 3.2, rd);
  float emis = pow(RISCO / rd, 3.0) * edgeIn * edgeOut * texture;

  // beaming: specific intensity picks up g^3, emitted spectrum adds the rest
  float boost = pow(clamp(g, 0.04, 3.2), 4.0);

  // gold through the body, white only where beaming actually wins
  vec3 col = vec3(0.30, 0.028, 0.006);
  col = mix(col, vec3(1.0, 0.34, 0.05), smoothstep(0.34, 0.72, g));
  col = mix(col, vec3(1.0, 0.68, 0.22), smoothstep(0.72, 1.08, g));
  col = mix(col, vec3(1.0, 0.93, 0.74), smoothstep(1.02, 1.38, g));
  col = mix(col, vec3(0.86, 0.94, 1.0), smoothstep(1.75, 2.5, g));

  return col * emis * boost * 2.6;
}

// ------------------------------------------------------------------ the hole

vec3 renderHole(vec2 frag, vec4 H, vec2 O, float t) {
  float mpx = H.z / BCRIT;
  vec2 q = (frag - H.xy) / mpx;

  float inc = O.x;
  float pa = O.y;
  float si = sin(inc);
  vec3 n = vec3(-si * sin(pa), si * cos(pa), cos(inc));
  vec3 e1 = normalize(cross(n, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 e2 = cross(n, e1);

  vec3 pos = vec3(q, ZFAR);
  vec3 vel = vec3(0.0, 0.0, -1.0);
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);

  vec3 accum = vec3(0.0);
  float prevSide = dot(pos, n);
  float captured = 0.0;
  float escaped = 0.0;
  vec2 sky = q;

  for (int i = 0; i < MAXSTEP; i++) {
    if (float(i) >= uSteps) break;

    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < RH * 1.01) { captured = 1.0; break; }

    float dt = clamp(0.052 * r, 0.055, 1.25);
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vec3 npos = pos + vel * dt;
    vec3 nvel = vel + acc * dt;

    // disk crossings give the direct image and every lensed repeat
    float side = dot(npos, n);
    if (side * prevSide < 0.0) {
      float f = prevSide / (prevSide - side + 1e-6);
      vec3 xp = mix(pos, npos, clamp(f, 0.0, 1.0));
      float rd = length(xp);
      if (rd > RISCO && rd < ROUT) {
        accum += diskEmit(xp, nvel, n, e1, e2, rd, H.w);
      }
    }
    prevSide = side;

    // hit the star plane behind the hole
    if (npos.z <= -ZFAR) {
      float f = (pos.z + ZFAR) / max(pos.z - npos.z, 1e-5);
      sky = mix(pos.xy, npos.xy, clamp(f, 0.0, 1.0));
      escaped = 1.0;
      break;
    }
    if (r > 90.0) {
      sky = pos.xy + vel.xy * 40.0;
      escaped = 1.0;
      break;
    }

    pos = npos;
    vel = nvel;
  }

  vec3 col = vec3(0.0);
  if (captured < 0.5) {
    if (escaped < 0.5) {
      // ran out of steps while winding: that is the photon ring, keep it dark
      escaped = 0.0;
    } else {
      vec3 bg = vec3(0.021, 0.021, 0.034);
      bg += starField(H.xy + sky * mpx);
      col += bg;
    }
  }
  col += accum;

  // photon ring: the b -> b_crit limit a finite march cannot wind out. Feed it
  // the light this ray already collected so it varies round the ring instead of
  // reading as a drawn circle.
  float b = length(q);
  float ring = exp(-pow((b - BCRIT) / 0.055, 2.0));
  vec3 ringCol = accum * 2.2 + vec3(1.0, 0.86, 0.62) * 0.045;
  col += ringCol * ring * (1.0 - captured);

  return col;
}

// ---------------------------------------------------------------- the aurora

vec3 curtain(vec2 frag, vec4 A, vec2 L, float t) {
  if (A.z <= 0.002 || L.x < 4.0) return vec3(0.0);
  vec2 d = frag - A.xy;
  float v = d.y / L.x;
  if (v < -0.10 || v > 1.26) return vec3(0.0);

  float seed = A.w;
  // a gentle drape, not a comma-shaped stroke
  float sway = sin(v * 1.25 + t * 0.26 + seed) * L.y * 0.26
             + sin(v * 3.1 - t * 0.17 + seed * 2.3) * L.y * 0.09;
  float x = d.x - sway;
  if (abs(x) > L.y * 2.4) return vec3(0.0);

  // one soft sheet with two brighter folds where it turns edge-on
  float sheet = exp(-pow(x / (L.y * 1.05), 2.0));
  for (int k = 0; k < 2; k++) {
    float fk = float(k) * 2.0 - 1.0;
    float cx = fk * L.y * 0.52 + sin(t * 0.34 + fk * 1.7 + seed) * L.y * 0.30;
    sheet += 0.62 * exp(-pow((x - cx) / (L.y * 0.24), 2.0));
  }

  // field-aligned rays: fine vertical structure running across the sheet
  float phase = x * 0.62 + seed * 9.0 + fbm(vec2(x * 0.06, seed)) * 5.0;
  float rays = 0.44 + 0.56 * pow(abs(sin(phase)), 2.2);
  rays *= 0.70 + 0.30 * fbm(vec2(x * 0.17, v * 1.6 + t * 0.05));
  rays = mix(1.0, rays, smoothstep(0.0, 0.35, v));

  // gaps and thin patches along the arc, so the sheet is not a solid panel
  sheet *= 0.45 + 0.75 * fbm(vec2(x * 0.028 + t * 0.03, seed * 4.0));

  // every ray ends at its own height; the lower border is crisp but not flat
  float top = 0.62 + 0.46 * fbm(vec2(x * 0.09, seed * 3.0 + 7.0));
  float foot = 0.012 + 0.045 * fbm(vec2(x * 0.13 + 3.0, seed));
  float env = smoothstep(foot, foot + 0.05, v) * smoothstep(top * 1.55, top * 0.5, v);
  float dens = sheet * rays * env * A.z;

  vec3 col = vec3(0.46, 0.16, 0.72) * exp(-pow((v - 0.03) / 0.115, 2.0)) * 0.85;
  col += vec3(0.16, 0.78, 0.44) * exp(-pow((v - 0.33) / 0.27, 2.0));
  col += vec3(0.86, 0.18, 0.25) * smoothstep(0.46, 1.06, v) * 0.70;

  return col * dens * 0.27;
}

// ------------------------------------------------------------------ assemble

void main() {
  vec2 frag = gl_FragCoord.xy;

  float m0 = uH0.z / BCRIT * RMARCH;
  float m1 = uH1.z / BCRIT * RMARCH;
  float d0 = length(frag - uH0.xy);
  float d1 = length(frag - uH1.xy);

  vec3 col;
  if (d0 < m0) {
    col = renderHole(frag, uH0, uO0, uTime);
  } else if (d1 < m1) {
    col = renderHole(frag, uH1, uO1, uTime);
  } else {
    col = background(frag);
  }

  if (uAN > 0.5) col += curtain(frag, uA0, uAL0, uTime);
  if (uAN > 1.5) col += curtain(frag, uA1, uAL1, uTime);
  if (uAN > 2.5) col += curtain(frag, uA2, uAL2, uTime);

  col = col / (col + vec3(0.86));
  col = pow(col, vec3(0.92));
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(err);
  }
  return s;
}

function create(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const name = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    res: name("uRes"),
    time: name("uTime"),
    steps: name("uSteps"),
    h0: name("uH0"),
    h1: name("uH1"),
    o0: name("uO0"),
    o1: name("uO1"),
    a0: name("uA0"),
    a1: name("uA1"),
    a2: name("uA2"),
    al0: name("uAL0"),
    al1: name("uAL1"),
    al2: name("uAL2"),
    an: name("uAN"),
  };
  return { gl, prog, buf, loc, canvas, steps: 96 };
}

function resize(api, cssW, cssH, dpr) {
  if (!api) return;
  const w = Math.max(2, Math.floor(cssW * dpr));
  const h = Math.max(2, Math.floor(cssH * dpr));
  if (api.canvas.width !== w || api.canvas.height !== h) {
    api.canvas.width = w;
    api.canvas.height = h;
    api.canvas.style.width = cssW + "px";
    api.canvas.style.height = cssH + "px";
  }
  api.gl.viewport(0, 0, w, h);
}

// Budget guard: the march is the only expensive term, so trade steps for
// frame time and leave the composition alone.
function retune(api, ms) {
  if (!api || !(ms > 0)) return;
  if (ms > 26 && api.steps > 40) api.steps -= 4;
  else if (ms < 12 && api.steps < 120) api.steps += 2;
}

function frame(api, t, holes, auroras) {
  if (!api) return;
  const gl = api.gl;
  gl.useProgram(api.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, api.buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const w = api.canvas.width;
  const h = api.canvas.height;
  gl.uniform2f(api.loc.res, w, h);
  gl.uniform1f(api.loc.time, t);
  gl.uniform1f(api.loc.steps, api.steps);

  const h0 = holes[0] || { u: 0.14, v: 0.20, r: 62, sense: 1, inc: 1.36, pa: -0.32 };
  const h1 = holes[1] || { u: 0.85, v: 0.78, r: 38, sense: -1, inc: 1.18, pa: 0.62 };
  const scale = Math.min(w, h) / 900;
  gl.uniform4f(api.loc.h0, h0.u * w, (1 - h0.v) * h, Math.max(8, h0.r * scale), h0.sense || 1);
  gl.uniform4f(api.loc.h1, h1.u * w, (1 - h1.v) * h, Math.max(6, h1.r * scale), h1.sense || -1);
  gl.uniform2f(api.loc.o0, h0.inc + Math.sin(t * 0.017) * 0.05, h0.pa + t * 0.006);
  gl.uniform2f(api.loc.o1, h1.inc + Math.sin(t * 0.013 + 1.7) * 0.05, h1.pa - t * 0.004);

  const cssW = Math.max(1, api.canvas.clientWidth || w);
  const cssH = Math.max(1, api.canvas.clientHeight || h);
  const sx = w / cssW;
  const sy = h / cssH;
  const pack = (a) => {
    if (!a) return { p: [0, 0, 0, 0], d: [0, 0] };
    const frac = Math.max(0, Math.min(1, a.life / Math.max(0.01, a.max)));
    return {
      p: [a.x0 * sx, (1 - a.y0 / cssH) * h, Math.sin(Math.PI * frac), a.seed || 1],
      d: [(a.len || 110) * sy, (a.wid || 32) * 0.5 * sx],
    };
  };
  const a0 = pack(auroras[0]);
  const a1 = pack(auroras[1]);
  const a2 = pack(auroras[2]);
  gl.uniform4f(api.loc.a0, a0.p[0], a0.p[1], a0.p[2], a0.p[3]);
  gl.uniform4f(api.loc.a1, a1.p[0], a1.p[1], a1.p[2], a1.p[3]);
  gl.uniform4f(api.loc.a2, a2.p[0], a2.p[1], a2.p[2], a2.p[3]);
  gl.uniform2f(api.loc.al0, a0.d[0], a0.d[1]);
  gl.uniform2f(api.loc.al1, a1.d[0], a1.d[1]);
  gl.uniform2f(api.loc.al2, a2.d[0], a2.d[1]);
  gl.uniform1f(api.loc.an, auroras.length);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

module.exports = { create, resize, frame, retune };
