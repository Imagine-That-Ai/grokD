// Per-button liquid glass. Samples the kernel sky and refracts it through a
// thick rounded volume: chromatic IOR split, fresnel rims, caustics, a
// mouse-driven spec. Not backdrop-filter.
"use strict";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime;
uniform float uHover;
uniform float uPress;
uniform float uPad;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 frag = vUv * uRes;
  vec2 halfSz = uRes * 0.5;
  float rad = min(halfSz.x, halfSz.y);
  float d = sdRoundBox(frag - halfSz, halfSz - vec2(1.15), rad);
  float alpha = 1.0 - smoothstep(-0.75, 0.95, d);
  if (alpha < 0.02) discard;

  float thick = rad * (0.52 + 0.24 * uHover - 0.10 * uPress);
  float nd = clamp(-d / max(thick, 1.0), 0.0, 1.0);
  float h = sqrt(max(0.0, 1.0 - (1.0 - nd) * (1.0 - nd)));
  h *= 1.0 + 0.2 * uHover - 0.14 * uPress;

  vec3 N = normalize(vec3(
    -dFdx(h) * uRes.x * 0.42,
    -dFdy(h) * uRes.y * 0.42,
    0.38 + 0.28 * h
  ));

  vec2 sceneUV = mix(vec2(uPad), vec2(1.0 - uPad), vUv);
  vec2 bend = N.xy * h * (0.11 + 0.09 * uHover);
  vec3 scene;
  scene.r = texture2D(uScene, clamp(sceneUV + bend * 1.14, 0.0, 1.0)).r;
  scene.g = texture2D(uScene, clamp(sceneUV + bend, 0.0, 1.0)).g;
  scene.b = texture2D(uScene, clamp(sceneUV + bend * 0.86, 0.0, 1.0)).b;
  vec3 scatter = texture2D(uScene, clamp(sceneUV + N.xy * 0.028, 0.0, 1.0)).rgb;
  scene = mix(scene, scatter, 0.26 * h);

  float F = pow(1.0 - max(N.z, 0.0), 2.65);
  vec3 rim = vec3(0.93, 0.97, 1.0) * F * (0.5 + 0.4 * h);

  vec3 L = normalize(vec3(uMouse.x * 1.35 - 0.2, uMouse.y * 1.15 + 0.58, 0.82));
  vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, Hv), 0.0), 52.0 + 36.0 * uHover);
  float spec2 = pow(max(dot(N, normalize(vec3(-0.62, 0.78, 0.48))), 0.0), 20.0);
  vec3 highlight = vec3(1.0, 0.98, 0.94) * spec * (0.85 + 0.25 * uHover)
    + vec3(0.72, 0.86, 1.0) * spec2 * 0.32;

  float cau = pow(h, 2.5)
    * (0.32 + 0.68 * sin(vUv.x * 21.0 + uTime * 1.55 + h * 7.0))
    * (0.32 + 0.68 * sin(vUv.y * 16.5 - uTime * 1.12));
  vec3 caustic = vec3(0.5, 0.84, 1.0) * cau * 0.24;

  float edge = smoothstep(7.0, 0.35, -d) * smoothstep(-1.6, 1.3, -d);
  vec3 spectral = vec3(0.7, 0.18, 0.95) * edge * abs(N.x)
    + vec3(0.12, 0.78, 1.0) * edge * abs(N.y);

  vec3 col = scene * (0.7 + 0.3 * h) + rim + highlight + caustic + spectral * 0.4;
  col += vec3(0.07, 0.08, 0.09) * (1.0 - h) * 0.35;
  gl_FragColor = vec4(col, alpha);
}
`;

let raf = 0;
let running = false;
let glC = null;
let gl = null;
let prog = null;
let quad = null;
let buttons = [];
const PAD_PX = 28;

function compile(glctx, type, src) {
  const s = glctx.createShader(type);
  glctx.shaderSource(s, src);
  glctx.compileShader(s);
  if (!glctx.getShaderParameter(s, glctx.COMPILE_STATUS)) {
    const err = glctx.getShaderInfoLog(s);
    glctx.deleteShader(s);
    throw new Error(err || "shader");
  }
  return s;
}

function setupGl() {
  if (gl && prog) return true;
  glC = document.createElement("canvas");
  gl = glC.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return false;
  gl.getExtension("OES_standard_derivatives");
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    prog = null;
    return false;
  }
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW);
  return true;
}

function capture(btn) {
  const br = btn.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.ceil(br.width * dpr));
  const h = Math.max(2, Math.ceil(br.height * dpr));
  const pw = Math.max(2, Math.ceil((br.width + PAD_PX * 2) * dpr));
  const ph = Math.max(2, Math.ceil((br.height + PAD_PX * 2) * dpr));
  if (!btn._scene) btn._scene = document.createElement("canvas");
  const scene = btn._scene;
  if (scene.width !== pw || scene.height !== ph) {
    scene.width = pw;
    scene.height = ph;
  }
  const ctx = scene.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#050508";
  ctx.fillRect(0, 0, pw, ph);
  const wrap = document.getElementById("gd-kernel");
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    ["gd-kernel-gl", "gd-kernel-far", "gd-kernel-near"].forEach((id) => {
      const src = document.getElementById(id);
      if (!src || !src.width || !src.height) return;
      const scaleX = src.width / wr.width;
      const scaleY = src.height / wr.height;
      const sx = (br.left - PAD_PX - wr.left) * scaleX;
      const sy = (br.top - PAD_PX - wr.top) * scaleY;
      const sw = (br.width + PAD_PX * 2) * scaleX;
      const sh = (br.height + PAD_PX * 2) * scaleY;
      try { ctx.drawImage(src, sx, sy, sw, sh, 0, 0, pw, ph); } catch (_) {}
    });
  }
  if (!btn._view) btn._view = document.createElement("canvas");
  const view = btn._view;
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
  const glass = btn.querySelector("canvas.gd-lg-glass");
  if (glass && (glass.width !== w || glass.height !== h)) {
    glass.width = w;
    glass.height = h;
  }
  return { w, h, pw, ph, scene, glass, dpr };
}

function upload(tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
}

function drawOne(btn, now) {
  const cap = capture(btn);
  if (!cap.glass || !prog) return;
  const { w, h, scene, glass } = cap;
  if (glC.width !== w || glC.height !== h) {
    glC.width = w;
    glC.height = h;
  }
  if (!btn._tex) btn._tex = gl.createTexture();
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog);
  upload(btn._tex, scene);
  gl.uniform1i(gl.getUniformLocation(prog, "uScene"), 0);
  gl.uniform2f(gl.getUniformLocation(prog, "uRes"), w, h);
  gl.uniform2f(gl.getUniformLocation(prog, "uMouse"), btn._mx, btn._my);
  gl.uniform1f(gl.getUniformLocation(prog, "uTime"), now * 0.001);
  gl.uniform1f(gl.getUniformLocation(prog, "uHover"), btn._hover);
  gl.uniform1f(gl.getUniformLocation(prog, "uPress"), btn._press);
  gl.uniform1f(gl.getUniformLocation(prog, "uPad"), PAD_PX / (btn.getBoundingClientRect().width + PAD_PX * 2));
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const vctx = glass.getContext("2d");
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.clearRect(0, 0, glass.width, glass.height);
  vctx.drawImage(glC, 0, 0, glass.width, glass.height);
}

function tick(now) {
  if (!running) return;
  raf = requestAnimationFrame(tick);
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.isConnected) continue;
    b._hover += ((b._wantHover || 0) - b._hover) * 0.18;
    b._press += ((b._wantPress || 0) - b._press) * 0.28;
    const lift = -2.4 * b._hover + 1.2 * b._press;
    const scale = 1 + 0.045 * b._hover - 0.035 * b._press;
    b.style.transform = "translateY(" + lift.toFixed(2) + "px) scale(" + scale.toFixed(4) + ")";
    try { drawOne(b, now); } catch (_) {}
  }
}

function bind(btn) {
  btn._mx = 0;
  btn._my = 0.2;
  btn._hover = 0;
  btn._press = 0;
  btn._wantHover = 0;
  btn._wantPress = 0;
  const onMove = (e) => {
    const r = btn.getBoundingClientRect();
    btn._mx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    btn._my = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
  };
  btn.addEventListener("pointerenter", () => { btn._wantHover = 1; });
  btn.addEventListener("pointerleave", () => { btn._wantHover = 0; btn._wantPress = 0; });
  btn.addEventListener("pointermove", onMove);
  btn.addEventListener("pointerdown", () => { btn._wantPress = 1; });
  btn.addEventListener("pointerup", () => { btn._wantPress = 0; });
}

function decorate(btn) {
  if (btn.querySelector("canvas.gd-lg-glass")) return;
  const c = document.createElement("canvas");
  c.className = "gd-lg-glass";
  c.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = btn.textContent;
  btn.textContent = "";
  btn.appendChild(c);
  btn.appendChild(label);
  btn.classList.add("gd-lg-btn");
}

function start(root) {
  stop();
  if (!root || typeof document === "undefined") return false;
  const nodes = root.querySelectorAll ? root.querySelectorAll("button") : [];
  buttons = Array.prototype.slice.call(nodes);
  if (!buttons.length) return false;
  buttons.forEach(decorate);
  buttons.forEach(bind);
  if (!setupGl()) return false;
  running = true;
  raf = requestAnimationFrame(tick);
  return true;
}

function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  buttons = [];
}

module.exports = {
  start,
  stop,
  VERT,
  FRAG,
};
