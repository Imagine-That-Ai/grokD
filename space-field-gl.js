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
// Nebulae are emission clouds, not curtains: low-frequency fbm sets the shape,
// a domain warp churns it, high-frequency noise erodes it into wisps, and a
// radial envelope takes the density to zero long before the sample bound — so
// there is no edge to see. Colour is line emission (Ha crimson, [OIII] teal)
// against a blue reflection component, with dust eating the light in lanes.
//
// Hole count is dynamic (up to MAXH), and each hole carries a disk temperature:
// the ramp runs from a cool ~gold disk to a hot blue-white one, which is the
// real spread between a fat cool disk and a hard X-ray binary.
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
uniform float uLight;   // 0 = night sky, 1 = daybreak

#define MAXH 4
#define MAXN 4

// xy = centre px, z = shadow radius px (b_crit), w = spin sense
uniform vec4 uH[MAXH];
// x = disk inclination, y = position angle, z = temperature, w = disk gain
uniform vec4 uO[MAXH];
uniform float uHN;

// xy = centre px, z = fade, w = seed
uniform vec4 uN[MAXN];
// x = radius px, y = aspect, z = hue mix, w = energy
uniform vec4 uNL[MAXN];
uniform float uNN;

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

// Night is deep space. Day is the same universe a few hours later: a low sun
// off to the left, cream near the horizon, pale blue overhead, and the stars
// burned off except for the few that survive a bright sky.
vec3 skyColour(vec2 p) {
  float y = clamp(p.y / max(uRes.y, 1.0), 0.0, 1.0);
  vec3 night = vec3(0.021, 0.021, 0.034);
  vec3 day = mix(vec3(0.985, 0.968, 0.945), vec3(0.855, 0.898, 0.955), pow(y, 0.85));
  vec2 sun = vec2(uRes.x * 0.16, uRes.y * 0.12);
  float glow = exp(-length(p - sun) / (uRes.y * 0.55));
  day += vec3(0.055, 0.032, 0.004) * glow;
  vec3 stars = starField(p);
  // by day only the brightest points survive, and they read warm
  stars *= mix(1.0, 0.10, uLight);
  stars = mix(stars, stars * vec3(1.0, 0.93, 0.82), uLight);
  return mix(night, day, uLight) + stars;
}

vec3 background(vec2 p) {
  vec2 q = p;
  for (int i = 0; i < MAXH; i++) {
    if (float(i) >= uHN) break;
    q = weakLens(q, uH[i]);
  }
  return skyColour(q);
}

// ------------------------------------------------------------------ the disk

// Temperature slides the whole ramp: a cool disk never reaches its blue-white
// stop, a hot one is past gold before beaming even helps.
vec3 diskColour(float g, float temp) {
  float x = g * (0.76 + 0.74 * temp);
  vec3 col = mix(vec3(0.34, 0.026, 0.005), vec3(0.16, 0.05, 0.20), temp);
  col = mix(col, mix(vec3(1.0, 0.30, 0.05), vec3(0.96, 0.44, 0.30), temp), smoothstep(0.34, 0.72, x));
  col = mix(col, mix(vec3(1.0, 0.64, 0.19), vec3(0.86, 0.80, 0.62), temp), smoothstep(0.72, 1.08, x));
  col = mix(col, mix(vec3(1.0, 0.91, 0.72), vec3(0.80, 0.90, 1.0), temp), smoothstep(1.02, 1.38, x));
  col = mix(col, mix(vec3(0.88, 0.94, 1.0), vec3(0.66, 0.82, 1.0), temp), smoothstep(1.75, 2.50, x));
  return col;
}

vec3 diskEmit(vec3 x, vec3 vel, vec3 n, vec3 e1, vec3 e2, float rd, float spin, float temp) {
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

  return diskColour(g, temp) * emis * boost * 2.6;
}

// ------------------------------------------------------------------ the hole

vec3 renderHole(vec2 frag, vec4 H, vec4 O, float t, out vec3 skyHit, out float skyMask) {
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
        accum += diskEmit(xp, nvel, n, e1, e2, rd, H.w, O.z) * O.w;
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

  // the horizon eats the sky; everything else lets it through at the deflected
  // position, which is what the caller needs to composite day or night
  skyHit = vec3(H.xy + sky * mpx, 0.0);
  skyMask = (captured < 0.5 && escaped > 0.5) ? 1.0 : 0.0;
  vec3 col = accum;

  // photon ring: the b -> b_crit limit a finite march cannot wind out. Feed it
  // the light this ray already collected so it varies round the ring instead of
  // reading as a drawn circle.
  float b = length(q);
  float ring = exp(-pow((b - BCRIT) / 0.055, 2.0));
  vec3 ringCol = accum * 2.2 + diskColour(1.15, O.z) * 0.05;
  col += ringCol * ring * (1.0 - captured);

  return col;
}

// ---------------------------------------------------------------- the nebula

vec4 nebula(vec2 frag, vec4 N, vec4 L, float t) {
  if (N.z <= 0.002 || L.x < 4.0) return vec4(0.0);
  vec2 d = (frag - N.xy) / vec2(L.x, max(L.x * L.y, 1.0));
  float r2 = dot(d, d);
  if (r2 > 2.9) return vec4(0.0);   // density is already nil this far out
  float r = sqrt(r2);

  float seed = N.w;
  float energy = L.w;

  // churn in place: warping the sample point beats translating the cloud
  vec2 p = d * 1.75 + vec2(seed, seed * 0.63);
  vec2 warp = vec2(
    fbm(p * 1.25 + vec2(t * 0.021, 0.0)),
    fbm(p * 1.25 + vec2(5.2, -t * 0.017))
  ) - 0.5;
  p += warp * (0.85 + 0.75 * energy);

  float base = fbm(p * 1.10 + seed);
  float detail = fbm(p * 3.60 + warp * 2.2 - t * 0.013);
  float grain = fbm(p * 8.5 + t * 0.02);

  // coverage remap, then erosion: wisps instead of a blob
  float cover = smoothstep(0.38, 0.86, base + 0.20 * detail);
  cover *= 0.60 + 0.55 * detail;
  cover -= 0.22 * smoothstep(0.45, 0.95, grain);

  // the envelope is what guarantees there is no edge anywhere
  float env = exp(-r2 * 1.55) * (0.45 + 0.55 * fbm(p * 0.55 + 11.0));
  float dens = max(0.0, cover) * env * N.z;
  if (dens <= 0.0005) return vec4(0.0);

  // dust lanes take light back out, which is what gives a nebula its structure
  float dust = smoothstep(0.52, 0.18, fbm(p * 1.9 + 3.3));
  dens *= 0.35 + 0.65 * dust;

  float core = smoothstep(0.55, 0.02, r) * cover;
  float hue = L.z;

  vec3 col = mix(vec3(0.78, 0.13, 0.24), vec3(0.20, 0.34, 0.86), hue);   // Ha -> reflection
  col = mix(col, vec3(0.10, 0.74, 0.62), smoothstep(0.25, 0.95, core));  // [OIII] core
  col += vec3(0.95, 0.52, 0.30) * pow(core, 2.4) * (0.35 + 0.5 * energy);
  col += vec3(0.35, 0.20, 0.62) * smoothstep(0.75, 1.5, r) * 0.5;        // cool halo

  // By day the same cloud is lit, not luminous: pastel, low contrast, and the
  // dust lanes read as shadow rather than as holes punched in the sky.
  vec3 lit = mix(vec3(0.98, 0.86, 0.86), vec3(0.80, 0.90, 0.97), hue);
  lit = mix(lit, vec3(0.99, 0.92, 0.83), core * 0.8);
  lit *= 0.86 + 0.18 * dust;
  vec3 out3 = mix(col * (0.85 + 0.75 * energy), lit, uLight);
  return vec4(out3 * dens, clamp(dens * 1.35, 0.0, 0.92));
}

// ------------------------------------------------------------------ assemble

void main() {
  vec2 frag = gl_FragCoord.xy;

  // Copy the hole this pixel belongs to out of the array first: the march is
  // inlined once that way, instead of once per slot.
  vec4 H = vec4(0.0);
  vec4 O = vec4(0.0);
  float inside = 0.0;
  for (int i = 0; i < MAXH; i++) {
    if (float(i) >= uHN) break;
    float march = uH[i].z / BCRIT * RMARCH;
    if (inside < 0.5 && uH[i].z > 1.0 && length(frag - uH[i].xy) < march) {
      H = uH[i];
      O = uO[i];
      inside = 1.0;
    }
  }

  vec3 sky = background(frag);
  vec3 emis = vec3(0.0);
  if (inside > 0.5) {
    vec3 hit;
    float mask;
    vec3 hole = renderHole(frag, H, O, uTime, hit, mask);
    float march = H.z / BCRIT * RMARCH;
    float edge = smoothstep(march, march * 0.88, length(frag - H.xy));
    // outside the march the weak-field sky already stands; inside, the horizon
    // decides how much sky is left and the disk adds on top
    sky = mix(sky, skyColour(hit.xy) * mask, edge);
    emis = hole * edge;
  }

  vec4 cloud = vec4(0.0);
  for (int i = 0; i < MAXN; i++) {
    if (float(i) >= uNN) break;
    vec4 n = nebula(frag, uN[i], uNL[i], uTime);
    cloud.rgb = cloud.rgb * (1.0 - n.a) + n.rgb;
    cloud.a = cloud.a * (1.0 - n.a) + n.a;
  }

  // Night: everything is emission, tonemapped together. Day: the sky is already
  // display-referred, the cloud sits over it, and only the disk is HDR.
  vec3 night = sky + cloud.rgb + emis;
  night = night / (night + vec3(0.86));
  vec3 dayBase = mix(sky, cloud.a > 0.001 ? cloud.rgb / cloud.a : sky, cloud.a);
  vec3 day = dayBase + emis / (emis + vec3(0.55));
  vec3 col = mix(night, day, uLight);
  col = pow(col, vec3(0.92));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Must match MAXH / MAXA in the shader.
const MAXH = 4;
const MAXN = 4;

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
    light: name("uLight"),
    h: name("uH[0]"),
    o: name("uO[0]"),
    hn: name("uHN"),
    n: name("uN[0]"),
    nl: name("uNL[0]"),
    nn: name("uNN"),
  };
  return {
    gl, prog, buf, loc, canvas, steps: 96,
    hv: new Float32Array(MAXH * 4),
    ov: new Float32Array(MAXH * 4),
    nv: new Float32Array(MAXN * 4),
    nlv: new Float32Array(MAXN * 4),
  };
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

function frame(api, t, holes, nebulas, light) {
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
  gl.uniform1f(api.loc.light, light ? 1 : 0);

  const scale = Math.min(w, h) / 900;
  const hn = Math.min(MAXH, holes.length);
  api.hv.fill(0);
  api.ov.fill(0);
  for (let i = 0; i < hn; i++) {
    const hole = holes[i];
    const k = i * 4;
    // fade is how far into its life the hole is: a new one grows in, a dying
    // one shrinks away, and the shader skips anything under a pixel.
    api.hv[k] = hole.u * w;
    api.hv[k + 1] = (1 - hole.v) * h;
    api.hv[k + 2] = Math.max(0, hole.r * (hole.fade == null ? 1 : hole.fade) * scale);
    api.hv[k + 3] = hole.sense || 1;
    api.ov[k] = hole.inc + Math.sin(t * (0.013 + i * 0.005) + i * 1.7) * 0.05;
    api.ov[k + 1] = hole.pa + t * (hole.spin || 0.005);
    api.ov[k + 2] = hole.temp == null ? 0.2 : hole.temp;
    api.ov[k + 3] = hole.gain == null ? 1 : hole.gain;
  }
  gl.uniform4fv(api.loc.h, api.hv);
  gl.uniform4fv(api.loc.o, api.ov);
  gl.uniform1f(api.loc.hn, hn);

  const cssW = Math.max(1, api.canvas.clientWidth || w);
  const cssH = Math.max(1, api.canvas.clientHeight || h);
  const sx = w / cssW;
  const nn = Math.min(MAXN, nebulas.length);
  api.nv.fill(0);
  api.nlv.fill(0);
  for (let i = 0; i < nn; i++) {
    const cloud = nebulas[i];
    const k = i * 4;
    const frac = Math.max(0, Math.min(1, cloud.life / Math.max(0.01, cloud.max)));
    api.nv[k] = cloud.cx * sx;
    api.nv[k + 1] = (1 - cloud.cy / cssH) * h;
    api.nv[k + 2] = Math.sin(Math.PI * frac);
    api.nv[k + 3] = cloud.seed || 1;
    api.nlv[k] = (cloud.r || 200) * sx;
    api.nlv[k + 1] = cloud.aspect == null ? 1 : cloud.aspect;
    api.nlv[k + 2] = cloud.hue == null ? 0.3 : cloud.hue;
    api.nlv[k + 3] = cloud.energy == null ? 0.5 : cloud.energy;
  }
  gl.uniform4fv(api.loc.n, api.nv);
  gl.uniform4fv(api.loc.nl, api.nlv);
  gl.uniform1f(api.loc.nn, nn);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

module.exports = { create, resize, frame, retune };
