// Soap-bubble rim for the plasma selectors, the gateway tiles, and the glass
// panels they open. Borders are painted from a scaled, blurred copy of the
// element's own contents, so whatever is inside (seat colour, persona eyes,
// provider logos, gateway glows) bleeds onto the edge nearest it.
//
// Every colour on a rim is sampled from the content beside it. The prism
// filters split those samples into offset fringes the way a thin film does,
// instead of laying an invented rainbow over the top. Everything stays on the
// perimeter; the middle of a bubble is dark, and that is what makes the edge
// read as an edge.
"use strict";

const ORB_SELECTOR = ".pure-plasma-orb-1, .pure-plasma-orb-2";
const TILE_SELECTOR = ".liquid-glass-orb";
const HULL_SELECTOR = ".ghostly-liquid-glass-bubble, #grok-seat-action-menu";
// Packed proxy/model pickers already morph via ghostlyBubbleMorph. Do not
// card-morph the seat menu — it now uses that same bubble chrome.
const MORPH_SELECTOR = ".gd-force-hull-morph";
const SCROLL_CLASS = "gd-hull-scroll";
const STYLE_ID = "gd-bubble-rim-css";
const DEFS_ID = "gd-bubble-rim-defs";
const WARP_ID = "gd-bubble-rim-warp";
const PRISM_ID = "gd-bubble-rim-prism";
const PRISM_WIDE_ID = "gd-bubble-rim-prism-wide";
const MARK = "data-gd-rim";

// Cloned into rim layers, these only add noise.
const CLONE_STRIP = "[" + MARK + "], .liquid-orb-name-pill";

const CSS = `
@keyframes gdRimSlosh {
  0%, 100% { transform: scale(2.08) translate(0, 0); }
  27%      { transform: scale(2.24) translate(-1.6px, 1.1px); }
  53%      { transform: scale(2.02) translate(1.3px, 1.7px); }
  78%      { transform: scale(2.19) translate(1.5px, -1.4px); }
}
@keyframes gdRimSloshWide {
  0%, 100% { transform: scale(3.05) translate(0, 0); }
  33%      { transform: scale(3.35) translate(2.2px, -1.8px); }
  66%      { transform: scale(2.9) translate(-2px, 2.2px); }
}
@keyframes gdRimSpecDrift {
  0%, 100% { transform: rotate(-7deg) scale(1); opacity: 0.9; }
  50%      { transform: rotate(9deg) scale(1.04); opacity: 1; }
}

.gd-rim {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 4;
}
.gd-rim > * {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

/* The reflection itself: the orb's own content, swollen past its edge and
   clipped to a band, so interior colour lands on the rim it sits nearest. */
.gd-rim-refract {
  overflow: hidden;
  mix-blend-mode: screen;
  -webkit-mask-image: radial-gradient(closest-side, transparent 76%, #000 90%, #000 97%, transparent 100%);
  mask-image: radial-gradient(closest-side, transparent 76%, #000 90%, #000 97%, transparent 100%);
  filter: url(#${WARP_ID}) url(#${PRISM_ID}) saturate(2.4) brightness(1.28) blur(1px);
  opacity: 0.92;
}
.gd-rim-refract.is-wide {
  -webkit-mask-image: radial-gradient(closest-side, transparent 44%, #000 76%, #000 92%, transparent 100%);
  mask-image: radial-gradient(closest-side, transparent 44%, #000 76%, #000 92%, transparent 100%);
  filter: saturate(2.1) brightness(1.1) blur(4px);
  opacity: 0.46;
}
.gd-rim-src {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transform: scale(2.08);
  transform-origin: 50% 50%;
  filter: blur(2.6px);
  will-change: transform;
  animation: gdRimSlosh 6.4s ease-in-out infinite;
}
.gd-rim-refract.is-wide .gd-rim-src {
  filter: blur(5.5px);
  animation: gdRimSloshWide 9.3s ease-in-out infinite;
}

/* Thin wet edge holding the whole film together. */
.gd-rim-edge {
  box-shadow:
    inset 0 0 0 0.8px rgba(255, 255, 255, 0.3),
    inset 0 1.4px 2.4px rgba(255, 255, 255, 0.34),
    inset 0 -1.8px 3px rgba(255, 255, 255, 0.14);
}

/* Specular crescents: bright above, a soft answer below. */
.gd-rim-spec {
  background:
    radial-gradient(40% 22% at 34% 6%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 70%),
    radial-gradient(28% 16% at 70% 94%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 72%);
  -webkit-mask-image: radial-gradient(closest-side, transparent 70%, #000 88%, #000 100%);
  mask-image: radial-gradient(closest-side, transparent 70%, #000 88%, #000 100%);
  mix-blend-mode: plus-lighter;
  filter: blur(0.7px);
  animation: gdRimSpecDrift 8.7s ease-in-out infinite;
}

/* Break the two orbs out of lockstep. */
.pure-plasma-orb-2 .gd-rim-src { animation-delay: -2.6s; }
.pure-plasma-orb-2 .gd-rim-spec { animation-delay: -3.4s; }

/* Gateway tiles: same glass, quieter — ten of them share one small panel,
   and the turbulence filter is not worth paying for at this size. */
.gd-rim.is-tile .gd-rim-refract {
  filter: url(#${PRISM_ID}) saturate(2.4) brightness(1.08) blur(0.7px);
  opacity: 0.78;
}
.gd-rim.is-tile .gd-rim-refract.is-wide {
  filter: saturate(1.9) brightness(0.95) blur(3.4px);
  opacity: 0.32;
}
.gd-rim.is-tile .gd-rim-edge {
  box-shadow:
    inset 0 0 0 0.7px rgba(255, 255, 255, 0.26),
    inset 0 1.2px 2px rgba(255, 255, 255, 0.3),
    inset 0 -1.4px 2.6px rgba(255, 255, 255, 0.1);
}
.gd-rim.is-tile .gd-rim-spec {
  background:
    radial-gradient(42% 20% at 36% 5%, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 72%),
    radial-gradient(26% 14% at 68% 95%, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0) 74%);
}
.liquid-glass-orb:nth-child(3n+2) .gd-rim-src { animation-delay: -2.2s; }
.liquid-glass-orb:nth-child(3n) .gd-rim-src { animation-delay: -4.4s; }

/* ------------------------------------------------------------------ */
/* Hull: the same idea at panel scale, held tight against the edge.      */
/* ------------------------------------------------------------------ */

@keyframes gdHullSwell {
  0%, 100% { transform: scale(1.055) translate(0, 0); }
  34%      { transform: scale(1.085) translate(-3px, 2px); }
  67%      { transform: scale(1.04) translate(3px, -2px); }
}
@keyframes gdHullSwellTight {
  0%, 100% { transform: scale(1.14) translate(0, 0); }
  40%      { transform: scale(1.19) translate(2.5px, -2px); }
  75%      { transform: scale(1.11) translate(-2.5px, 2.5px); }
}

.gd-hull {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
}
.gd-hull > * {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}
.gd-hull-bleed, .gd-hull-line { overflow: hidden; mix-blend-mode: screen; }

.gd-hull-bleed {
  -webkit-mask-image:
    linear-gradient(to bottom, #000 0, transparent 32px),
    linear-gradient(to top, #000 0, transparent 32px),
    linear-gradient(to right, #000 0, transparent 30px),
    linear-gradient(to left, #000 0, transparent 30px);
  mask-image:
    linear-gradient(to bottom, #000 0, transparent 32px),
    linear-gradient(to top, #000 0, transparent 32px),
    linear-gradient(to right, #000 0, transparent 30px),
    linear-gradient(to left, #000 0, transparent 30px);
  filter: blur(13px) saturate(2.2) brightness(0.98);
  opacity: 0.34;
}
.gd-hull-line {
  -webkit-mask-image:
    linear-gradient(to bottom, #000 0, transparent 9px),
    linear-gradient(to top, #000 0, transparent 9px),
    linear-gradient(to right, #000 0, transparent 9px),
    linear-gradient(to left, #000 0, transparent 9px);
  mask-image:
    linear-gradient(to bottom, #000 0, transparent 9px),
    linear-gradient(to top, #000 0, transparent 9px),
    linear-gradient(to right, #000 0, transparent 9px),
    linear-gradient(to left, #000 0, transparent 9px);
  filter: blur(3px) url(#${PRISM_WIDE_ID}) saturate(2.8) brightness(1.14);
  opacity: 0.72;
}
.gd-hull-src {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transform-origin: 50% 50%;
  will-change: transform;
}
.gd-hull-bleed .gd-hull-src { animation: gdHullSwell 13s ease-in-out infinite; }
.gd-hull-line .gd-hull-src { animation: gdHullSwellTight 17s ease-in-out infinite; }

.gd-hull-spec {
  background:
    radial-gradient(58% 9% at 44% 0%, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0) 76%),
    radial-gradient(38% 6% at 62% 100%, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0) 78%);
  mix-blend-mode: plus-lighter;
  filter: blur(1.6px);
}

.gd-hull-edge {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    inset 0 1.6px 2.4px rgba(255, 255, 255, 0.14),
    inset 0 -1.6px 3px rgba(255, 255, 255, 0.05);
}

/* A panel that carries this rim should read as a bubble, not a card: a slow
   organic drift in the corner radii, and its own scroller so the rim stays
   pinned to the shell while the content moves inside it. */
@keyframes gdHullMorph {
  0%, 100% { border-radius: 22% 18% 20% 24% / 11% 13% 10% 12%; }
  34%      { border-radius: 17% 24% 25% 18% / 13% 10% 13% 10%; }
  67%      { border-radius: 25% 20% 17% 21% / 10% 13% 12% 13%; }
}
.gd-bubbleized {
  box-sizing: border-box !important;
  padding: 26px 20px 22px !important;
  max-height: min(76vh, 620px) !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
}
.gd-hull-scroll {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior: contain;
}
.gd-hull-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }

/* On a light panel, screen blows the whole shell to white. A soap film over
   white reads as a darker, saturated edge, so the same content-derived colour
   is composited with multiply and the speculars become sheen instead of glare. */
@media (prefers-color-scheme: light) {
  .gd-rim-refract, .gd-hull-bleed, .gd-hull-line { mix-blend-mode: multiply; }
  .gd-rim-refract {
    filter: url(#${WARP_ID}) url(#${PRISM_ID}) saturate(2.2) brightness(0.84) blur(1px);
    opacity: 0.62;
  }
  .gd-rim-refract.is-wide {
    filter: saturate(1.7) brightness(0.94) blur(4px);
    opacity: 0.24;
  }
  .gd-rim.is-tile .gd-rim-refract {
    filter: url(#${PRISM_ID}) saturate(2.1) brightness(0.88) blur(0.7px);
    opacity: 0.55;
  }
  .gd-rim.is-tile .gd-rim-refract.is-wide {
    filter: saturate(1.6) brightness(0.96) blur(3.4px);
    opacity: 0.2;
  }
  .gd-rim-edge {
    box-shadow:
      inset 0 0 0 0.8px rgba(0, 0, 0, 0.15),
      inset 0 1.4px 2.4px rgba(255, 255, 255, 0.85),
      inset 0 -1.8px 3px rgba(0, 0, 0, 0.07);
  }
  .gd-hull-bleed {
    filter: blur(13px) saturate(1.8) brightness(0.96);
    opacity: 0.2;
  }
  .gd-hull-line {
    filter: blur(3px) url(#${PRISM_WIDE_ID}) saturate(2.1) brightness(0.9);
    opacity: 0.44;
  }
  .gd-hull-edge {
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.11),
      inset 0 1.6px 2.4px rgba(255, 255, 255, 0.9),
      inset 0 -1.6px 3px rgba(0, 0, 0, 0.05);
  }
  .gd-rim-spec, .gd-hull-spec { mix-blend-mode: soft-light; opacity: 0.7; }
}

@media (prefers-reduced-motion: reduce) {
  .gd-rim-src, .gd-rim-spec, .gd-hull-src { animation: none; }
  .gd-bubbleized { animation: none !important; }
}
`;

// A thin film shifts the hue of light already passing through it. These do the
// same: split what the rim sampled into offset R/G/B fringes, so every
// iridescent edge is still made of the colour sitting next to it.
function prismFilter(id, shift) {
  return `
<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
  <feOffset in="SourceGraphic" dx="${shift}" dy="${-shift}" result="rs" />
  <feOffset in="SourceGraphic" dx="${-shift}" dy="${shift}" result="bs" />
  <feColorMatrix in="rs" type="matrix" result="r"
    values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
  <feColorMatrix in="SourceGraphic" type="matrix" result="g"
    values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
  <feColorMatrix in="bs" type="matrix" result="b"
    values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
  <feBlend in="r" in2="g" mode="screen" result="rg" />
  <feBlend in="rg" in2="b" mode="screen" />
</filter>`;
}

const DEFS_SVG = `
<filter id="${WARP_ID}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.034 0.046" numOctaves="2" seed="7" result="warp">
    <animate attributeName="baseFrequency" dur="13s" repeatCount="indefinite"
             values="0.034 0.046;0.052 0.029;0.030 0.051;0.034 0.046" />
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
</filter>
${prismFilter(PRISM_ID, 0.9)}
${prismFilter(PRISM_WIDE_ID, 2.2)}
`;

const HULL_FALLBACK_SHADOW =
  "0 32px 85px rgba(0,0,0,0.88)," +
  "inset 0 -8px 24px rgba(0,0,0,0.5)," +
  "inset 0 0 20px rgba(255,255,255,0.03)";

// Whatever the panel already casts stays underneath our colour blooms.
function baseShadow(panel) {
  if (panel._gdBaseShadow === undefined) {
    const own = getComputedStyle(panel).boxShadow;
    panel._gdBaseShadow = !own || own === "none" ? HULL_FALLBACK_SHADOW : own;
  }
  return panel._gdBaseShadow;
}

// A lit child is one carrying a real accent: an explicit --glow-color, or a
// background saturated enough to read as colour rather than another grey.
function accentOf(node) {
  const cs = getComputedStyle(node);
  const glow = cs.getPropertyValue("--glow-color").trim();
  if (glow) return glow;
  const bg = cs.backgroundColor;
  const m = /rgba?\(([^)]+)\)/.exec(bg || "");
  if (!m) return null;
  const parts = m[1].split(",").map((v) => parseFloat(v));
  const a = parts.length > 3 ? parts[3] : 1;
  if (!(a > 0.35)) return null;
  const hi = Math.max(parts[0], parts[1], parts[2]);
  const lo = Math.min(parts[0], parts[1], parts[2]);
  if (hi < 60 || (hi - lo) / hi < 0.28) return null;
  return "rgba(" + parts[0] + "," + parts[1] + "," + parts[2] + ",0.85)";
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

function ensureDefs() {
  if (document.getElementById(DEFS_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = DEFS_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:fixed;width:0;height:0;pointer-events:none;opacity:0;";
  svg.innerHTML = DEFS_SVG;
  (document.body || document.documentElement).appendChild(svg);
}

function contentOf(host) {
  return Array.from(host.children).filter((n) => !n.hasAttribute(MARK));
}

// Duplicate ids would break every getElementById the app runs, and a nested
// rim inside a clone would stack its glow on top of ours.
function sanitize(node) {
  if (node.removeAttribute) node.removeAttribute("id");
  if (node.querySelectorAll) {
    node.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    node.querySelectorAll(CLONE_STRIP).forEach((n) => n.remove());
  }
  return node;
}

function buildSource(host, cls) {
  const src = document.createElement("div");
  src.className = cls;
  contentOf(host).forEach((n) => src.appendChild(sanitize(n.cloneNode(true))));
  return src;
}

function layer(cls) {
  const n = document.createElement("div");
  n.className = cls;
  return n;
}

function buildRim(orb, isTile) {
  const rim = layer(isTile ? "gd-rim is-tile" : "gd-rim");
  rim.setAttribute(MARK, "1");

  const wide = layer("gd-rim-refract is-wide");
  wide.appendChild(buildSource(orb, "gd-rim-src"));
  const tight = layer("gd-rim-refract");
  tight.appendChild(buildSource(orb, "gd-rim-src"));

  rim.append(wide, tight, layer("gd-rim-edge"), layer("gd-rim-spec"));
  return rim;
}

function buildHull(panel) {
  const hull = layer("gd-hull");
  hull.setAttribute(MARK, "1");

  const bleed = layer("gd-hull-bleed");
  bleed.appendChild(buildSource(panel, "gd-hull-src"));
  const line = layer("gd-hull-line");
  line.appendChild(buildSource(panel, "gd-hull-src"));

  hull.append(bleed, line, layer("gd-hull-edge"), layer("gd-hull-spec"));
  return hull;
}

// Carry the interior accents just past the glass: one tight bloom per lit
// child, thrown outward in the direction that child sits.
function imageAccent(img) {
  if (img._gdAccent !== undefined) return img._gdAccent;
  img._gdAccent = null;
  if (!img.naturalWidth || !img.complete) return null;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    const hi = Math.max(d[0], d[1], d[2]);
    const lo = Math.min(d[0], d[1], d[2]);
    if (d[3] < 90 || hi < 55 || (hi - lo) / hi < 0.16) return null;
    // lift it toward its own hue so a muted avatar still casts colour
    const k = 235 / Math.max(hi, 1);
    img._gdAccent = "rgba(" + Math.round(d[0] * k) + "," + Math.round(d[1] * k) +
      "," + Math.round(d[2] * k) + ",0.7)";
  } catch (_) {
    img._gdAccent = null;
  }
  return img._gdAccent;
}

function litShadow(panel) {
  const box = panel.getBoundingClientRect();
  if (!box.width || !box.height) return null;

  const blooms = [];
  const imgs = Array.from(panel.querySelectorAll("img"));
  const rest = Array.from(panel.querySelectorAll("*")).slice(0, 260);
  const nodes = imgs.concat(rest);
  nodes.forEach((tile) => {
    if (tile.closest("[" + MARK + "]")) return;
    const color = tile.tagName === "IMG" ? imageAccent(tile) : accentOf(tile);
    if (!color) return;
    const r = tile.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return;
    const dx = (r.left + r.width / 2 - (box.left + box.width / 2)) / (box.width / 2);
    const dy = (r.top + r.height / 2 - (box.top + box.height / 2)) / (box.height / 2);
    blooms.push({ color, dx, dy, reach: Math.hypot(dx, dy) });
  });
  if (!blooms.length) return null;

  blooms.sort((a, b) => b.reach - a.reach);
  const cast = blooms.slice(0, 5).map((b) => {
    const x = Math.round(b.dx * 15);
    const y = Math.round(b.dy * 15);
    return `${x}px ${y}px 30px -20px ${b.color}`;
  });
  return `${baseShadow(panel)},${cast.join(",")},0 0 28px -12px rgba(255,255,255,0.05)`;
}

function skinRim(el, isTile) {
  const sig = contentOf(el).map((n) => n.outerHTML).join("");
  const existing = el.querySelector(":scope > [" + MARK + "]");
  if (existing && el._gdSig === sig) return;
  if (existing) existing.remove();
  el._gdSig = sig;
  el.appendChild(buildRim(el, isTile));
}

// Give the shell its drift, then move everything it holds into one scroller so
// the rim stays with the shell instead of sliding away with the content.
function bubbleize(panel) {
  if (!panel._gdBubble) {
    panel._gdBubble = true;
    panel.classList.add("gd-bubbleized");
    const own = panel.style.animation || "";
    if (own.indexOf("gdHullMorph") < 0) {
      panel.style.animation = (own ? own + ", " : "") + "gdHullMorph 15s ease-in-out infinite";
    }
  }
  let box = panel.querySelector(":scope > ." + SCROLL_CLASS);
  const strays = Array.from(panel.children)
    .filter((n) => !n.hasAttribute(MARK) && !n.classList.contains(SCROLL_CLASS));
  if (!box) {
    if (!strays.length) return;
    box = document.createElement("div");
    box.className = SCROLL_CLASS;
    panel.appendChild(box);
  }
  strays.forEach((n) => box.appendChild(n));
}

function skinHull(panel) {
  if (!panel.offsetWidth || !panel.offsetHeight) return;
  if (panel.matches(MORPH_SELECTOR)) {
    try { bubbleize(panel); } catch (_) {}
  }

  const kids = contentOf(panel);
  const sig = [
    panel.offsetWidth + "x" + panel.offsetHeight,
    kids.map((k) => k.className + ":" + k.children.length).join(","),
    Array.from(panel.querySelectorAll("[data-prx-id]"))
      .map((n) => n.getAttribute("data-prx-id") + (n.classList.contains("is-selected") ? "*" : ""))
      .join(","),
  ].join("|");

  const existing = panel.querySelector(":scope > [" + MARK + "]");
  if (!existing || panel._gdSig !== sig) {
    if (existing) existing.remove();
    panel._gdSig = sig;
    baseShadow(panel);
    // guarantee a stacking context so the hull can sit under the content
    if (getComputedStyle(panel).isolation !== "isolate") panel.style.isolation = "isolate";
    panel.insertBefore(buildHull(panel), panel.firstChild);
    panel._gdShadow = null;
  }

  if (!panel._gdShadow) {
    const shadow = litShadow(panel);
    if (shadow) panel._gdShadow = shadow;
  }
  if (panel._gdShadow && panel.style.boxShadow !== panel._gdShadow) {
    panel.style.boxShadow = panel._gdShadow;
  }
}

// Clones living inside a rim layer are decoration; skinning them again would
// nest rims and double the glow.
function isDecor(el) {
  return !!el.closest("[" + MARK + "]");
}

function attachAll() {
  if (!document.body) return;
  ensureStyles();
  ensureDefs();
  document.querySelectorAll(ORB_SELECTOR).forEach((el) => {
    if (isDecor(el)) return;
    try { skinRim(el, false); } catch (_) {}
  });
  document.querySelectorAll(TILE_SELECTOR).forEach((el) => {
    if (isDecor(el)) return;
    try { skinRim(el, true); } catch (_) {}
  });
  document.querySelectorAll(HULL_SELECTOR).forEach((panel) => {
    if (isDecor(panel)) return;
    try { skinHull(panel); } catch (_) {}
  });
}

let observer = null;

function start() {
  attachAll();
  if (observer || !document.body) return;
  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; attachAll(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Reloading this module on a live renderer must not leave the previous
// observer running against the old code.
function stop() {
  if (observer) { observer.disconnect(); observer = null; }
  document.querySelectorAll("[" + MARK + "]").forEach((n) => n.remove());
  [STYLE_ID, DEFS_ID].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.remove();
  });
  document.querySelectorAll(HULL_SELECTOR).forEach((p) => {
    p.style.boxShadow = "";
    p._gdShadow = null;
  });
  document.querySelectorAll(ORB_SELECTOR + "," + TILE_SELECTOR + "," + HULL_SELECTOR)
    .forEach((n) => { n._gdSig = null; });
}

module.exports = { start, stop, attachAll, ORB_SELECTOR, TILE_SELECTOR, HULL_SELECTOR };
