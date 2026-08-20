// Right plasma bubble when a Cursor seat is active: liquid-metal Cursor
// mark plus official Grok / xAI logos, then the Grok model list.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(os.homedir(), ".grok", "grokbot-d");
const ASSETS = path.join(ROOT, "assets");
const MENU_ID = "gd-cursor-model-menu";

function activeId() {
  try {
    const env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8"));
    if (env && env.profileId) return env.profileId;
  } catch (err) {
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] active-env read err: " + (err.message || err) + "\n"); } catch (_) {}
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "profiles.json"), "utf8")).activeId || "";
  } catch (err) {
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] profiles.json read err: " + (err.message || err) + "\n"); } catch (_) {}
    return "";
  }
}

function isCursorSeat() {
  const id = activeId();
  if (String(id).indexOf("cursor-") === 0) return true;
  try {
    const p = (JSON.parse(fs.readFileSync(path.join(ROOT, "profiles.json"), "utf8")).profiles || [])
      .find((x) => x.id === id);
    return !!(p && p.kind === "cursor");
  } catch (err) {
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] isCursorSeat err: " + (err.message || err) + "\n"); } catch (_) {}
    return false;
  }
}

function readSvg(rel, fill) {
  let raw = fs.readFileSync(path.join(ASSETS, rel), "utf8");
  if (fill) raw = raw.replace(/fill="currentColor"/g, 'fill="' + fill + '"');
  raw = raw.replace(/\swidth="1em"/g, ' width="24"').replace(/\sheight="1em"/g, ' height="24"');
  return raw;
}

function svgUrl(rel, fill) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(readSvg(rel, fill));
}

function currentModel() {
  try {
    return require(path.join(ROOT, "model-lib.js")).resolveConfig().model || "grok-4.6";
  } catch (err) {
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] currentModel resolve err: " + (err.message || err) + "\n"); } catch (_) {}
    return "grok-4.6";
  }
}

function applyModel(id) {
  let ok = true;
  try {
    require(path.join(ROOT, "model-lib.js")).setModel(id);
  } catch (err) {
    ok = false;
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] setModel err: " + (err.message || err) + "\n"); } catch (_) {}
  }
  try {
    if (window.desktop && window.desktop.agent && window.desktop.agent.setDefaultModel) {
      window.desktop.agent.setDefaultModel({ modelId: id, maxMode: true, parameters: [] });
    }
  } catch (err) {
    try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[cursor-bubble] desktop setDefaultModel err: " + (err.message || err) + "\n"); } catch (_) {}
  }
  return ok;
}

const PROVIDERS = [
  {
    id: "cursor",
    name: "Cursor",
    metal: true,
    glow: "rgba(226,232,240,0.95)",
    file: "lobe/cursor.svg",
    models: [
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "cursor/cursor-grok-4.5-high", name: "Grok 4.5 High" },
      { id: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
    ],
  },
  {
    id: "grok",
    name: "Grok",
    glow: "rgba(244,244,245,0.9)",
    file: "lobe/grok.svg",
    models: [
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.5", name: "Grok 4.5" },
      { id: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    glow: "rgba(244,244,245,0.88)",
    file: "lobe/xai.svg",
    models: [
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.5", name: "Grok 4.5" },
    ],
  },
];

function hidePacked() {
  document.querySelectorAll(".ghostly-liquid-glass-bubble").forEach((b) => {
    if (b.id === MENU_ID || b.id === "grok-seat-action-menu") return;
    b.style.display = "none";
  });
}

function closeMenu() {
  const m = document.getElementById(MENU_ID);
  if (!m) return;
  if (m._gdDismiss) {
    document.removeEventListener("click", m._gdDismiss, true);
    m._gdDismiss = null;
  }
  m.remove();
}

function position(menu, w) {
  const orb = document.querySelector(".pure-plasma-orb-2");
  const h = Math.min(420, menu.offsetHeight || 280);
  if (!orb || !orb.offsetWidth) {
    menu.style.top = "80px";
    menu.style.right = "18px";
    return;
  }
  const rect = orb.getBoundingClientRect();
  let top = rect.bottom + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(10, rect.top - h - 10);
  let left = rect.left + rect.width / 2 - w / 2;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (left < 10) left = 10;
  menu.style.top = Math.round(top) + "px";
  menu.style.left = Math.round(left) + "px";
}

function metal(host, svg, size) {
  try {
    return require(path.join(ROOT, "liquid-metal-mark.js")).mount(host, {
      svg: svg.replace(/fill="currentColor"/g, 'fill="#ffffff"'),
      size: size || 26,
      className: "gd-metal-mark",
    });
  } catch {
    const img = document.createElement("img");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/fill="currentColor"/g, 'fill="#E2E8F0"'));
    img.style.cssText = "width:" + (size || 26) + "px;height:" + (size || 26) + "px;object-fit:contain;pointer-events:none;";
    host.appendChild(img);
    return img;
  }
}

function markHtml(prov, size) {
  if (prov.metal) return "";
  return `<img src="${svgUrl(prov.file, "#F4F4F5")}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;filter:drop-shadow(0 0 8px ${prov.glow});pointer-events:none">`;
}

function render(openId) {
  hidePacked();
  closeMenu();
  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "ghostly-liquid-glass-bubble no-scrollbar";
  menu.style.cssText = "width:240px;padding:18px 12px 16px;display:flex;z-index:1000003;";

  const cur = currentModel();
  const open = openId ? PROVIDERS.find((p) => p.id === openId) : null;

  if (open) {
    menu.style.width = "260px";
    const hero = document.createElement("div");
    hero.className = "active-provider-hero-pill";
    hero.style.setProperty("--glow-color", open.glow);
    hero.innerHTML = `
      <span style="font-size:14px;color:#fff;font-weight:900">‹</span>
      <span class="gd-hero-mark" style="width:20px;height:20px;display:flex;align-items:center;justify-content:center"></span>
      <span style="font-size:11.5px;font-weight:800;color:#fff">${open.name}</span>
      <span style="font-size:9px;color:rgba(255,255,255,0.4);margin-left:auto">Back</span>
    `;
    hero.addEventListener("click", (e) => {
      e.stopPropagation();
      render(null);
    });
    menu.appendChild(hero);
    const slot = hero.querySelector(".gd-hero-mark");
    if (open.metal) metal(slot, readSvg(open.file, "#ffffff"), 20);
    else slot.innerHTML = markHtml(open, 20);

    const tray = document.createElement("div");
    tray.className = "whimsical-model-tray no-scrollbar";
    open.models.forEach((m) => {
      const on = m.id === cur;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "whimsical-model-item" + (on ? " is-active-model" : "");
      row.innerHTML = `
        <span class="gd-row-mark" style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex:0 0 16px"></span>
        <span style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
        ${on ? '<span style="font-size:10px;font-weight:900;color:#38bdf8;margin-left:auto">✓</span>' : ""}
      `;
      const mark = row.querySelector(".gd-row-mark");
      if (open.metal) metal(mark, readSvg(open.file, "#ffffff"), 16);
      else mark.innerHTML = markHtml(open, 16);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        applyModel(m.id);
        closeMenu();
        dressOrb();
      });
      tray.appendChild(row);
    });
    menu.appendChild(tray);
  } else {
    const head = document.createElement("div");
    head.style.cssText = "font-size:10px;font-weight:800;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;text-align:center;";
    head.textContent = "Cursor · Grok / xAI";
    menu.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "liquid-constellation-grid no-scrollbar";
    PROVIDERS.forEach((prov) => {
      const on = prov.models.some((m) => m.id === cur);
      const orb = document.createElement("div");
      orb.className = "liquid-glass-orb" + (on ? " is-selected" : "");
      orb.style.setProperty("--glow-color", prov.glow);
      orb.title = prov.name;
      if (prov.metal) {
        orb.style.transform = "scale(1.12)";
        metal(orb, readSvg(prov.file, "#ffffff"), 30);
      }
      else orb.innerHTML = markHtml(prov, 26);
      const pill = document.createElement("div");
      pill.className = "liquid-orb-name-pill";
      pill.textContent = prov.name;
      orb.appendChild(pill);
      orb.addEventListener("click", (e) => {
        e.stopPropagation();
        render(prov.id);
      });
      grid.appendChild(orb);
    });
    menu.appendChild(grid);
  }

  document.body.appendChild(menu);
  position(menu, open ? 260 : 240);
  requestAnimationFrame(() => position(menu, open ? 260 : 240));

  const onDoc = (e) => {
    if (!menu.isConnected) {
      document.removeEventListener("click", onDoc, true);
      return;
    }
    const t = e.target;
    if (menu.contains(t)) return;
    if (t && t.closest && t.closest(".pure-plasma-orb-2")) return;
    closeMenu();
  };
  menu._gdDismiss = onDoc;
  setTimeout(() => document.addEventListener("click", onDoc, true), 0);
}

function toggle() {
  const existing = document.getElementById(MENU_ID);
  if (existing) {
    closeMenu();
    return;
  }
  render(null);
}

function dressOrb() {
  const orb = document.querySelector(".pure-plasma-orb-2");
  if (!orb) return;
  if (!isCursorSeat()) return;
  if (orb.querySelector(".gd-metal-mark")) return;

  const center = orb.querySelector(":scope > img");
  if (center) {
    const hold = document.createElement("span");
    hold.className = "gd-metal-slot";
    hold.style.cssText = "position:relative;z-index:2;display:flex;pointer-events:none;";
    center.replaceWith(hold);
    metal(hold, readSvg("lobe/cursor.svg", "#ffffff"), 22);
  }
  const proxy = orb.querySelector(".pure-standalone-proxy-icon");
  if (proxy) {
    proxy.style.setProperty("--proxy-glow", "rgba(244,244,245,0.9)");
    proxy.innerHTML = `<img src="${svgUrl("lobe/grok.svg", "#F4F4F5")}" alt="" style="width:18px;height:18px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(244,244,245,0.85));pointer-events:none">`;
  }
  const inner = orb.querySelector(".pure-plasma-inner");
  if (inner) {
    inner.style.background = "radial-gradient(circle at 45% 45%, #e2e8f0 0%, rgba(10,10,20,0.8) 85%)";
  }
  const glow = orb.querySelector(".pure-plasma-core-glow");
  if (glow) glow.style.background = "#e2e8f0";
  orb.style.filter = "drop-shadow(0 0 14px rgba(226,232,240,0.85)) drop-shadow(0 0 26px rgba(244,244,245,0.45))";
  orb.title = "Cursor · Grok / xAI";
}

function start() {
  dressOrb();
  const right = document.querySelector(".pure-plasma-orb-2");
  if (!right || right._gdCursorBubble) return;
  right._gdCursorBubble = true;
  right.addEventListener("click", (e) => {
    if (!isCursorSeat()) {
      closeMenu();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    hidePacked();
    const seat = document.getElementById("grok-seat-action-menu");
    if (seat) seat.remove();
    toggle();
  }, true);
}

module.exports = { start, close: closeMenu, isCursorSeat, dressOrb };
