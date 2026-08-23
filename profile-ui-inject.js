// Injected into Grok D. Disk-loaded so UI can improve without repacking asar.
(function () {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const http = require("http");
  const { spawn, execFileSync } = require("child_process");
  const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  const STORE = path.join(ROOT, "profiles.json");
  const SWITCH = path.join(ROOT, "switch-profile.js");
  const ENV = path.join(ROOT, "active-env.json");
  const RUNTIME = path.join(ROOT, "runtime");
  const READY = path.join(RUNTIME, "ready.json");
  const COMMAND = path.join(RUNTIME, "command.json");
  const RESULT = path.join(RUNTIME, "result.json");
  const ACTIVE_AGENT = path.join(ROOT, "hack", "box-data", "agents", "active-agent.json");
  // Disk-loaded overlay: the guard may not be installed yet, so every use is optional.
  function secGuardMod() {
    try { return require(path.join(ROOT, "security-guard.js")); } catch { return null; }
  }
  const AUTH = "Bearer " + ((secGuardMod() || {}).getGatewayToken?.() || "");
  let models;
  try { models = require(path.join(ROOT, "model-lib.js")); } catch { models = null; }

  function load() {
    try { return JSON.parse(fs.readFileSync(STORE, "utf8")); }
    catch { return { activeId: "local-d", profiles: [] }; }
  }

  function mode() {
    try { return JSON.parse(fs.readFileSync(ENV, "utf8")).mode || "local"; }
    catch { return "local"; }
  }

  function wrapPageAuth() {
    if (mode() !== "local") return Promise.resolve("skip");
    try {
      const auth = require(path.join(ROOT, "profile-auth-preload.js"));
      const { webFrame } = require("electron");
      const src = auth.pageWorldLocalScript();
      return webFrame.executeJavaScript(src, true);
    } catch (e) {
      return Promise.resolve("err " + (e && e.message || e));
    }
  }
  wrapPageAuth().catch(() => {});
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => wrapPageAuth().catch(() => {}));
    window.addEventListener("load", () => wrapPageAuth().catch(() => {}));
  }
  const authLoop = setInterval(() => {
    wrapPageAuth().catch(() => {});
  }, 350);
  setTimeout(() => clearInterval(authLoop), 15000);

  function activeId() {
    try {
      const env = JSON.parse(fs.readFileSync(ENV, "utf8"));
      if (env && env.profileId) return env.profileId;
    } catch {}
    try { return load().activeId || "cursor"; } catch { return "cursor"; }
  }

  function isLocalSeat(id) {
    const sid = String(id || activeId() || "");
    if (mode() === "local") return true;
    return sid === "local-d" || sid.indexOf("local-") === 0;
  }

  // In the renderer, process.execPath is the Electron binary. Handed a script
  // path it launches a second app instance and ignores the script entirely, so
  // every profile command silently did nothing. ELECTRON_RUN_AS_NODE makes the
  // same binary behave as plain node.
  function nodeEnv() {
    return Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" });
  }

  function switchTo(id, opts) {
    const args = [SWITCH, "switch", id];
    if (opts && opts.takeover) args.push("--takeover");
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: nodeEnv(),
    });
    child.unref();
  }

  function captureChatHandoff() {
    const excerpts = [];
    const seen = new Set();
    const nodes = document.querySelectorAll("p, li, [class*='message'], [class*='bubble']");
    for (const n of nodes) {
      if (n.querySelector && n.querySelector("p, li, [class*='message']")) continue;
      const t = String(n.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length < 12 || t.length > 600) continue;
      if (seen.has(t)) continue;
      if (/^(Search|Today |Message from|Grok Bot can|Allow Grok)/i.test(t)) continue;
      seen.add(t);
      excerpts.push(t);
      if (excerpts.length >= 16) break;
    }
    const id = activeId();
    const prof = (load().profiles || []).find((p) => p.id === id);
    const payload = {
      from: id,
      fromName: prof ? prof.name : id,
      model: currentModelId(),
      lastUser: "",
      excerpts: excerpts.slice(-12),
      at: Date.now(),
    };
    try { payload.lastUser = composerText(); } catch {}
    try {
      require(path.join(ROOT, "takeover-local.js")).writePayload(payload);
    } catch (e) {
      try { fs.writeFileSync(path.join(ROOT, "runtime", "takeover.json"), JSON.stringify(payload) + "\n"); } catch {}
    }
    return payload;
  }

  // A silent catch here is why a broken Stop looked like a working one for so
  // long: the button reported "bot-pause missing" no matter what actually threw.
  let pauseModErr = null;
  function pauseMod() {
    const p = path.join(ROOT, "bot-pause.js");
    try { delete require.cache[require.resolve(p)]; } catch {}
    try {
      const m = require(p);
      pauseModErr = null;
      return m;
    } catch (e) {
      pauseModErr = e;
      try {
        fs.appendFileSync("/tmp/grokbot-renderer.log",
          "[bot-pause] require failed: " + (e && e.stack ? e.stack : e) + "\n");
      } catch (_) {}
      return null;
    }
  }

  function botsPaused(id) {
    const m = pauseMod();
    return !!(m && m.isPaused && m.isPaused(id));
  }

  async function setBotsPaused(want, seatId) {
    const m = pauseMod();
    if (!m) throw new Error("bot-pause failed to load: " + (pauseModErr && pauseModErr.message ? pauseModErr.message : "unknown"));
    const seats = seatId ? [seatId] : undefined;
    return want ? m.pause({ seats, waitRemote: false }) : m.resume({ seats });
  }

  function foMod() {
    try { return require(path.join(ROOT, "failover.js")); }
    catch { return null; }
  }

  function fallOverCfg() {
    const m = foMod();
    return m ? m.loadConfig() : {
      enabled: false, nextCursor: false, localChief: false, localClone: false,
    };
  }

  function foUi() {
    const p = path.join(ROOT, "fallover-ui.js");
    try { delete require.cache[require.resolve(p)]; } catch {}
    try { return require(p); } catch { return null; }
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escAttr(s) {
    return escHtml(s).replace(/\n/g, "&#10;");
  }

  // Fails closed to the mascot/letter avatar when security-guard is unreachable.
  function sanitizeImageUrl(u) {
    const g = secGuardMod();
    return g && g.sanitizeImageUrl ? g.sanitizeImageUrl(u) : null;
  }

  // Small, durable UI choices. localStorage would do, but it lives in the seat's
  // own Electron profile — a preference about the orb has to survive a seat hop.
  const UI_PREFS = path.join(RUNTIME, "ui-prefs.json");

  function uiPrefs() {
    try { return JSON.parse(fs.readFileSync(UI_PREFS, "utf8")) || {}; }
    catch { return {}; }
  }

  function setUiPref(key, value) {
    const next = Object.assign(uiPrefs(), { [key]: value });
    try {
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(UI_PREFS, JSON.stringify(next, null, 2) + "\n");
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[ui-prefs] " + e + "\n"); } catch (_) {}
    }
    return next;
  }

  function orbAvatarOn() {
    return !!uiPrefs().orbAvatar;
  }

  // "classic" is the selector with our plasma layer paused: no soap rim, no
  // slosh, no glow — the orbs sit still. Plasma is the default.
  function orbStyle() {
    return uiPrefs().orbStyle === "classic" ? "classic" : "plasma";
  }

  function chipCollapsed() {
    return !!uiPrefs().chipCollapsed;
  }

  function switchBtn(on, extra, attrs) {
    return `<button type="button" class="gd-sw${on ? " is-on" : ""}${extra ? " " + extra : ""}" ${attrs || ""} aria-pressed="${on ? "true" : "false"}"><i></i></button>`;
  }

  function fallOverBlock() {
    const c = fallOverCfg();
    const ui = foUi();
    const rows = ui
      ? ui.rowHtml(c, (on) => switchBtn(!!on, "", ""))
      : "";
    return `
      <div class="gd-idcard gd-focard" style="margin-bottom:10px">
        <div class="gd-idrow">
          <span class="gd-idk">Auto Failover</span>
          <span class="gd-idpill ${c.enabled ? "is-on" : "is-off"}"><i></i>${c.enabled ? "On" : "Off"}</span>
        </div>
        ${rows}
      </div>`;
  }

  function addProfile(opts) {
    const args = [SWITCH, "add", "--name", opts.name, "--kind", opts.kind];
    if (opts.from) args.push("--from", opts.from);
    if (opts.identity) args.push("--identity", opts.identity);
    if (opts.bots) args.push("--bots", String(opts.bots));
    execFileSync(process.execPath, args, { timeout: 30000, env: nodeEnv() });
  }

  // The grok mark is a monochrome SVG shipped as an <img> data URL, so no
  // stylesheet can touch its fill. Rewrite the fill to a candy-red gradient and
  // hand the element back its own src. Each <img> is its own document, so the
  // gradient id cannot collide with the page.
  const GROK_CANDY_DEFS =
    '<defs><radialGradient id="gdCandy" cx="34%" cy="26%" r="88%">' +
    '<stop offset="0" stop-color="#ff8a90"/>' +
    '<stop offset="0.26" stop-color="#ff2436"/>' +
    '<stop offset="0.62" stop-color="#cf0e21"/>' +
    '<stop offset="1" stop-color="#7d0413"/></radialGradient></defs>';

  function candyGrokMarks() {
    const imgs = document.querySelectorAll('img[src^="data:image/svg"]:not([data-gd-grok])');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      let raw;
      try {
        raw = decodeURIComponent(String(img.getAttribute("src")).split(",").slice(1).join(","));
      } catch (_) {
        img.setAttribute("data-gd-grok", "skip");
        continue;
      }
      if (raw.indexOf("<title>Grok</title>") < 0) {
        img.setAttribute("data-gd-grok", "skip");
        continue;
      }
      let out = raw.replace(/fill="(?!none)[^"]*"/g, 'fill="url(#gdCandy)"');
      if (out.indexOf('fill="url(#gdCandy)"') < 0) {
        out = out.replace(/<svg/, '<svg fill="url(#gdCandy)"');
      }
      out = out.replace(/<svg([^>]*)>/, "<svg$1>" + GROK_CANDY_DEFS);
      img.setAttribute("data-gd-grok", "1");
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(out);
      const host = img.closest && img.closest(".pure-standalone-proxy-icon");
      if (host) host.classList.add("gd-grok-host");
    }
  }

  function el(tag, style, text) {
    const n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (text != null) n.textContent = text;
    return n;
  }

  function profileDisplayName(id) {
    if (!id) return "Account";
    try {
      const storeData = readStore();
      const p = (storeData && storeData.profiles || []).find((x) => x.id === id);
      if (p && p.name) return p.name;
    } catch (_) {}
    if (id === "local-d") return "Local D";
    const m = /^cursor-([a-z0-9])$/i.exec(id);
    if (m) return "Seat " + m[1].toUpperCase();
    return String(id);
  }

  function logRendererError(ctx, err) {
    try {
      const line = `[renderer:${ctx}] ${new Date().toISOString()} ${err && err.stack || err && err.message || err}\n`;
      fs.appendFileSync("/tmp/grokbot-renderer.log", line);
    } catch (_) {}
  }

  function toast(msg) {
    let n = document.getElementById("grok-d-toast");
    if (!n) {
      n = el("div", `
        position:fixed;bottom:22px;right:22px;z-index:1000002;pointer-events:none;
        padding:8px 14px;border-radius:14px;background:rgba(14,14,22,0.94);
        border:1px solid rgba(255,255,255,0.16);color:#fff;
        font:700 11px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
        opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;
      `);
      n.id = "grok-d-toast";
      document.body.appendChild(n);
    }
    window.__gdToast = toast;
    n.textContent = msg;
    n.style.opacity = "1";
    n.style.transform = "translateY(0)";
    clearTimeout(n._t);
    n._t = setTimeout(() => { n.style.opacity = "0"; n.style.transform = "translateY(8px)"; }, 2200);
  }

  const ICONS = {
    github: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`,
    google: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.36 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.94 0 12s.46 3.84 1.26 5.42l4.02-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>`,
    auth0: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.98 7.348L19.44 0H4.56L2.02 7.348a11.96 11.96 0 004.37 13.064L12 24l5.61-3.588a11.96 11.96 0 004.37-13.064zM12 18.064l-3.588-2.292a7.65 7.65 0 01-2.796-8.352L6.87 4.14h10.26l1.254 3.28a7.65 7.65 0 01-2.796 8.352L12 18.064z"/></svg>`,
    local: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
    play: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="8,5 20,12 8,19"/></svg>`,
    reset: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    browser: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
    dismiss: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    swap: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    palette: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2"/><circle cx="17.5" cy="10.5" r="2"/><circle cx="8.5" cy="7.5" r="2"/><circle cx="6.5" cy="12.5" r="2"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.4-1.02-.23-.27-.37-.62-.37-.98 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.97-4.5-9-10-9z"/></svg>`,
  };

  function ensureStyles() {
    if (document.getElementById("grok-d-injected-styles")) return;
    const s = document.createElement("style");
    s.id = "grok-d-injected-styles";
    s.textContent = `
      :root {
        --gd-bg: rgba(18, 18, 24, 0.88);
        --gd-card-bg: rgba(22, 22, 30, 0.82);
        --gd-border: rgba(255, 255, 255, 0.12);
        --gd-border-subtle: rgba(255, 255, 255, 0.07);
        --gd-text: #f4f4f6;
        --gd-text-muted: rgba(255, 255, 255, 0.58);
        --gd-text-dim: rgba(255, 255, 255, 0.38);
        --gd-pill-bar: rgba(0, 0, 0, 0.38);
        --gd-pill-active: rgba(255, 255, 255, 0.16);
        --gd-pill-active-text: #ffffff;
        --gd-btn-primary-bg: #ffffff;
        --gd-btn-primary-text: #000000;
        --gd-btn-sec-bg: rgba(255, 255, 255, 0.07);
        --gd-btn-sec-hover: rgba(255, 255, 255, 0.12);
        --gd-shadow: 0 32px 80px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05);
        --gd-backdrop: rgba(0, 0, 0, 0.72);
        --gd-red-bg: rgba(239, 68, 68, 0.12);
        --gd-red-border: rgba(239, 68, 68, 0.28);
        --gd-red-text: #fca5a5;
        --gd-green: #10b981;
        --gd-green-text: #34d399;
        --gd-amber: #f59e0b;
        --gd-amber-text: #fbbf24;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --gd-bg: rgba(255, 255, 255, 0.94);
          --gd-card-bg: rgba(250, 250, 252, 0.88);
          --gd-border: rgba(0, 0, 0, 0.12);
          --gd-border-subtle: rgba(0, 0, 0, 0.06);
          --gd-text: #09090b;
          --gd-text-muted: rgba(0, 0, 0, 0.62);
          --gd-text-dim: rgba(0, 0, 0, 0.42);
          --gd-pill-bar: rgba(0, 0, 0, 0.05);
          --gd-pill-active: rgba(0, 0, 0, 0.09);
          --gd-pill-active-text: #09090b;
          --gd-btn-primary-bg: #09090b;
          --gd-btn-primary-text: #ffffff;
          --gd-btn-sec-bg: rgba(0, 0, 0, 0.05);
          --gd-btn-sec-hover: rgba(0, 0, 0, 0.09);
          --gd-shadow: 0 32px 80px -12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05);
          --gd-backdrop: rgba(245, 245, 248, 0.65);
          --gd-red-bg: rgba(239, 68, 68, 0.08);
          --gd-red-border: rgba(239, 68, 68, 0.24);
          --gd-red-text: #dc2626;
          --gd-green: #059669;
          --gd-green-text: #059669;
          --gd-amber: #d97706;
          --gd-amber-text: #d97706;
        }
      }
      @keyframes gdScaleIn {
        from { opacity: 0; transform: scale(0.96) translateY(6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes gdPulseRing {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.35); opacity: 0.6; }
      }
      @keyframes gdDWiggle {
        0%, 100% { transform: rotate(-7deg) translate(0, 0); }
        12% { transform: rotate(9deg) translate(0.6px, -0.4px); }
        28% { transform: rotate(-11deg) translate(-0.7px, 0.5px); }
        41% { transform: rotate(4deg) translate(0.3px, 0.2px); }
        55% { transform: rotate(-8deg) translate(-0.2px, -0.3px); }
        70% { transform: rotate(10deg) translate(0.5px, 0.4px); }
        84% { transform: rotate(-5deg) translate(-0.4px, 0); }
      }
      .gd-wordmark { display:inline; letter-spacing:-0.03em; font: inherit; }
      .gd-wordmark .gd-qd { font: inherit; font-weight: inherit; letter-spacing: -0.06em; }
      .sand-grok-bot-mark { flex-shrink: 0; }
      .sand-grok-bot-mark,
      .sand-onboarding__landing,
      .sand-access-cover {
        overflow: visible !important;
      }
      .sand-access-cover,
      .sand-onboarding__landing,
      .sand-access-cover > *:not(#gd-kernel):not(#gd-scheme-toggle),
      .sand-onboarding__landing > *:not(#gd-kernel):not(#gd-scheme-toggle) {
        background: transparent !important;
        background-image: none !important;
      }
      #gd-kernel {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 0;
        pointer-events: none;
        background: transparent;
        overflow: hidden;
      }
      html, body { background: #050508; }
      body:has(.sand-access-cover) #sand-app,
      body:has(.sand-onboarding__landing) #sand-app {
        background: transparent !important;
      }
      #gd-kernel { z-index: 1 !important; }
      .sand-access-cover,
      .sand-onboarding__landing {
        background: transparent !important;
        box-shadow: none !important;
        border: none !important;
        outline: none !important;
      }
      /* Daybreak: the same sky a few hours later. The canvas paints itself, so
         these are only the surfaces behind and above it. */
      @media (prefers-color-scheme: light) {
        #sand-access-cover-heading,
        .sand-access-cover h1 { text-shadow: 0 1px 16px rgba(255,255,255,0.85); }
        #gd-sats .gd-sat { filter: drop-shadow(0 2px 4px rgba(24,26,38,0.30)); }
        /* the copy is white for the night sky; on paper it has to be ink */
        .sand-access-cover h1,
        .sand-access-cover h2,
        .sand-access-cover p,
        .sand-access-cover span,
        #sand-access-cover-heading { color: #16171d !important; }
        .sand-access-cover p { color: rgba(22,23,29,0.72) !important; }
      }
      .sand-access-cover[data-gd-scheme="light"] #sand-access-cover-heading,
      .sand-access-cover[data-gd-scheme="light"] h1 { text-shadow: 0 1px 16px rgba(255,255,255,0.85); }
      .sand-access-cover[data-gd-scheme="light"] #gd-sats .gd-sat {
        filter: drop-shadow(0 2px 4px rgba(24,26,38,0.30));
      }
      .sand-access-cover[data-gd-scheme="light"] h1,
      .sand-access-cover[data-gd-scheme="light"] h2,
      .sand-access-cover[data-gd-scheme="light"] span,
      .sand-access-cover[data-gd-scheme="light"] #sand-access-cover-heading { color: #16171d !important; }
      .sand-access-cover[data-gd-scheme="light"] p { color: rgba(22,23,29,0.72) !important; }
      .sand-access-cover[data-gd-scheme="dark"] #sand-access-cover-heading,
      .sand-access-cover[data-gd-scheme="dark"] h1 { text-shadow: 0 1px 18px rgba(0,0,0,0.7); }
      .sand-access-cover[data-gd-scheme="dark"] h1,
      .sand-access-cover[data-gd-scheme="dark"] h2,
      .sand-access-cover[data-gd-scheme="dark"] span,
      .sand-access-cover[data-gd-scheme="dark"] #sand-access-cover-heading { color: #f4f1ea !important; }
      .sand-access-cover[data-gd-scheme="dark"] p { color: rgba(244,241,234,0.72) !important; }
      #gd-kernel-gl, #gd-kernel-far, #gd-kernel-near, #gd-sats {
        position: absolute;
        inset: 0;
        display: block;
      }
      #gd-kernel-gl { z-index: 0; }
      #gd-kernel-far { z-index: 1; }
      #gd-kernel-near { z-index: 3; }
      #gd-sats { z-index: 4; }
      #gd-grok-hero {
        position: absolute !important;
        z-index: 5 !important;
        pointer-events: none !important;
        overflow: visible !important;
        color: var(--fg, #f4f1ea);
      }
      #gd-grok-hero svg { width: 100%; height: 100%; display: block; overflow: visible; fill: currentColor; }
      #gd-sky-actions {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        z-index: 999993;
        display: flex;
        gap: 14px;
        padding: 0;
        pointer-events: auto;
        background: none;
        border: 0;
        box-shadow: none;
        opacity: 1;
        transition: opacity .2s ease;
      }
      #gd-sky-actions.is-out { opacity: 0; pointer-events: none; }
      #gd-sky-actions .gd-lg-btn {
        position: relative;
        isolation: isolate;
        min-height: 40px;
        padding: 0 22px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #f4f1ea;
        font: 650 12px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        letter-spacing: 0.01em;
        cursor: pointer;
        overflow: hidden;
        transform-origin: 50% 80%;
      }
      #gd-sky-actions .gd-lg-btn canvas.gd-lg-glass {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        border-radius: inherit;
      }
      #gd-sky-actions .gd-lg-btn span {
        position: relative;
        z-index: 1;
        pointer-events: none;
        text-shadow: 0 1px 10px rgba(0,0,0,0.58);
      }
      .gd-quota {
        display:flex; align-items:center; gap:5px; width:100%;
        margin-top:3px;
      }
      .gd-quota-track {
        flex:1; height:4px; border-radius:99px;
        background: rgba(255,255,255,0.1); overflow:hidden;
        min-width:28px;
      }
      .gd-quota-fill {
        display:block; height:100%; border-radius:99px;
        transition: width .25s ease;
      }
      .gd-quota-n {
        font:700 9px/1 -apple-system,BlinkMacSystemFont,sans-serif;
        min-width:22px; text-align:right; letter-spacing:0.02em;
      }
      #gd-sats .gd-sat {
        position: absolute;
        left: 0;
        top: 0;
        will-change: transform;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
      }
      #gd-sats .gd-sat svg { width: 100%; height: 100%; display: block; }
      .gd-orb-hidden { display: none !important; }
      /* classic: the plasma layer holds still */
      .gd-orbs-classic [data-gd-rim] { display: none !important; }
      .gd-orbs-classic .pure-plasma-orb-1,
      .gd-orbs-classic .pure-plasma-orb-2 { filter: none !important; }
      .gd-orbs-classic .pure-plasma-orb-1 *,
      .gd-orbs-classic .pure-plasma-orb-2 * { animation: none !important; }
      .gd-orbs-classic .pure-plasma-core-glow { opacity: 0.32 !important; }
      #gd-orb-style {
        position: fixed; z-index: 999991; width: 22px; height: 22px; padding: 0;
        border-radius: 50%; cursor: pointer; display: flex; align-items: center;
        justify-content: center; color: var(--gd-text);
        border: 1px solid var(--gd-border); background: var(--gd-card-bg);
        box-shadow: var(--gd-shadow); backdrop-filter: blur(14px) saturate(160%);
        -webkit-backdrop-filter: blur(14px) saturate(160%);
        opacity: 0.55; transition: opacity .15s ease, transform .15s ease;
      }
      #gd-orb-style:hover { opacity: 1; transform: scale(1.08); }
      #gd-orb-style svg { display: block; }
      /* the chip carries inline sizing from when it is built, so the collapsed
         puck has to out-rank it */
      #grok-d-login-chip.is-collapsed {
        min-width: 0 !important; max-width: none !important;
        width: 46px !important; height: 46px !important; box-sizing: border-box !important;
        padding: 5px !important; border-radius: 50% !important; gap: 0 !important;
        justify-content: center;
      }
      #grok-d-login-chip.is-collapsed > *:not(.gd-acc-photo) { display: none !important; }
      #grok-d-chip-toggle {
        border: 0; background: transparent; cursor: pointer; padding: 2px;
        color: var(--gd-text-dim); display: flex; align-items: center; border-radius: 6px;
      }
      #grok-d-chip-toggle:hover { color: var(--gd-text); background: rgba(127,127,140,0.18); }
      .pure-plasma-orb-1 .gd-orb-photo {
        position: absolute;
        inset: 0;
        z-index: 2;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        box-shadow: inset 0 0 10px rgba(0,0,0,0.5), inset 0 -3px 7px rgba(0,0,0,0.45);
      }
      .pure-plasma-orb-1 .gd-orb-photo img,
      .pure-plasma-orb-1 .gd-orb-photo svg {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .sand-access-cover > *:not(#gd-kernel) { position: relative; z-index: 2; }
      #gd-scheme-toggle {
        position: fixed; right: 18px; top: 52px; bottom: auto; z-index: 999992;
        min-width: 72px; height: 32px; padding: 0 12px; cursor: pointer;
        border-radius: 999px; font: 600 11px/1 -apple-system, BlinkMacSystemFont, sans-serif;
        letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--gd-text); border: 1px solid var(--gd-border);
        background: var(--gd-card-bg); box-shadow: var(--gd-shadow);
        backdrop-filter: blur(14px) saturate(160%);
        -webkit-backdrop-filter: blur(14px) saturate(160%);
      }
      .sand-grok-bot-mark { z-index: 5; }
      #sand-access-cover-heading,
      .sand-access-cover h1 {
        z-index: 6;
        text-shadow: 0 1px 18px rgba(0,0,0,0.7);
      }
      @keyframes gdPearlShift {
        0% { filter: drop-shadow(5px 10px 16px rgba(0,0,0,0.55)) drop-shadow(0 0 14px rgba(255,196,210,0.45)); }
        40% { filter: drop-shadow(5px 10px 16px rgba(0,0,0,0.55)) drop-shadow(0 0 14px rgba(186,214,255,0.4)); }
        70% { filter: drop-shadow(5px 10px 16px rgba(0,0,0,0.55)) drop-shadow(0 0 14px rgba(255,226,176,0.4)); }
        100% { filter: drop-shadow(5px 10px 16px rgba(0,0,0,0.55)) drop-shadow(0 0 14px rgba(255,196,210,0.45)); }
      }
      .sand-grok-bot-mark.gd-bot-pearl { animation: gdPearlShift 5.6s ease-in-out infinite; }
      .sand-grok-bot-mark.gd-bot-blackhole {
        filter: drop-shadow(6px 11px 16px rgba(0,0,0,0.88)) drop-shadow(0 0 12px rgba(255,110,60,0.28));
      }

      /* Hide fake cloud reconnecting badge in local mode without touching sidebar */
      span.sand-4z9k3i,
      div:has(> span.sand-4z9k3i) {
        display: none !important;
      }

      /* Hide false-alarm update required modals */
      .sand-update-required,
      [class*="sand-update-required"],
      div[class*="update-required"] {
        display: none !important;
      }

      /* Tesla candy red for the grok mark itself, wherever it renders: the
         little one riding the model orb, the picker header, every model chip.
         The mark ships as fill="currentColor" inside an <img> data URL, so CSS
         cannot reach it; candyGrokMarks() rewrites the fill to a candy gradient
         instead. The surrounding bubble then picks the red up on its own,
         because the rim is painted from a copy of its own contents. */
      img[data-gd-grok="1"] {
        filter:
          drop-shadow(0 0 3px rgba(255, 52, 72, 0.85))
          drop-shadow(0 0 8px rgba(206, 12, 32, 0.5));
      }
      .pure-standalone-proxy-icon.gd-grok-host {
        --proxy-glow: rgba(255, 42, 62, 0.95) !important;
      }

      /* Model chips read as flat grey slabs because their only light is a
         backdrop blur of the dark panel behind them. Give them their own
         highlight, a real rim and room to breathe so they are actually glass. */
      /* The panel is an oval, so a tray that fills its full width pushes chips
         out through the curve. Centre them and inset the run. */
      .whimsical-model-tray {
        gap: 8px !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        justify-content: center !important;
        align-items: center !important;
        padding: 0 14px !important;
        box-sizing: border-box !important;
      }
      .whimsical-model-item { flex: 0 0 auto !important; }
      .whimsical-model-item {
        border-radius: 999px !important;
        padding: 7px 13px !important;
        background: radial-gradient(150% 170% at 28% 8%,
          rgba(255, 255, 255, 0.24) 0%,
          rgba(255, 255, 255, 0.07) 36%,
          rgba(16, 16, 28, 0.72) 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.45),
          inset 0 -7px 14px rgba(0, 0, 0, 0.5),
          0 4px 12px rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: blur(18px) saturate(190%) !important;
        -webkit-backdrop-filter: blur(18px) saturate(190%) !important;
      }
      .whimsical-model-item:hover {
        transform: translateY(-1.5px) scale(1.04) !important;
        border-color: rgba(255, 255, 255, 0.44) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.6),
          inset 0 -7px 14px rgba(0, 0, 0, 0.45),
          0 7px 18px rgba(0, 0, 0, 0.55) !important;
      }
      /* the active model wears the same candy red as the grok mark */
      .whimsical-model-item.is-active-model {
        background: radial-gradient(150% 170% at 28% 8%,
          rgba(255, 120, 134, 0.3) 0%,
          rgba(214, 12, 34, 0.16) 46%,
          rgba(28, 6, 12, 0.8) 100%) !important;
        border-color: rgba(255, 62, 82, 0.6) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 190, 196, 0.55),
          inset 0 -7px 14px rgba(0, 0, 0, 0.45),
          0 0 16px rgba(255, 40, 60, 0.34) !important;
      }
      /* The picker is built in the packed preload with hardcoded dark-theme
         colours: white labels on dark glass. In light mode the shell turns
         white but the text stays white, so the whole picker goes unreadable.
         Repaint the shell as light glass and force the inherited text dark;
         accents that carry meaning are re-exempted below. */
      @media (prefers-color-scheme: light) {
        .ghostly-liquid-glass-bubble {
          background: radial-gradient(135% 135% at 30% 8%,
            rgba(255, 255, 255, 0.97) 0%,
            rgba(250, 250, 253, 0.92) 38%,
            rgba(234, 234, 242, 0.88) 78%,
            rgba(223, 223, 233, 0.9) 100%) !important;
          border-color: rgba(0, 0, 0, 0.1) !important;
          box-shadow:
            0 32px 80px rgba(0, 0, 0, 0.18),
            inset 0 -8px 24px rgba(0, 0, 0, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
        }
        .ghostly-liquid-glass-bubble,
        .ghostly-liquid-glass-bubble *:not([data-gd-rim]):not([data-gd-rim] *) {
          color: #1b1b20 !important;
        }
        .liquid-orb-name-pill {
          background: rgba(255, 255, 255, 0.94) !important;
          border: 1px solid rgba(0, 0, 0, 0.12) !important;
          color: #1b1b20 !important;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16) !important;
        }
        .liquid-glass-orb {
          background: radial-gradient(circle at 45% 45%,
            rgba(255, 255, 255, 0.98) 0%,
            rgba(248, 248, 252, 0.9) 42%,
            rgba(228, 228, 238, 0.88) 100%) !important;
          border-color: rgba(0, 0, 0, 0.1) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.95),
            inset 0 -3px 7px rgba(0, 0, 0, 0.07),
            0 5px 14px rgba(0, 0, 0, 0.14),
            0 0 14px var(--glow-color, rgba(0, 0, 0, 0.12)) !important;
        }
        /* keep the meaning-carrying accents */
        .ghostly-liquid-glass-bubble .gd-idpill.is-on,
        .ghostly-liquid-glass-bubble .gd-idpill.is-on * { color: #047857 !important; }
        .whimsical-model-item.is-active-model,
        .whimsical-model-item.is-active-model * { color: #9f0f22 !important; }
      }

      @media (prefers-color-scheme: light) {
        .whimsical-model-item {
          background: radial-gradient(150% 170% at 28% 8%,
            rgba(255, 255, 255, 0.98) 0%,
            rgba(246, 246, 250, 0.9) 42%,
            rgba(226, 226, 234, 0.82) 100%) !important;
          border-color: rgba(0, 0, 0, 0.1) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.95),
            inset 0 -6px 12px rgba(0, 0, 0, 0.05),
            0 3px 10px rgba(0, 0, 0, 0.12) !important;
        }
        .whimsical-model-item.is-active-model {
          background: radial-gradient(150% 170% at 28% 8%,
            rgba(255, 226, 228, 0.98) 0%,
            rgba(255, 176, 184, 0.6) 52%,
            rgba(236, 150, 160, 0.5) 100%) !important;
          border-color: rgba(206, 12, 32, 0.42) !important;
        }
      }
    `;
    document.head.appendChild(s);
  }

  const _svgCache = {};
  function getGalleryIconSvg(iconName, asCircle = true) {
    if (!iconName) return null;
    const secGuard = secGuardMod();
    if (!secGuard || typeof secGuard.isValidGalleryIconName !== "function" || typeof secGuard.sanitizeSvg !== "function") return null;
    if (!secGuard.isValidGalleryIconName(iconName)) return null;
    const cacheKey = iconName + (asCircle ? "_circle" : "_raw");
    if (_svgCache[cacheKey]) return _svgCache[cacheKey];
    try {
      const galleryDir = path.join(ROOT, "gallery-icons");
      const p = path.resolve(galleryDir, path.basename(iconName));
      if (!p.startsWith(galleryDir + path.sep)) return null;
      if (fs.existsSync(p)) {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink() || !st.isFile()) return null;
        const real = fs.realpathSync(p);
        if (!real.startsWith(galleryDir + path.sep)) return null;
        let raw = fs.readFileSync(p, "utf8");
        raw = secGuard.sanitizeSvg(raw);
        if (!raw) return null;
        if (asCircle) {
          raw = raw.replace(/<rect x="0" y="0" width="512" height="512" rx="\d+" ry="\d+"\s*\/>/g, '<circle cx="256" cy="256" r="256" />')
                   .replace(/<rect width="512" height="512" rx="\d+"\s*\/>/g, '<circle cx="256" cy="256" r="256" />')
                   .replace(/rx="115"\s*ry="115"/g, 'rx="256" ry="256"');
        }
        _svgCache[cacheKey] = raw;
        return raw;
      }
    } catch (_) {}
    return null;
  }

  const BOT_COLORS = [
    { name: "Electric Violet", hex: "#8b5cf6", glow: "rgba(139, 92, 246, 0.65)" },
    { name: "Neon Azure", hex: "#00f0ff", glow: "rgba(0, 240, 255, 0.65)" },
    { name: "Hyper Flame", hex: "#ff1e56", glow: "rgba(255, 30, 86, 0.65)" },
    { name: "Sunset Amber", hex: "#f97316", glow: "rgba(249, 115, 22, 0.65)" },
    { name: "Emerald Mint", hex: "#10b981", glow: "rgba(16, 185, 129, 0.65)" },
    { name: "Bubblegum Rose", hex: "#ec4899", glow: "rgba(236, 72, 153, 0.65)" },
    { name: "Solar Gold", hex: "#f59e0b", glow: "rgba(245, 158, 11, 0.65)" },
    { name: "Platinum Frost", hex: "#e2e8f0", glow: "rgba(255, 255, 255, 0.55)" }
  ];

  function sanitizeHexColor(colorHex, fallback = "#8b5cf6") {
    const s = String(colorHex || "").trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
      return s;
    }
    return fallback;
  }

  function getProfileColorInfo(colorHex) {
    const sanitized = sanitizeHexColor(colorHex);
    const found = BOT_COLORS.find((c) => c.hex.toLowerCase() === sanitized.toLowerCase());
    if (found) return found;
    return { name: "Custom", hex: sanitized, glow: "rgba(139, 92, 246, 0.65)" };
  }

  function getProfileMascotSvg(profile, id) {
    const defaultIcons = {
      "cursor-a": "icon_03_lightning.svg",
      "local-d": "icon_12_hexagon.svg"
    };
    const targetFile = (profile && profile.icon) || defaultIcons[id] || "icon_03_lightning.svg";
    return getGalleryIconSvg(targetFile, true);
  }

  function closeIconPicker() {
    const p = document.getElementById("grok-icon-picker-modal");
    if (p) p.remove();
  }

  function openGalleryIconPicker(targetProfileId) {
    ensureStyles();
    closeIconPicker();
    const storeData = load();
    const profile = (storeData.profiles || []).find((p) => p.id === targetProfileId);
    if (!profile) return;

    const modal = el("div", `
      position:fixed;inset:0;z-index:1000005;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.8);backdrop-filter:blur(24px) saturate(180%);
      -webkit-backdrop-filter:blur(24px) saturate(180%);color:var(--gd-text);
      font:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",sans-serif;padding:20px;
    `);
    modal.id = "grok-icon-picker-modal";

    let iconFiles = [];
    const secGuard = secGuardMod();
    try {
      const gDir = path.join(ROOT, "gallery-icons");
      if (fs.existsSync(gDir)) {
        iconFiles = fs.readdirSync(gDir).filter((f) => {
          if (secGuard && secGuard.isValidGalleryIconName) {
            return secGuard.isValidGalleryIconName(f);
          }
          return /^[a-zA-Z0-9_-]+\.svg$/.test(f);
        }).sort();
      }
    } catch (_) {}

    const escapeAttr = (s) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapeText = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const curColor = profile.color || "#8b5cf6";
    const colorSwatchesHtml = BOT_COLORS.map((c) => {
      const isSelected = curColor.toLowerCase() === c.hex.toLowerCase();
      const safeHex = escapeAttr(c.hex);
      const safeName = escapeAttr(c.name);
      return `
        <button type="button" class="gp-color-opt" data-color="${safeHex}" title="${safeName}" style="
          width:28px;height:28px;border-radius:50%;cursor:pointer;
          background:${safeHex};border:${isSelected ? "2.5px solid #fff" : "1.5px solid rgba(255,255,255,0.35)"};
          box-shadow:${isSelected ? "0 0 16px " + c.glow : "0 2px 8px rgba(0,0,0,0.3)"};
          transform:${isSelected ? "scale(1.15)" : "scale(1)"};transition:all 0.15s ease;
        "></button>
      `;
    }).join("");

    const iconGrid = iconFiles.map((file) => {
      const isSelected = profile.icon === file;
      const cleanName = file.replace(/^icon_\d+_/, "").replace(/\.svg$/, "").replace(/([A-Z])/g, " $1");
      const iconSvg = getGalleryIconSvg(file, true);
      const safeFile = escapeAttr(file);
      const safeTitle = escapeAttr(cleanName);
      const safeText = escapeText(cleanName);
      return `
        <button type="button" class="gp-icon-opt" data-file="${safeFile}" title="${safeTitle}" style="
          display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;border-radius:16px;
          background:${isSelected ? "var(--gd-pill-active)" : "var(--gd-btn-sec-bg)"};
          border:1.5px solid ${isSelected ? "var(--gd-green)" : "var(--gd-border-subtle)"};
          box-shadow:${isSelected ? "0 0 14px var(--gd-green)" : "none"};
          cursor:pointer;transition:all 0.15s ease;
        ">
          <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.25)">
            ${iconSvg || ""}
          </div>
          <span style="font-size:9.5px;font-weight:${isSelected ? "700" : "500"};color:var(--gd-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60px;text-transform:capitalize">
            ${safeText}
          </span>
        </button>
      `;
    }).join("");

    modal.innerHTML = `
      <div style="
        width:580px;max-width:94vw;max-height:88vh;border-radius:24px;
        background:var(--gd-card-bg);border:1px solid var(--gd-border);
        box-shadow:var(--gd-shadow);padding:22px 22px 18px;box-sizing:border-box;
        display:flex;flex-direction:column;gap:14px;animation:gdScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--gd-border-subtle);padding-bottom:12px">
          <div>
            <div style="font-weight:700;font-size:16px;color:var(--gd-text)">Customize ${escHtml(profile.name)}</div>
            <div style="font-size:12px;color:var(--gd-text-muted);margin-top:2px">Choose an avatar and accent color for this account</div>
          </div>
          <button type="button" id="gip-close" style="background:none;border:none;color:var(--gd-text-dim);cursor:pointer;padding:4px;display:flex;align-items:center">
            ${ICONS.dismiss}
          </button>
        </div>

        <!-- Color Palette Picker -->
        <div style="background:var(--gd-pill-bar);padding:10px 14px;border-radius:14px;border:1px solid var(--gd-border-subtle);display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:12px;font-weight:600;color:var(--gd-text)">Accent color:</div>
          <div style="display:flex;align-items:center;gap:8px">
            ${colorSwatchesHtml}
          </div>
        </div>

        <!-- Vector Icon Gallery Grid -->
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--gd-text-dim);margin-top:2px">
          Mascot Icon
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:9px;overflow-y:auto;max-height:50vh;padding:4px">
          ${iconGrid}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#gip-close").addEventListener("click", closeIconPicker);
    
    // Both pickers write one field on the active profile, then refresh chrome.
    function persistProfileField(field, value, okMsg, errTag, failMsg) {
      try {
        const storeMod = require(path.join(ROOT, "profile-store.js"));
        const fresh = storeMod.load();
        const p = (fresh.profiles || []).find((x) => x.id === targetProfileId);
        if (p) {
          p[field] = value;
          storeMod.save(fresh);
        }
        toast(okMsg);
      } catch (err) {
        logRendererError(errTag, err);
        toast(failMsg);
      }
    }

    function refreshProfileChrome() {
      paintLoginChip();
      const v = document.getElementById("grok-profile-veil");
      if (v) veil();
    }

    modal.querySelectorAll(".gp-color-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pickedColor = btn.getAttribute("data-color");
        if (pickedColor) {
          persistProfileField("color", pickedColor,
            "Updated color theme for " + profile.name, "save-color", "Unable to save color theme");
          openGalleryIconPicker(targetProfileId);
          refreshProfileChrome();
        }
      });
    });

    modal.querySelectorAll(".gp-icon-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pickedFile = btn.getAttribute("data-file");
        if (pickedFile) {
          persistProfileField("icon", pickedFile,
            "Updated mascot icon for " + profile.name, "save-icon", "Unable to save mascot icon");
          closeIconPicker();
          refreshProfileChrome();
        }
      });
    });
  }

  function getProviderInfo(raw, id) {
    const s = String(raw || "").toLowerCase();
    const isLocal = s.includes("local") || String(id || "").includes("local");
    if (isLocal) return { name: "Local Box", icon: ICONS.local, key: "local" };
    if (s.includes("google")) return { name: "Google", icon: ICONS.google, key: "google" };
    if (s.includes("auth0")) return { name: "Auth0", icon: ICONS.auth0, key: "auth0" };
    if (s.includes("github")) return { name: "GitHub", icon: ICONS.github, key: "github" };
    return { name: "Cursor ID", icon: ICONS.local, key: "cursor" };
  }

  function veil(msg) {
    if (isLocalSeat()) {
      unveil();
      return;
    }
    ensureStyles();
    let v = document.getElementById("grok-profile-veil");
    const id = activeId();
    const curProfile = (load().profiles || []).find((p) => p.id === id);
    const seatLetter = (id || "").replace(/^cursor-/, "").toUpperCase() || "D";
    const profileName = curProfile ? curProfile.name : `Seat ${seatLetter}`;
    const allProfiles = load().profiles || [];
    const colorInfo = getProfileColorInfo(curProfile ? curProfile.color : "#8b5cf6");

    const splashActive = !!(document.getElementById("grokd-splash-stage") || window.__grokdSplashPlaying);
    if (!v) {
      v = el("div", `
        position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;
        background:var(--gd-backdrop);backdrop-filter:blur(24px) saturate(180%);
        -webkit-backdrop-filter:blur(24px) saturate(180%);color:var(--gd-text);
        font:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",sans-serif;
        padding:24px;transition:opacity 0.25s ease, visibility 0.25s ease;
        visibility:${splashActive ? "hidden" : "visible"};
        opacity:${splashActive ? "0" : "1"};
        pointer-events:${splashActive ? "none" : "auto"};
      `);
      v.id = "grok-profile-veil";
      document.body.appendChild(v);
    } else {
      if (splashActive) {
        v.style.visibility = "hidden";
        v.style.opacity = "0";
        v.style.pointerEvents = "none";
      } else {
        v.style.visibility = "visible";
        v.style.opacity = "1";
        v.style.pointerEvents = "auto";
      }
      const msgEl = v.querySelector("#gv-subtitle");
      if (msgEl) { msgEl.textContent = msg || "Sign in through the isolated browser window."; }
    }

    const seatPills = allProfiles.map((p) => {
      const isCur = p.id === id;
      const letter = (p.id || "").replace(/^cursor-/, "").toUpperCase() || "D";
      const pColor = getProfileColorInfo(p.color);
      const mascotSvg = getProfileMascotSvg(p, p.id);
      return `
        <button type="button" class="gv-pill-btn" data-id="${escAttr(p.id)}" style="
          flex:1;min-width:68px;padding:7px 8px;border-radius:10px;cursor:pointer;
          background:${isCur ? "var(--gd-pill-active)" : "transparent"};
          border:${isCur ? "1px solid " + pColor.hex : "1px solid transparent"};
          box-shadow:${isCur ? "0 0 10px " + pColor.glow : "none"};
          color:${isCur ? "var(--gd-pill-active-text)" : "var(--gd-text-dim)"};
          font:600 11.5px inherit;display:flex;align-items:center;justify-content:center;gap:6px;
          transition:all 0.15s ease;
        ">
          <span style="width:18px;height:18px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px ${pColor.glow}">
            ${mascotSvg || getProviderInfo(p.id, p.id).icon}
          </span>
          <span>${escHtml(p.name || `Seat ${letter}`)}</span>
        </button>
      `;
    }).join("");

    const heroMascot = getProfileMascotSvg(curProfile, id);

    v.innerHTML = `
      <div style="
        width:420px;max-width:92vw;border-radius:24px;
        background:var(--gd-card-bg);border:1px solid var(--gd-border);
        box-shadow:var(--gd-shadow);padding:24px 22px 20px;
        box-sizing:border-box;display:flex;flex-direction:column;gap:18px;
        animation:gdScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      ">
        <!-- Segmented Seat Switcher -->
        <div style="
          display:flex;background:var(--gd-pill-bar);padding:3px;border-radius:13px;
          border:1px solid var(--gd-border-subtle);gap:3px;
        ">
          ${seatPills}
        </div>

        <!-- Glowing Glassy Orb & Identity Hero -->
        <div style="text-align:center;padding:4px 0 2px">
          <!-- PURE GLOWING GLASSY ORB (NO SQUIRCLE-IN-CIRCLE) -->
          <div id="gv-avatar-ring" style="
            width:78px;height:78px;border-radius:50%;margin:0 auto 12px;
            background:radial-gradient(circle at 35% 25%, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(0, 0, 0, 0.25) 100%), ${colorInfo.hex};
            border:1.5px solid rgba(255, 255, 255, 0.5);
            box-shadow:0 0 32px ${colorInfo.glow}, 0 8px 24px rgba(0,0,0,0.45), inset 0 2px 4px rgba(255,255,255,0.7);
            display:flex;align-items:center;justify-content:center;overflow:hidden;
            cursor:pointer;position:relative;transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          " title="Click to customize bot icon and color theme">
            ${heroMascot ? `<div style="width:78px;height:78px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center">${heroMascot}</div>` : seatLetter}
          </div>

          <div id="gv-hero-account" style="font-size:16px;font-weight:600;color:var(--gd-text);letter-spacing:-0.01em">
            Detecting account…
          </div>

          <div id="gv-hero-status" style="
            display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;
            color:var(--gd-text-muted);margin-top:4px;
          ">
            <span id="gv-hero-dot" style="width:7px;height:7px;border-radius:50%;background:var(--gd-amber)"></span>
            <span id="gv-hero-status-text">Checking credentials</span>
          </div>

          <!-- Direct Customizer Link -->
          <div style="margin-top:8px">
            <button type="button" id="gv-btn-customize" style="
              background:var(--gd-btn-sec-bg);border:1px solid var(--gd-border-subtle);
              color:var(--gd-text);border-radius:10px;padding:5px 12px;cursor:pointer;
              font:600 11px inherit;display:inline-flex;align-items:center;gap:6px;
              transition:all 0.15s ease;box-shadow:0 2px 8px rgba(0,0,0,0.15);
            ">
              <span style="font-size:12px">🎨</span>
              <span>Customize Bot & Icon</span>
            </button>
          </div>

          <div id="gv-subtitle" style="
            font-size:12px;color:var(--gd-text-dim);margin-top:10px;line-height:1.45;padding:0 8px;
          ">
            ${msg || "Sign in through the isolated browser window or reset this seat."}
          </div>
        </div>

        <!-- Primary & Secondary Actions -->
        <div style="display:flex;flex-direction:column;gap:8px">
          <button type="button" id="gv-btn-reopen" style="
            width:100%;padding:11px 16px;border-radius:12px;cursor:pointer;
            background:var(--gd-btn-primary-bg);border:none;color:var(--gd-btn-primary-text);
            font:600 13px inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            transition:opacity 0.15s ease;
          ">
            ${ICONS.browser}
            <span>Open Clean Browser</span>
          </button>

          <div style="display:flex;gap:8px">
            <button type="button" id="gv-btn-reset" style="
              flex:1;padding:10px 12px;border-radius:12px;cursor:pointer;
              background:var(--gd-red-bg);border:1px solid var(--gd-red-border);
              color:var(--gd-red-text);font:600 12px inherit;
              display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.15s ease;
            ">
              ${ICONS.reset}
              <span>Reset Session</span>
            </button>

            <button type="button" id="gv-btn-unveil" style="
              flex:1;padding:10px 12px;border-radius:12px;cursor:pointer;
              background:var(--gd-btn-sec-bg);border:1px solid var(--gd-border-subtle);
              color:var(--gd-text-muted);font:500 12px inherit;
              display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.15s ease;
            ">
              ${ICONS.dismiss}
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      </div>
    `;

    v.querySelector("#gv-btn-unveil").addEventListener("click", unveil);
    v.querySelectorAll(".gv-pill-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const targetId = b.getAttribute("data-id");
        if (targetId && targetId !== id) {
          unveil();
          toast("Swapping to " + profileDisplayName(targetId) + "…");
          switchTo(targetId);
        }
      });
    });
    v.querySelector("#gv-avatar-ring").addEventListener("click", () => {
      openGalleryIconPicker(id);
    });
    v.querySelector("#gv-btn-customize").addEventListener("click", () => {
      openGalleryIconPicker(id);
    });
    v.querySelector("#gv-btn-reset").addEventListener("click", () => {
      toast("Resetting browser session for " + profileDisplayName(id) + "…");
      try { require(path.join(ROOT, "browser-login.js")).resetProfile(id); } catch {}
      loginClean({ reset: true }).catch((e) => {
        logRendererError("reset", e);
        toast("Reset failed. Please retry.");
      });
    });
    v.querySelector("#gv-btn-reopen").addEventListener("click", () => {
      loginClean({ reset: false }).catch((e) => {
        logRendererError("login", e);
        toast("Sign-in could not be started. Please retry.");
      });
    });

    identity().then((st) => {
      const accEl = v.querySelector("#gv-hero-account");
      const dotEl = v.querySelector("#gv-hero-dot");
      const statEl = v.querySelector("#gv-hero-status-text");
      const ringEl = v.querySelector("#gv-avatar-ring");
      if (!accEl || !dotEl || !statEl) return;

      if (isLocalSeat(id) || (st && st.provider === "local")) {
        accEl.textContent = "Local D";
        dotEl.style.background = "var(--gd-green)";
        statEl.textContent = "This Mac · no Cursor sign-in";
        statEl.style.color = "var(--gd-green-text)";
        const reopen = v.querySelector("#gv-btn-reopen");
        const reset = v.querySelector("#gv-btn-reset");
        if (reopen) reopen.style.display = "none";
        if (reset) reset.style.display = "none";
        const sub = v.querySelector("#gv-subtitle");
        if (sub) sub.textContent = "Local bots on this Mac — no Cursor sign-in.";
        return;
      }

      const raw = String((st && (st.email || st.authId)) || "");
      const prov = getProviderInfo(raw || id, id);
      const mascot = getProfileMascotSvg(curProfile, id);
      if (ringEl) {
        if (mascot) {
          ringEl.innerHTML = `<div style="width:78px;height:78px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center">${mascot}</div>`;
        } else if (prov.icon) {
          ringEl.innerHTML = `<span style="transform:scale(1.4);display:flex;align-items:center">${prov.icon}</span>`;
        }
      }

      if (st && st.kind === "logged-in" && raw) {
        accEl.textContent = raw;
        dotEl.style.background = "var(--gd-green)";
        statEl.textContent = `${prov.name} · Connected`;
        statEl.style.color = "var(--gd-green-text)";
      } else if (st && st.kind === "logging-in") {
        accEl.textContent = raw ? raw : "Clean Slate";
        dotEl.style.background = "var(--gd-amber)";
        statEl.textContent = "Waiting for Clean Browser Sign-in";
        statEl.style.color = "var(--gd-amber-text)";
      } else {
        accEl.textContent = "No Account Connected";
        dotEl.style.background = "var(--gd-text-dim)";
        statEl.textContent = "Signed out / Standby";
        statEl.style.color = "var(--gd-text-dim)";
      }
    }).catch(() => {});
  }

  function unveil() {
    const v = document.getElementById("grok-profile-veil");
    if (v) v.remove();
  }

  function seat4Root() {
    return path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
  }

  function remoteConnPath() {
    return path.join(seat4Root(), "sand-data", "local-exec-daemon-connection.json");
  }

  function hasRemoteComputer() {
    try {
      const box = require(path.join(ROOT, "box-state.js"));
      return box.isRemoteConnection(remoteConnPath());
    } catch {
      return false;
    }
  }

  function hasHealthyComputer() {
    try {
      const box = require(path.join(ROOT, "box-state.js"));
      return box.isHealthyRemoteFile(remoteConnPath());
    } catch {
      return false;
    }
  }

  function coverLib() {
    const p = path.join(ROOT, "computer-cover.js");
    try { delete require.cache[require.resolve(p)]; } catch {}
    try { return require(p); }
    catch { return null; }
  }

  function computerKeepState() {
    const seat = activeId();
    const cur = window.__gdComputerKeep || { seat: "", last: 0, retries: 0, recovered: false };
    if (cur.seat !== seat) {
      window.__gdComputerKeep = { seat, last: 0, retries: 0, recovered: false, unauth: false };
    } else {
      window.__gdComputerKeep = cur;
    }
    return window.__gdComputerKeep;
  }

  function dressComputerLost() {
    const dialogs = document.querySelectorAll(
      '[data-ui-dialog-root], .sand-computer-couldnt-reach-dialog, .sand-computer-lifecycle-dialog, [class*="computer-couldnt-reach"], [class*="computer-lifecycle"]'
    );
    for (const d of dialogs) {
      const text = String(d.textContent || "");
      if (/Recover Grok Bot|Couldn.?t Reach|Reconnecting this seat/i.test(text)) {
        if (isLocalSeat()) {
          const backdrop = (d.closest && d.closest("[data-ui-dialog-backdrop]")) || d.parentElement;
          if (backdrop && backdrop !== document.body && backdrop.contains(d)) backdrop.remove();
          d.remove();
          continue;
        }
      }
    }
    if (isLocalSeat()) {
      const spans = document.querySelectorAll("span");
      for (const s of spans) {
        if ((s.textContent || "").trim() === "Reconnecting" && s.children.length === 0) {
          const wrap = s.closest("div");
          if (wrap && !wrap.classList.contains("sand-agents-sidebar") && !wrap.classList.contains("sand-shell")) {
            wrap.style.display = "none";
          }
        }
      }
      const routineToasts = [...document.querySelectorAll("*")].filter((el) => {
        return /Routine Sync Failed/i.test(el.textContent || "") && el.children.length > 0 && el.offsetHeight > 0 && el.offsetHeight < 200;
      });
      for (const t of routineToasts) {
        const btn = t.querySelector("button");
        if (btn) btn.click();
        else t.style.display = "none";
      }
      const updateBlockers = document.querySelectorAll(".sand-update-required, [class*='update-required']");
      for (const ub of updateBlockers) ub.remove();
    }
    const lib = coverLib();
    if (!lib || !lib.restyleLostDialog) return;
    try { lib.restyleLostDialog(document, { paused: botsPaused(activeId()), local: isLocalSeat() }); }
    catch (_) {}
  }

  function snapshotActiveBox() {
    try {
      const store = require(path.join(ROOT, "profile-store.js"));
      const box = require(path.join(ROOT, "box-state.js"));
      const p = store.getActive();
      if (!p || p.kind !== "cursor") return;
      box.snapshotHost(seat4Root(), store.profileDataDir(p.id));
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[snapshot-box] " + e + "\n"); } catch (_) {}
    }
  }

  function seedOfficialDescriptor() {
    try {
      const store = require(path.join(ROOT, "profile-store.js"));
      const p = store.getActive();
      if (!p || p.kind !== "cursor") return false;
      const dst = path.join(seat4Root(), "gateway-descriptor.json");
      const saved = path.join(store.profileDataDir(p.id), "secrets", "gateway-descriptor.json");
      const live = p.identitySource
        ? path.join(p.identitySource, "gateway-descriptor.json")
        : null;
      const box = require(path.join(ROOT, "box-state.js"));
      if (box.officialUsesThisMac(p.identitySource || p.sourceUserData)) return false;
      const src = box.newerFile(
        fs.existsSync(saved) ? saved : null,
        live && fs.existsSync(live) ? live : null
      );
      if (!src) return false;
      // Account-scope binding: ensure the descriptor matches the active profile's expected scope
      const currentScope = box.accountScopeFromSecrets(seat4Root());
      try {
        const descData = JSON.parse(fs.readFileSync(src, "utf8"));
        if (descData.accountScope && currentScope && descData.accountScope !== currentScope) {
          try { fs.rmSync(dst, { force: true }); } catch (_) {}
          return false;
        }
      } catch (_) {}
      if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) return false;
      fs.copyFileSync(src, dst);
      return true;
    } catch (e) {
      try { fs.appendFileSync(path.join(ROOT, "runtime", "renderer.log"), "[seed-desc] " + e + "\n"); } catch (_) {}
      return false;
    }
  }

  function tryInstallFromDescriptor() {
    try {
      const { safeStorage } = require("electron");
      const box = require(path.join(ROOT, "box-state.js"));
      return box.installFromDescriptor(seat4Root(), safeStorage);
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[desc-install] " + e + "\n"); } catch (_) {}
      return null;
    }
  }

  function alignSettings() {
    try {
      const box = require(path.join(ROOT, "box-state.js"));
      box.resetForeignSettings(seat4Root(), box.accountScopeFromSecrets(seat4Root()));
    } catch {}
  }

  function probeAuthToDisk() {
    const out = { ts: Date.now() };
    try {
      const { safeStorage } = require("electron");
      out.enc = !!(safeStorage && safeStorage.isEncryptionAvailable());
      const secrets = JSON.parse(fs.readFileSync(path.join(seat4Root(), "sand-secrets.json"), "utf8"));
      const tok = secrets["cursor-access-token"] || "";
      out.tokKind = tok.startsWith("scoped:v1:") ? "scoped" : tok.slice(0, 12);
      if (tok.startsWith("scoped:v1:") && out.enc) {
        const rest = tok.slice("scoped:v1:".length);
        const i = rest.indexOf(":");
        out.scope = rest.slice(0, i);
        try {
          const plain = safeStorage.decryptString(Buffer.from(rest.slice(i + 1), "base64"));
          out.tokDecrypt = "ok";
          out.tokLen = plain.length;
          out.tokJwt = (plain.match(/\./g) || []).length >= 2;
          out.hasToken = true;
        } catch (e) {
          out.tokDecrypt = String(e && e.message || e);
        }
      }
      const gdPath = path.join(seat4Root(), "gateway-descriptor.json");
      if (fs.existsSync(gdPath) && out.enc) {
        const gd = JSON.parse(fs.readFileSync(gdPath, "utf8"));
        out.gdScope = gd.accountScope || null;
        try {
          const conn = JSON.parse(safeStorage.decryptString(Buffer.from(gd.encrypted, "base64")));
          out.gdDecrypt = "ok";
          out.gdUrl = conn && conn.baseUrl || null;
        } catch (e) {
          out.gdDecrypt = String(e && e.message || e);
        }
      } else {
        out.gd = fs.existsSync(gdPath) ? "present" : "missing";
      }
    } catch (e) {
      out.error = String(e && e.message || e);
    }
    try {
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(path.join(RUNTIME, "auth-probe.json"), JSON.stringify(out, null, 2) + "\n");
    } catch {}
    return out;
  }

  function pageCall(src, timeoutMs) {
    const ms = timeoutMs == null ? 8000 : timeoutMs;
    try {
      const { webFrame } = require("electron");
      const work = webFrame.executeJavaScript(`(async()=>{ ${src} })()`, true)
        .then((value) => ({ ok: true, value }))
        .catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      if (!ms) return work;
      return Promise.race([
        work,
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "timeout" }), ms)),
      ]);
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e && e.message || e) });
    }
  }

  async function loggedIn() {
    const s = await identity();
    return !!(s && s.kind === "logged-in");
  }

  async function loginClean(opts) {
    const reset = !!(opts && opts.reset);
    const id = activeId();
    if (isLocalSeat(id)) {
      unveil();
      toast("Local D is this Mac — no Cursor sign-in");
      return { id, action: "local" };
    }
    if (window.__gdLoggingIn) {
      toast("Sign-in is already open in the browser for " + profileDisplayName(id));
      return { id, action: "in-flight" };
    }
    window.__gdLoggingIn = true;
    try {
      const st = await identity();
      if (st && st.kind === "logged-in" && !reset) {
        unveil();
        toast("This seat is already signed in");
        return { id, action: "already", status: st };
      }
      if (st && st.kind === "logging-in") {
        const reopened = await pageCall(`
          const btn = [...document.querySelectorAll("button")].find(b => /Reopen link/i.test(b.textContent||""));
          if (btn) { btn.click(); return "reopen"; }
          return "logging-in";
        `);
        veil("Complete sign-in in the browser window to continue.");
        toast("Use that Chrome window — do not start another sign-in");
        return { id, action: reopened && reopened.value || "logging-in" };
      }
      if (reset) {
        try { require(path.join(ROOT, "browser-login.js")).resetProfile(id); } catch {}
      }
      if (st && st.kind === "logged-in") {
        await pageCall("return await window.desktop.cursorAccount.logout()");
      }
      veil("Opening a clean browser for this seat. Sign in there — not in your regular Chrome.");
      const login = await pageCall("return await window.desktop.cursorAccount.login()");
      toast("Finish sign-in in the clean Chrome window for " + profileDisplayName(id));
      if ((await identity()).kind === "logged-in") unveil();
      return { id, action: "login", login };
    } finally {
      window.__gdLoggingIn = false;
      if ((await identity()).kind === "logged-in") unveil();
    }
  }

  async function usageAccepted() {
    const r = await pageCall("return await window.desktop.cursorAccount.getUsageSummary()");
    if (!r || r.ok === false) {
      const err = String((r && r.error) || "");
      return { ok: false, error: err, unauth: /unauth/i.test(err) };
    }
    return { ok: true, value: r.value };
  }

  async function ensureCursorComputer() {
    if (mode() !== "cursor") return { action: "not-cursor" };
    if (window.__gdEnsuringBox) return { action: "in-flight" };
    window.__gdEnsuringBox = true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (hasHealthyComputer()) return true;
        const fromDesc = tryInstallFromDescriptor();
        if (fromDesc && hasHealthyComputer()) return true;
        await sleep(400);
      }
      return hasHealthyComputer();
    };
    try {
      if (hasHealthyComputer()) {
        snapshotActiveBox();
        return { action: "already" };
      }
      if (botsPaused(activeId())) {
        return { action: "paused" };
      }
      try {
        require(path.join(ROOT, "box-state.js")).clearLocalLeftovers(seat4Root());
      } catch {}
      alignSettings();
      seedOfficialDescriptor();
      const probe = probeAuthToDisk();
      const fromDesc = tryInstallFromDescriptor();
      if (hasHealthyComputer()) {
        snapshotActiveBox();
        unveil();
        toast("Computer is ready");
        return { action: "descriptor", url: fromDesc, probe };
      }
      veil("Asking Cursor for a computer…");
      if ((await identity()).kind === "logging-in") {
        veil("Finish sign-in in the clean Chrome window. D is already waiting.");
        const t0 = Date.now();
        while (Date.now() - t0 < 180000 && !(await loggedIn())) await sleep(500);
        if (!(await loggedIn())) {
          unveil();
          toast("Sign-in did not finish. Use the chip once — do not start a second login.");
          return { action: "login-failed", probe };
        }
        snapshotActiveBox();
      } else if (!(await loggedIn())) {
        let hasTok = false;
        try {
          const sec = JSON.parse(fs.readFileSync(path.join(seat4Root(), "sand-secrets.json"), "utf8"));
          hasTok = !!(sec && sec["cursor-access-token"]);
        } catch {}
        if (hasTok) {
          // Token is already on disk. Do not start a second login that blanks the app.
        } else {
        veil("Sign in to this Cursor seat in the clean browser that just opened.");
        const login = await loginClean({ reset: false });
        const t0 = Date.now();
        while (Date.now() - t0 < 180000 && !(await loggedIn())) await sleep(500);
        if (!(await loggedIn())) {
          unveil();
          toast("Sign-in did not finish.");
          return { action: "login-failed", login, probe };
        }
        snapshotActiveBox();
        alignSettings();
        seedOfficialDescriptor();
        tryInstallFromDescriptor();
        if (hasHealthyComputer()) {
          snapshotActiveBox();
          unveil();
          toast("Computer is ready");
          return { action: "login-descriptor" };
        }
        }
      }
      if (await waitFor(8000)) {
        unveil();
        snapshotActiveBox();
        toast("Computer is ready");
        return { action: "official-connect", probe };
      }
      const usage = await usageAccepted();
      let recon = null;
      if (hasRemoteComputer()) {
        recon = await pageCall("return await window.desktop.forceGatewayReconnect()");
        if (await waitFor(12000)) {
          unveil();
          snapshotActiveBox();
          toast("Computer is ready");
          return { action: "reconnect", recon, usage, probe };
        }
      }
      const reconErr = String((recon && recon.error) || (usage && usage.error) || "");
      const unauth = !!(usage && usage.unauth) || /unauth/i.test(reconErr);
      unveil();
      if (unauth) {
        toast("This computer needs a fresh sign-in. Use the chip — it opens a clean browser.");
        return { action: unauth && !(await loggedIn()) ? "unauthenticated" : "pending", recon, usage, probe };
      }
      return { action: "pending", recon, usage, probe };
    } catch (e) {
      unveil();
      logRendererError("ensure-computer", e);
      toast("Unable to connect to computer environment. Please retry.");
      return { action: "error", error: String(e.message || e) };
    } finally {
      window.__gdEnsuringBox = false;
    }
  }

  function closeSheet() {
    const s = document.getElementById("grok-profile-sheet");
    if (s) s.remove();
  }

  function openSheet() {
    closeSheet();
    const sheet = el("div", `
      position:fixed;top:48px;left:72px;z-index:1000001;width:340px;
      padding:14px 14px 12px;border-radius:16px;
      background:rgba(18,18,22,0.94);border:1px solid rgba(255,255,255,0.12);
      box-shadow:0 18px 50px rgba(0,0,0,0.45);
      font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;color:#f4f4f5;
    `);
    sheet.id = "grok-profile-sheet";
    sheet.innerHTML = `
      <div style="font:700 13px/1.2 inherit;margin-bottom:10px">New profile</div>
      <label style="display:block;opacity:.7;margin:8px 0 4px">Name</label>
      <input id="gp-name" value="New profile" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#111;color:#fff;font:inherit">
      <label style="display:block;opacity:.7;margin:10px 0 4px">Kind</label>
      <div style="display:flex;gap:6px">
        <button type="button" data-kind="local" class="gp-kind" style="flex:1;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);color:#fff;font:inherit;cursor:pointer">Local box</button>
        <button type="button" data-kind="cursor" class="gp-kind" style="flex:1;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#ddd;font:inherit;cursor:pointer">Cursor ID</button>
      </div>
      <div id="gp-cursor-fields" style="display:none">
        <label style="display:block;opacity:.7;margin:10px 0 4px">Import chats from seat</label>
        <select id="gp-from" style="width:100%;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#111;color:#fff;font:inherit">
          <option value="">Sign in here (no import)</option>
          <option value="A">Grok A</option>
        </select>
        <label style="display:block;opacity:.7;margin:10px 0 4px">Sign in as (Cursor identity)</label>
        <select id="gp-identity" style="width:100%;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#111;color:#fff;font:inherit">
          <option value="">Same as import / sign in here</option>
          <option value="A">A’s Cursor</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button type="button" id="gp-cancel" style="padding:6px 10px;border-radius:9px;border:0;background:transparent;color:#aaa;font:inherit;cursor:pointer">Cancel</button>
        <button type="button" id="gp-save" style="padding:6px 12px;border-radius:9px;border:0;background:#ffffff;color:#000000;font:700 12px inherit;cursor:pointer">Create</button>
      </div>
    `;
    document.body.appendChild(sheet);
    let kind = "local";
    const paint = () => {
      sheet.querySelectorAll(".gp-kind").forEach((b) => {
        const on = b.getAttribute("data-kind") === kind;
        b.style.borderColor = on ? "#c4b5fd" : "rgba(255,255,255,.1)";
        b.style.background = on ? "rgba(196,181,253,.15)" : "transparent";
      });
      sheet.querySelector("#gp-cursor-fields").style.display = kind === "cursor" ? "block" : "none";
    };
    sheet.querySelectorAll(".gp-kind").forEach((b) => b.addEventListener("click", () => { kind = b.getAttribute("data-kind"); paint(); }));
    sheet.querySelector("#gp-cancel").addEventListener("click", closeSheet);
    sheet.querySelector("#gp-save").addEventListener("click", () => {
      const name = sheet.querySelector("#gp-name").value.trim();
      if (!name) return;
      try {
        addProfile({
          name,
          kind,
          from: kind === "cursor" ? (sheet.querySelector("#gp-from").value || undefined) : undefined,
          identity: kind === "cursor" ? (sheet.querySelector("#gp-identity").value || undefined) : undefined,
        });
        closeSheet();
        location.reload();
      } catch (e) {
        alert("Could not create profile: " + e.message);
      }
    });
    paint();
  }

  function paintGrokDWordmark(node) {
    if (!node || node.querySelector(".gd-wordmark")) return;
    const t = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!t) return;
    const hit = /^(Grok Bot|grok"?D"?|grok D)$/i.test(t) || t.includes("Grok");
    if (!hit) return;
    node.textContent = "";
    const wrap = el("span", "");
    wrap.className = "gd-wordmark";
    wrap.setAttribute("aria-label", 'grok"D"');
    wrap.innerHTML = 'grok<span class="gd-qd">"D"</span>';
    node.appendChild(wrap);
  }

  function seatAbbrev(id) {
    const s = String(id || "");
    if (s === "local-d") return "D";
    const m = /^cursor-([a-z])$/i.exec(s);
    if (m) return m[1].toUpperCase();
    return (s.replace(/^cursor-/, "").replace(/^local-/, "").slice(0, 1) || "?").toUpperCase();
  }

  function seatSnapshot(id) {
    let ident = {};
    try { ident = require(path.join(ROOT, "account-identity.js")).readCache(id) || {}; }
    catch {}
    const signed = !!(ident.email || ident.authId || ident.kind === "logged-in" || id === "local-d");
    return {
      ident,
      signed,
      email: ident.email || "",
      photo: ident.pictureDataUrl || ident.pictureUrl || "",
    };
  }

  function stripGlasses(root) {
    ["gd-lens-L", "gd-lens-R", "gd-eye-glasses", "gd-model-glasses"].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.remove();
    });
    if (!root) return;
    if (root._gdGlassesRaf) {
      cancelAnimationFrame(root._gdGlassesRaf);
      root._gdGlassesRaf = null;
    }
    if (root._gdGlassesCycle) {
      clearInterval(root._gdGlassesCycle);
      root._gdGlassesCycle = null;
    }
  }

  function tintOf(tints, i) {
    const t = tints[i % tints.length];
    if (typeof t === "string") return { id: "flat", hex: t, glow: t + "88", special: "" };
    return t;
  }

  function applyBotTint(mark, tints) {
    if (!mark || !tints || !tints.length) return;
    if (mark._gdTint == null) mark._gdTint = 0;
    const t = tintOf(tints, mark._gdTint);
    mark.style.setProperty("--fg", t.hex);
    mark.classList.toggle("gd-bot-pearl", t.special === "pearl");
    mark.classList.toggle("gd-bot-blackhole", t.special === "blackhole");
    if (t.special !== "pearl" && t.special !== "blackhole") {
      mark.style.filter = "drop-shadow(5px 10px 14px rgba(0,0,0,0.5)) drop-shadow(0 0 12px " + (t.glow || t.hex) + ")";
    } else if (t.special === "blackhole") {
      mark.style.filter = "";
    }
    try {
      require(path.join(ROOT, "space-kernel.js")).setMood(t);
    } catch (_) {}
  }

  function dressGrokOrbit() {
    let logos;
    try { logos = require(path.join(ROOT, "provider-logos.js")); }
    catch { return; }
    const pack = logos.ORBITERS || [];
    const tints = logos.TINTS || ["#F4F1EA"];
    let kernel = null;
    try {
      kernel = require(path.join(ROOT, "space-kernel.js"));
      kernel.start(pack);
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[kernel] " + e + "\n"); } catch (_) {}
    }

    const leftover = document.getElementById("gd-orbit");
    if (leftover) leftover.remove();
    const mark = document.getElementById("gd-grok-hero")
      || (kernel && kernel.officialHeroMark && kernel.officialHeroMark());
    if (!mark) return;
    stripGlasses(mark);
    mark.style.overflow = "visible";
    applyBotTint(mark, tints);
    if (!mark._gdTintCycle) {
      mark._gdTintCycle = setInterval(() => {
        const live = document.getElementById("gd-grok-hero")
          || (kernel && kernel.officialHeroMark && kernel.officialHeroMark());
        if (!live) {
          clearInterval(mark._gdTintCycle);
          mark._gdTintCycle = null;
          return;
        }
        live._gdTint = (live._gdTint || 0) + 1;
        applyBotTint(live, tints);
      }, 4200);
    }
  }

  function applyCoverScheme(cover, mode) {
    const kernel = require(path.join(ROOT, "space-kernel.js"));
    const next = mode === "light" || mode === "dark" ? mode : "auto";
    const applied = kernel.setScheme(next === "auto" ? "" : next);
    if (cover && cover.dataset) {
      if (next === "auto") delete cover.dataset.gdScheme;
      else cover.dataset.gdScheme = next;
    }
    setUiPref("coverScheme", next);
    try { document.documentElement.style.colorScheme = applied.light ? "light" : "dark"; } catch {}
    try {
      const { nativeTheme } = require("electron");
      if (nativeTheme) nativeTheme.themeSource = applied.light ? "light" : "dark";
    } catch {}
    const btn = document.getElementById("gd-scheme-toggle");
    if (btn) {
      btn.textContent = applied.light ? "Dark" : "Light";
      btn.title = applied.light ? "Switch to dark sky" : "Switch to light sky";
      btn.setAttribute("aria-label", btn.title);
    }
    return applied;
  }

  function punchCoverSky(cover) {
    if (!cover || !cover.classList) return;
    if (!cover.classList.contains("sand-access-cover")
      && !cover.classList.contains("sand-onboarding__landing")) return;
    cover.style.background = "transparent";
    cover.style.backgroundImage = "none";
    const cr = cover.getBoundingClientRect();
    if (!cr.width || !cr.height) return;
    for (let i = 0; i < cover.children.length; i++) {
      const el = cover.children[i];
      if (el.id === "gd-kernel" || el.id === "gd-scheme-toggle") continue;
      const r = el.getBoundingClientRect();
      if (r.width >= cr.width * 0.72 && r.height >= cr.height * 0.5) {
        el.style.background = "transparent";
        el.style.backgroundImage = "none";
        el.style.backgroundColor = "transparent";
      }
    }
  }

  function mountCoverSchemeToggle(cover) {
    const host = document.body;
    if (!host) return;
    let btn = document.getElementById("gd-scheme-toggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "gd-scheme-toggle";
      btn.type = "button";
      host.appendChild(btn);
    } else if (btn.parentNode !== host) {
      host.appendChild(btn);
    }
    if (!btn._gdHooked) {
      btn._gdHooked = true;
      btn.addEventListener("click", () => {
        try {
          const kernel = require(path.join(ROOT, "space-kernel.js"));
          applyCoverScheme(cover, kernel.isLight() ? "dark" : "light");
        } catch (_) {}
      });
      const saved = uiPrefs().coverScheme;
      applyCoverScheme(cover, saved === "light" || saved === "dark" ? saved : "auto");
    } else {
      try {
        const kernel = require(path.join(ROOT, "space-kernel.js"));
        btn.textContent = kernel.isLight() ? "Dark" : "Light";
        btn.title = kernel.isLight() ? "Switch to dark sky" : "Switch to light sky";
      } catch (_) {}
    }
  }

  function enhanceCoverScreen() {
    const cover = document.querySelector(".sand-access-cover")
      || document.querySelector(".sand-onboarding__landing");
    if (isLocalSeat() || !cover || (cover.style && cover.style.display === "none") || skyCleared()) {
      hideSkySurfaces();
      const toggle = document.getElementById("gd-scheme-toggle");
      if (toggle && toggle.parentNode) toggle.remove();
      if (isLocalSeat()) {
        try { goChat(); } catch (_) {}
      }
      return;
    }
    try { punchCoverSky(cover); } catch (_) {}
    try { mountCoverSchemeToggle(cover); } catch (_) {}
    const h1 = cover.querySelector("#sand-access-cover-heading") || cover.querySelector("h1");
    if (h1) paintGrokDWordmark(h1);
    cover.querySelectorAll("h1, h2, .sand-access-cover-heading").forEach(paintGrokDWordmark);
    try { dressGrokOrbit(); } catch (_) {}
    cover.querySelectorAll("p, div, span, h2, h3").forEach((el) => {
      if (el.children.length === 0 && /^grok\s*"?D"?$/i.test(String(el.textContent || "").trim())) {
        paintGrokDWordmark(el);
      }
    });
    const nodes = cover.querySelectorAll("p, div, span, h2, h3");
    nodes.forEach((el) => {
      if (el.children.length === 0 && el.textContent) {
        const t = el.textContent.trim();
        if (t.includes("Your team of always-on Bots")) {
          el.textContent = "Multi-seat orchestration across Grok & non-Grok accounts in one deck.";
        } else if (t.includes("isn’t available on this account") || t.includes("isn't available on this account")) {
          el.textContent = "Seat not active — switch seat or connect a non-Grok account";
        } else if (t.includes("Check what this account needs")) {
          el.textContent = "Use the profile switcher to change seats or plug in another Cursor login.";
        }
      }
    });
    if (isLocalSeat()) {
      const signInCta = (el) => {
        if (!el || el.id === "gd-scheme-toggle") return false;
        const t = String(el.textContent || el.getAttribute("aria-label") || "");
        return /sign[\s-]*in|log[\s-]*in|check access|open clean browser/i.test(t);
      };
      cover.querySelectorAll("button, a, [role='button']").forEach((b) => {
        if (!signInCta(b)) return;
        b.style.display = "none";
        b.setAttribute("aria-hidden", "true");
        if ("disabled" in b) b.disabled = true;
      });
      cover.querySelectorAll("p, span, div, h2, h3").forEach((el) => {
        if (el.children.length) return;
        const t = String(el.textContent || "").trim();
        if (/sign in with a clean browser|sign in to continue|log in to continue|check what this account needs/i.test(t)) {
          el.textContent = "Local bots on this Mac — no Cursor sign-in.";
        }
      });
      if (!cover._gdLocalSignBlock) {
        cover._gdLocalSignBlock = true;
        cover.addEventListener("click", (e) => {
          const t = e.target && e.target.closest && e.target.closest("button, a, [role='button']");
          if (!t || t.id === "gd-scheme-toggle") return;
          const label = String(t.textContent || t.getAttribute("aria-label") || "");
          if (!/sign[\s-]*in|log[\s-]*in|check access|open clean browser/i.test(label)) return;
          e.preventDefault();
          e.stopPropagation();
          toast("Local D runs on this Mac — no Cursor sign-in");
        }, true);
      }
    }
    const btn = cover.querySelector(".sand-access-cover button") || cover.querySelector("button");
    if (btn && (btn.textContent.includes("Check Access") || btn.textContent.includes("Switch Seat"))) {
      btn.textContent = "Switch Seat / Add Non-Grok Seat";
      if (!btn._hookedSeat) {
        btn._hookedSeat = true;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openSheet();
        });
      }
    }
    try { mountSkyActions(); } catch (_) {}
  }

  function skyHost() {
    return document.querySelector(".sand-access-cover")
      || document.querySelector(".sand-onboarding__landing")
      || document.querySelector(".sand-onboarding")
      || document.querySelector(".sand-landing");
  }

  function skyCleared() {
    if (window.__gdSkyCleared) return true;
    return !!uiPrefs().skyCleared;
  }

  function hideSkySurfaces() {
    document.querySelectorAll(".sand-access-cover, .sand-onboarding__landing").forEach((n) => {
      n.style.display = "none";
      n.setAttribute("aria-hidden", "true");
    });
  }

  function reconnectBox() {
    try { require(path.join(ROOT, "create-bot-hook.js")).reconnect(); } catch {}
    try {
      const n = queuedNotice();
      const btn = n && n.querySelector && [...(n.querySelectorAll("button") || [])].find((b) => !/cancel/i.test(b.textContent || ""));
      if (btn && typeof btn.click === "function") btn.click();
    } catch {}
  }

  function chatLib() {
    try { return require(path.join(ROOT, "enter-chat.js")); }
    catch { return null; }
  }

  function goChat() {
    if (window.__gdChatBusy) return window.__gdChatBusy;
    const lib = chatLib();
    if (!lib) return Promise.resolve({ action: "no-lib", ok: false });
    window.__gdChatBusy = (async () => {
      const have = lib.chatSurface(document);
      if (have.ok) {
        hideSkySurfaces();
        reconnectBox();
        return { action: "already", ok: true, composer: have.composer, agent: have.agent, thread: have.thread };
      }
      let createNamed = null;
      try {
        const hook = require(path.join(ROOT, "create-bot-hook.js"));
        if (hook && hook.createNamed) createNamed = (name) => hook.createNamed(name);
      } catch {}
      try { await wrapPageAuth(); } catch {}
      let last = { action: "none", ok: false };
      for (let i = 0; i < 10; i++) {
        const now = lib.chatSurface(document);
        if (now.ok) {
          hideSkySurfaces();
          reconnectBox();
          return { action: last.action === "none" ? "already" : last.action, ok: true, composer: now.composer, agent: now.agent, thread: now.thread };
        }
        last = lib.enterChat(document, {
          createNamed,
          untilOpen: false,
          onOpen() { hideSkySurfaces(); },
        });
        if (last && last.ok) {
          hideSkySurfaces();
          reconnectBox();
          return last;
        }
        if (!last || last.action === "no-target" || last.action === "create-failed") break;
        await new Promise((r) => setTimeout(r, 450));
      }
      const end = lib.chatSurface(document);
      if (end.ok) {
        hideSkySurfaces();
        reconnectBox();
        return { action: last.action, ok: true, composer: end.composer, agent: end.agent, thread: end.thread };
      }
      return { action: last.action, ok: false, composer: end.composer, agent: end.agent, thread: end.thread };
    })().finally(() => { window.__gdChatBusy = null; });
    return window.__gdChatBusy;
  }

  async function dismissSky() {
    window.__gdSkyCleared = true;
    setUiPref("skyCleared", true);
    const bar = document.getElementById("gd-sky-actions");
    if (bar) {
      try { require(path.join(ROOT, "liquid-glass-btn.js")).stop(); } catch (_) {}
      bar.classList.add("is-out");
      setTimeout(() => { if (bar.parentNode) bar.remove(); }, 220);
    }
    const opened = await goChat();
    if (opened && opened.ok) hideSkySurfaces();
    return opened;
  }

  function mountSkyActions() {
    if (isLocalSeat() || skyCleared()) {
      window.__gdSkyCleared = true;
      setUiPref("skyCleared", true);
      hideSkySurfaces();
      const have = chatLib() && chatLib().chatSurface(document);
      if (have && have.ok) hideSkySurfaces();
      else goChat();
      const leftover = document.getElementById("gd-sky-actions");
      if (leftover) leftover.remove();
      try { require(path.join(ROOT, "liquid-glass-btn.js")).stop(); } catch (_) {}
      return;
    }
    if (!skyHost()) {
      const leftover = document.getElementById("gd-sky-actions");
      if (leftover) leftover.remove();
      try { require(path.join(ROOT, "liquid-glass-btn.js")).stop(); } catch (_) {}
      return;
    }
    if (document.getElementById("gd-sky-actions")) return;
    const bar = document.createElement("div");
    bar.id = "gd-sky-actions";
    bar.innerHTML = `
      <button type="button" class="gd-lg-btn" id="gd-sky-continue">Continue</button>
      <button type="button" class="gd-lg-btn" id="gd-sky-local">This Mac only</button>
      <button type="button" class="gd-lg-btn" id="gd-sky-cursor">Set up with Cursor</button>
    `;
    document.body.appendChild(bar);
    bar.querySelector("#gd-sky-continue").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissSky();
    });
    bar.querySelector("#gd-sky-local").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeId() !== "local-d") {
        window.__gdSkyCleared = true;
        setUiPref("skyCleared", true);
        toast("Switching to Local D…");
        switchTo("local-d");
        return;
      }
      dismissSky();
    });
    bar.querySelector("#gd-sky-cursor").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissSky();
      startOnboarding(true);
    });
    try { require(path.join(ROOT, "liquid-glass-btn.js")).start(bar); } catch (_) {}
  }

  async function keepCursorComputer() {
    if (mode() !== "cursor") return;
    if (window.__gdEnsuringBox) return;
    const lib = coverLib();
    if (!lib) return;
    dressComputerLost();
    const overlay = lib.overlayShowing(document);
    const healthy = hasHealthyComputer();
    const st = computerKeepState();
    if (healthy) {
      snapshotActiveBox();
      st.retries = 0;
      return;
    }
    if (botsPaused(st.seat)) return;
    const now = Date.now();
    if (now - st.last < 8000) return;
    st.last = now;
    const hasRemote = hasRemoteComputer();
    const action = lib.pickAction({
      overlay: overlay,
      healthy: false,
      hasRemote,
      retries: st.retries,
      recovered: st.recovered,
    });
    st.retries += 1;
    try {
      fs.appendFileSync("/tmp/grokbot-renderer.log",
        "[computer-keep] " + JSON.stringify({
          action, overlay, retries: st.retries, seat: st.seat, hasRemote,
        }) + "\n");
    } catch (_) {}
    if (action === "retry" && hasRemote) {
      try { await pageCall("return await window.desktop.forceGatewayReconnect()"); } catch (_) {}
      const btn = lib.findRetry(document);
      if (btn && typeof btn.click === "function") btn.click();
    }
    if (hasHealthyComputer()) snapshotActiveBox();
  }

  function restoreGorgeousUi() {
    try {
      enhanceCoverScreen();
      dressComputerLost();
      const bar = document.getElementById("grok-profile-bar");
      if (bar) bar.remove();
      const lava = document.getElementById("pure-lava-orbs-root");
      if (lava) {
        if (document.querySelector(".sand-access-cover")) lava.style.display = "none";
        else if (lava.style.display === "none") lava.style.display = "";
      }
      const toolbar = document.getElementById("grok-top-toolbar-root");
      if (toolbar && toolbar.style.display === "none") toolbar.style.display = "";
      paintLoginChip();
      wirePlasmaSeatOrb();
      try { mountSkyActions(); } catch (_) {}
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[restore-ui] " + e + "\n"); } catch (_) {}
    }
  }

  function seatHoverText(pid, q) {
    let quotaLib = null;
    try { quotaLib = require(path.join(ROOT, "seat-quota.js")); } catch {}
    const pausedAt = (() => {
      try { return require(path.join(ROOT, "bot-pause.js")).pausedAt(pid); }
      catch { return null; }
    })();
    if (quotaLib && quotaLib.hoverText) return quotaLib.hoverText({ quota: q, stoppedAt: pausedAt });
    return q && q.percentUsed != null ? Math.round(q.percentUsed) + "% included quota used" : "Cursor quota unavailable";
  }

  let _foBusy = false;
  async function considerFallOver(quotas, activeId) {
    if (_foBusy) return;
    const fo = foMod();
    if (!fo || !fo.loadConfig) return;
    const cfg = fo.loadConfig();
    if (!cfg.enabled) return;
    let pausedIds = {};
    try {
      for (const id of require(path.join(ROOT, "bot-pause.js")).pausedSeats()) pausedIds[id] = true;
    } catch {}
    const profiles = (load().profiles || []);
    const active = profiles.find((p) => p.id === activeId) || {};
    const decision = fo.evaluate({
      profiles,
      activeId,
      payingProfileId: cfg.payingProfileId || activeId,
      rails: active.kind === "local" ? "local" : "cursor",
      quotas,
      config: cfg,
      pausedIds,
      now: Date.now(),
    });
    if (!decision) return;
    _foBusy = true;
    try {
      let agents = [];
      if (active.kind === "local") {
        try {
          const raw = await new Promise((res) => {
            const req = http.request({
              hostname: "127.0.0.1",
              port: 1337,
              path: "/api/listAgents",
              method: "POST",
              headers: { "content-type": "application/json", authorization: AUTH },
              timeout: 4000,
            }, (r) => {
              const c = [];
              r.on("data", (d) => c.push(d));
              r.on("end", () => {
                try { res(JSON.parse(Buffer.concat(c).toString("utf8"))); } catch { res([]); }
              });
            });
            req.on("error", () => res([]));
            req.write("{}");
            req.end();
          });
          agents = Array.isArray(raw) ? raw : [];
        } catch {}
      }
      const focus = agents.find((a) => a && a.isRunning) || agents[0] || null;
      let lastUser = "";
      try { lastUser = String(window.__grokdLastPrompt || ""); } catch {}
      if (!lastUser && focus) lastUser = String(focus.lastMessagePreview || focus.lastUserMessage || "");
      if (!lastUser) {
        try {
          const box = document.querySelector("textarea,[contenteditable='true']");
          lastUser = String((box && (box.value || box.innerText)) || "").trim();
        } catch {}
      }
      lastUser = lastUser.slice(0, 4000);
      let excerpts = [];
      if (active.kind === "local" && focus && focus.id) {
        try {
          const shim = require(path.join(ROOT, "gateway-shim.js"));
          const raw = shim.readEntries(focus.id);
          excerpts = String(raw || "").split("\n").filter(Boolean).slice(0, 20);
        } catch {}
      }
      const { act } = require(path.join(ROOT, "failover-act.js"));
      const sendPrompt = (id, text) => new Promise((resolve) => {
        try {
          const payload = JSON.stringify({ agentId: id, prompt: String(text || ""), awaitTurn: false });
          const req = http.request({
            hostname: "127.0.0.1",
            port: 1337,
            path: "/api/sendPrompt",
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: AUTH,
              "content-length": Buffer.byteLength(payload),
            },
            timeout: 8000,
          }, (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          });
          req.on("error", () => resolve(false));
          req.write(payload);
          req.end();
        } catch {
          resolve(false);
        }
      });
      const r = await act(decision, {
        relaunch: decision.action === "cursor" || decision.action === "local-chief" || decision.action === "local-clone",
        lastUser,
        excerpts,
        sourceAgentId: focus && focus.id,
        sourceName: focus && focus.name,
        agents,
        sendPrompt,
      });
      if (r && r.ok) {
        const dest = r.to ? (" → " + profileDisplayName(r.to)) : "";
        const actionLabel = r.action === "cursor" ? "Account rotation" : r.action === "local-chief" ? "Chief handoff" : r.action === "local-clone" ? "Continue locally" : (r.action || "Triggered");
        toast("Failover · " + actionLabel + dest);
      }
    } catch (e) {
      logRendererError("failover-act", e);
      toast("Failover could not complete. Check logs.");
    } finally {
      _foBusy = false;
    }
  }

  function applyQuotaDom(pid, q) {
    const known = q && q.percentUsed != null;
    const w = known ? Math.max(0, Math.min(100, Number(q.percentUsed))) : 0;
    const col = !known ? "var(--gd-text-dim)" : w >= 90 ? "#fca5a5" : w >= 70 ? "#fbbf24" : "#34d399";
    const label = known ? Math.round(w) + "%" : "—";
    const tip = seatHoverText(pid, q);
    document.querySelectorAll('[data-quota-id="' + pid + '"]').forEach((n) => {
      const fill = n.querySelector(".gd-quota-fill");
      const num = n.querySelector(".gd-quota-n");
      if (fill) {
        fill.style.width = w + "%";
        fill.style.background = col;
      }
      if (num) {
        num.textContent = label;
        num.style.color = col;
      }
      n.title = tip;
      n.setAttribute("data-tip", tip);
    });
    document.querySelectorAll('[data-seat-hover="' + pid + '"]').forEach((n) => {
      n.title = tip;
      n.setAttribute("data-tip", tip);
    });
  }

  async function refreshSeatQuotaBars(activeId) {
    let quota;
    try { quota = require(path.join(ROOT, "seat-quota.js")); }
    catch { return; }
    let weekly = null;
    try {
      weekly = await pageCall("return await window.desktop.cursorAccount.getWeeklyUsage()");
      const v = weekly && weekly.value;
      if (v && v.percentUsed != null && activeId) {
        const seats = quota.readCache();
        const incoming = {
          percentUsed: Number(v.percentUsed) <= 1.0001 ? Number(v.percentUsed) * 100 : Number(v.percentUsed),
          nextResetMs: v.nextResetMs || v.nextResetTimestampUtc || null,
          hasLimit: !!v.hasNonZeroIncludedLimit,
          at: Date.now(),
        };
        const stamped = quota.remember ? quota.remember(activeId, incoming) : incoming;
        applyQuotaDom(activeId, stamped);
      }
    } catch {}
    let safeStorage = null;
    try { safeStorage = require("electron").safeStorage; } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[quota] electron " + e + "\n"); } catch (_) {}
    }
    try {
      fs.appendFileSync("/tmp/grokbot-renderer.log", "[quota] weekly=" + JSON.stringify(weekly && weekly.value).slice(0, 180) + " ss=" + !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) + "\n");
    } catch {}
    try {
      const map = await quota.refreshAll(safeStorage);
      Object.keys(map || {}).forEach((pid) => applyQuotaDom(pid, map[pid]));
      (quota.profiles() || []).forEach((p) => {
        if (p.kind === "cursor" && !(map && map[p.id])) applyQuotaDom(p.id, null);
      });
      considerFallOver(map || {}, activeId).catch(() => {});
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[quota] refresh " + e + "\n"); } catch (_) {}
    }
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!document.getElementById("grok-seat-action-menu")) return;
      const map = quota.readCache();
      Object.keys(map || {}).forEach((pid) => applyQuotaDom(pid, map[pid]));
    }
  }

  function bindTimeTips(root) {
    if (!root) return;
    let tip = document.getElementById("gd-time-tip");
    if (!tip) {
      tip = el("div");
      tip.id = "gd-time-tip";
      document.body.appendChild(tip);
    }
    const show = (ev) => {
      const host = ev.currentTarget;
      const text = host.getAttribute("data-tip") || host.getAttribute("title") || "";
      if (!text) return;
      tip.textContent = text.replace(/&#10;/g, "\n");
      const r = host.getBoundingClientRect();
      const left = Math.min(window.innerWidth - 252, Math.max(10, r.left));
      const top = r.top > 90 ? r.top - 8 : r.bottom + 8;
      tip.style.left = left + "px";
      tip.style.top = (r.top > 90 ? top - tip.offsetHeight : top) + "px";
      if (r.top > 90) tip.style.transform = "translateY(-100%)";
      else tip.style.transform = "translateY(0)";
      tip.classList.add("is-on");
    };
    const hide = () => tip.classList.remove("is-on");
    root.querySelectorAll("[data-tip], .gd-quota, [data-seat-hover]").forEach((n) => {
      n.addEventListener("mouseenter", show);
      n.addEventListener("mouseleave", hide);
    });
  }

  function closeSeatActionMenu() {
    const m = document.getElementById("grok-seat-action-menu");
    if (!m) return;
    if (m._gdDismiss) {
      document.removeEventListener("click", m._gdDismiss, true);
      m._gdDismiss = null;
    }
    m.remove();
    const tip = document.getElementById("gd-time-tip");
    if (tip) tip.classList.remove("is-on");
  }

  function hidePackedBubbles() {
    document.querySelectorAll(".ghostly-liquid-glass-bubble").forEach((b) => {
      if (b.id === "grok-seat-action-menu" || b.id === "gd-cursor-model-menu") return;
      b.style.display = "none";
    });
    try { require(path.join(ROOT, "cursor-model-bubble.js")).close(); } catch (_) {}
  }

  function positionSeatBubble(menu) {
    if (!menu) return;
    const w = 320;
    const orb = document.querySelector(".pure-plasma-orb-1");
    const lavaVisible = !!(orb && orb.offsetWidth > 0);
    const anchor = lavaVisible ? orb : document.getElementById("grok-d-login-chip");
    const h = Math.min(window.innerHeight * 0.86, menu.offsetHeight || 480);
    if (!anchor || !anchor.offsetWidth) {
      menu.style.left = "18px";
      menu.style.bottom = "76px";
      menu.style.top = "auto";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(10, rect.top - h - 10);
    let left = rect.left - 8;
    if (left + w > window.innerWidth - 12) left = Math.max(10, window.innerWidth - w - 12);
    if (left < 10) left = 10;
    menu.style.top = Math.round(top) + "px";
    menu.style.left = Math.round(left) + "px";
    menu.style.bottom = "auto";
  }

  function bindSeatMenuDismiss(menu) {
    const onDoc = (e) => {
      if (!menu.isConnected) {
        document.removeEventListener("click", onDoc, true);
        return;
      }
      const t = e.target;
      if (menu.contains(t)) return;
      if (t && t.closest && (t.closest(".pure-plasma-orb-1") || t.closest("#grok-d-login-chip"))) return;
      closeSeatActionMenu();
    };
    menu._gdDismiss = onDoc;
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
  }

  // The left orb is the seat orb, so when the user asks for it, it wears the
  // active seat's own face: their account photo, or the seat's mascot if that
  // account has no photo. Switching seats re-paints it, because the orb is
  // meant to answer "who am I signed in as" at a glance.
  function seatOrbFace(id) {
    const snap = seatSnapshot(id);
    const photo = snap.photo;
    if (photo && (String(photo).indexOf("data:image") === 0 || /^https:\/\//i.test(photo))) {
      return { kind: "photo", src: photo };
    }
    const profile = (load().profiles || []).find((p) => p.id === id);
    const mascot = getProfileMascotSvg(profile, id);
    if (mascot) return { kind: "mascot", svg: mascot };
    return null;
  }

  function clearSeatOrb(orb) {
    orb.querySelectorAll(".gd-orb-photo").forEach((n) => n.remove());
    orb.querySelectorAll(".gd-orb-hidden").forEach((n) => n.classList.remove("gd-orb-hidden"));
    orb.classList.remove("gd-orb-avatar");
  }

  function paintSeatOrb() {
    const orb = document.querySelector(".pure-plasma-orb-1");
    if (!orb) return;
    const id = activeId();
    const face = orbAvatarOn() ? seatOrbFace(id) : null;
    const key = face ? id + "|" + face.kind + "|" + String(face.src || face.svg).slice(-40) : "";
    if (orb._gdOrbKey === key) return;
    orb._gdOrbKey = key;
    clearSeatOrb(orb);
    if (!face) return;
    // the packed face and its gradients step aside; the rim clones children, so
    // marking them keeps the reflection in step with what the orb now shows
    Array.from(orb.children).forEach((n) => {
      if (n.getAttribute && n.getAttribute("data-gd-rim") != null) return;
      if (n.classList) n.classList.add("gd-orb-hidden");
    });
    const slot = document.createElement("span");
    slot.className = "gd-orb-photo";
    if (face.kind === "photo") {
      const img = document.createElement("img");
      img.src = face.src;
      img.alt = "";
      img.draggable = false;
      slot.appendChild(img);
    } else {
      slot.innerHTML = face.svg;
    }
    orb.appendChild(slot);
    orb.classList.add("gd-orb-avatar");
  }

  // Pause the plasma and the selector falls back to the plain orbs; press again
  // and the rim, the slosh and the glow come back. The button rides under the
  // orbs, which is where the thing it changes lives.
  const PLAY_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><polygon points="8,5 19,12 8,19"/></svg>`;
  const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.2"/></svg>`;

  function applyOrbStyle() {
    const classic = orbStyle() === "classic";
    document.documentElement.classList.toggle("gd-orbs-classic", classic);
    return classic;
  }

  function positionOrbStyleBtn(btn) {
    const wrap = document.getElementById("pure-lava-orbs-root");
    const host = wrap && wrap.offsetWidth ? wrap : document.querySelector(".pure-plasma-orb-1");
    if (!host || !host.offsetWidth) { btn.style.display = "none"; return; }
    const r = host.getBoundingClientRect();
    btn.style.display = "flex";
    btn.style.top = Math.round(r.bottom - 4) + "px";
    btn.style.left = Math.round(r.left + r.width / 2 - 11) + "px";
  }

  function paintOrbStyleBtn() {
    const classic = applyOrbStyle();
    const lavaHidden = !!document.querySelector(".sand-access-cover");
    let btn = document.getElementById("gd-orb-style");
    if (lavaHidden) {
      if (btn) btn.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "gd-orb-style";
      document.body.appendChild(btn);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const next = orbStyle() === "classic" ? "plasma" : "classic";
        setUiPref("orbStyle", next);
        paintOrbStyleBtn();
        try {
          const rim = require(path.join(ROOT, "bubble-rim.js"));
          if (next === "classic") rim.stop(); else rim.start();
        } catch (_) {}
        toast(next === "classic" ? "Classic orbs — plasma paused" : "Plasma orbs");
      }, true);
    }
    const label = classic ? "Resume plasma" : "Pause plasma (classic orbs)";
    btn.innerHTML = classic ? PLAY_SVG : PAUSE_SVG;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", classic ? "true" : "false");
    positionOrbStyleBtn(btn);
  }

  function wirePlasmaSeatOrb() {
    const lava = document.getElementById("pure-lava-orbs-root");
    if (lava) {
      if (document.querySelector(".sand-access-cover")) lava.style.display = "none";
      else if (lava.style.display === "none") lava.style.display = "";
    }
    const left = document.querySelector(".pure-plasma-orb-1");
    if (left && !left._gdSeatHook) {
      left._gdSeatHook = true;
      left.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        hidePackedBubbles();
        const existing = document.getElementById("grok-seat-action-menu");
        if (existing) {
          closeSeatActionMenu();
          return;
        }
        const sid = activeId();
        const curProfile = (load().profiles || []).find((p) => p.id === sid);
        let st = diskIdentity();
        let fmt = { title: curProfile ? curProfile.name : "Seat" };
        try {
          const acc = require(path.join(ROOT, "account-identity.js"));
          fmt = acc.formatCursorAccount(st, sid);
          fmt.title = (curProfile ? curProfile.name : "Seat") + " · " + (fmt.provider || "Cursor");
        } catch (_) {}
        openSeatActionMenu(st, fmt, curProfile, sid);
      }, true);
    }
    const right = document.querySelector(".pure-plasma-orb-2");
    if (right && !right._gdSeatClose) {
      right._gdSeatClose = true;
      right.addEventListener("click", () => closeSeatActionMenu(), true);
    }
    try { paintSeatOrb(); } catch (_) {}
    try { paintOrbStyleBtn(); } catch (_) {}
    try { require(path.join(ROOT, "cursor-model-bubble.js")).start(); } catch (_) {}
  }

  function ensureQuotaCss() {
    if (document.getElementById("gd-quota-css")) return;
    const st = document.createElement("style");
    st.id = "gd-quota-css";
    st.textContent = `
      .gd-quota { display:flex; align-items:center; gap:5px; width:100%; margin-top:3px; }
      .gd-quota-track { flex:1; height:4px; border-radius:99px; background:rgba(255,255,255,0.1); overflow:hidden; min-width:28px; }
      .gd-quota-fill { display:block; height:100%; border-radius:99px; transition:width .25s ease; }
      .gd-quota-n { font:700 9px/1 -apple-system,BlinkMacSystemFont,sans-serif; min-width:22px; text-align:right; letter-spacing:0.02em; }

      .gd-idcard {
        position:relative; margin-bottom:12px; padding:2px 0; border-radius:16px;
        background:radial-gradient(120% 140% at 22% 0%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.028) 42%, rgba(10,10,18,0.55) 100%);
        border:1px solid rgba(255,255,255,0.11);
        box-shadow:inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -10px 18px rgba(0,0,0,0.34), 0 6px 18px rgba(0,0,0,0.4);
        overflow:hidden;
      }
      .gd-idrow {
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        padding:9px 13px;
      }
      .gd-idrow + .gd-idrow { box-shadow:inset 0 1px 0 rgba(255,255,255,0.055); }
      .gd-idk {
        font:600 9.5px/1 -apple-system,BlinkMacSystemFont,sans-serif;
        text-transform:uppercase; letter-spacing:0.07em; color:rgba(255,255,255,0.42);
        white-space:nowrap;
      }
      .gd-idv {
        font:650 11.5px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
        color:var(--gd-text); text-align:right; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; max-width:200px;
      }
      .gd-idv.is-dim { color:rgba(255,255,255,0.45); font-weight:500; }
      .gd-idpill {
        display:inline-flex; align-items:center; gap:6px; padding:3px 9px 3px 7px;
        border-radius:99px; font:700 10.5px/1 -apple-system,BlinkMacSystemFont,sans-serif;
        letter-spacing:0.01em; white-space:nowrap;
      }
      .gd-idpill i { width:6px; height:6px; border-radius:50%; display:block; flex:0 0 6px; }
      .gd-idpill.is-on { color:#6ee7b7; background:rgba(52,211,153,0.13); border:1px solid rgba(52,211,153,0.3); }
      .gd-idpill.is-on i { background:#34d399; box-shadow:0 0 7px rgba(52,211,153,0.95); }
      .gd-idpill.is-wait { color:#fcd34d; background:rgba(251,191,36,0.13); border:1px solid rgba(251,191,36,0.3); }
      .gd-idpill.is-wait i { background:#fbbf24; box-shadow:0 0 7px rgba(251,191,36,0.9); }
      .gd-idpill.is-off { color:rgba(255,255,255,0.55); background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.13); }
      .gd-idpill.is-off i { background:rgba(255,255,255,0.4); }
      .gd-idseat {
        font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:0.08em;
        color:var(--gd-text); padding:4px 8px; border-radius:8px;
        background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12);
      }
      .gd-idcard {
        overflow:hidden;
      }
      #grok-idcard {
        max-height:220px;
        transition:max-height .3s cubic-bezier(0.4,0,0.2,1), opacity .2s ease,
                   margin-bottom .3s cubic-bezier(0.4,0,0.2,1), border-color .2s ease;
      }
      #grok-idcard.is-collapsed {
        max-height:0; opacity:0; margin-bottom:0; padding:0;
        border-width:0; pointer-events:none;
      }
      .gd-idtoggle {
        background:none; border:none; cursor:pointer; color:var(--gd-text-dim);
        padding:2px 4px; display:flex; align-items:center;
        transition:transform .26s cubic-bezier(0.4,0,0.2,1), color .15s ease;
      }
      .gd-idtoggle:hover { color:var(--gd-text); }
      .gd-idtoggle.is-collapsed { transform:rotate(-90deg); }
      .gd-sw {
        position:relative; width:36px; height:20px; flex:0 0 36px; border-radius:99px;
        background:rgba(255,255,255,0.14); border:1px solid rgba(255,255,255,0.12);
        cursor:pointer; padding:0; transition:background .18s ease;
      }
      .gd-sw i {
        position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%;
        background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.35); transition:transform .18s ease;
      }
      .gd-sw.is-on { background:#34d399; border-color:rgba(52,211,153,0.5); }
      .gd-sw.is-on i { transform:translateX(16px); }
      .gd-sw.is-stop.is-on { background:#f87171; border-color:rgba(248,113,113,0.55); }
      .gd-setrow {
        display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
        padding:10px 12px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.055);
        cursor:pointer; user-select:none;
      }
      .gd-setrow:first-child { box-shadow:none; }
      .gd-setrow:hover { background:rgba(255,255,255,0.04); }
      .gd-setrow .gd-sw { pointer-events:none; }
      .gd-setcopy { min-width:0; flex:1; }
      .gd-setcopy b { display:block; font:650 12px/1.25 -apple-system,BlinkMacSystemFont,sans-serif; }
      .gd-setcopy p { margin:4px 0 0; font:500 10.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif; color:rgba(255,255,255,0.52); }
      .gd-fo-ico {
        flex:0 0 28px; width:28px; height:28px; border-radius:8px;
        display:flex; align-items:center; justify-content:center;
        background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
        color:rgba(255,255,255,0.82);
      }
      .gd-seatstop {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:8px 12px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.055);
      }
      #gd-time-tip {
        position:fixed; z-index:1000006; max-width:240px; padding:8px 10px; border-radius:10px;
        background:rgba(14,14,22,0.94); border:1px solid rgba(255,255,255,0.16);
        color:#fff; font:600 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
        white-space:pre-line; pointer-events:none; box-shadow:0 8px 24px rgba(0,0,0,0.4);
        opacity:0; transform:translateY(4px); transition:opacity .12s, transform .12s;
      }
      #gd-time-tip.is-on { opacity:1; transform:translateY(0); }

      .gd-railwrap { display:flex; align-items:stretch; gap:8px; margin-bottom:12px; }
      .gd-rail { display:flex; flex-wrap:wrap; gap:6px; flex:1 1 auto; min-width:0; }
      .gd-railacts {
        display:flex; align-items:center; gap:5px; flex:0 0 auto;
        padding-left:8px; border-left:1px solid rgba(255,255,255,0.09);
      }
      .gd-iconbtn {
        width:30px; height:30px; border-radius:50%; padding:0; cursor:pointer;
        display:flex; align-items:center; justify-content:center; font:inherit;
        background:radial-gradient(120% 120% at 32% 22%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.03) 55%, rgba(10,10,18,0.62) 100%);
        border:1px solid rgba(255,255,255,0.14); color:var(--gd-text);
        box-shadow:inset 0 1px 0 rgba(255,255,255,0.2), 0 3px 9px rgba(0,0,0,0.45);
        transition:transform .18s cubic-bezier(0.34,1.56,0.64,1), border-color .18s ease, box-shadow .18s ease;
      }
      .gd-iconbtn:hover { transform:translateY(-1px) scale(1.09); border-color:rgba(255,255,255,0.36); }
      .gd-iconbtn:active { transform:scale(0.93); }
      .gd-iconbtn.is-primary {
        background:linear-gradient(150deg, #ffffff 0%, #d8d8e2 100%);
        color:#0a0a12; border-color:rgba(255,255,255,0.65);
        box-shadow:inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 12px rgba(0,0,0,0.5);
      }

      @media (prefers-color-scheme: light) {
        .gd-idcard {
          background:linear-gradient(168deg, rgba(255,255,255,0.96) 0%, rgba(244,244,248,0.92) 100%);
          border-color:rgba(0,0,0,0.09);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.95), 0 6px 16px rgba(0,0,0,0.07);
        }
        .gd-idrow + .gd-idrow { box-shadow:inset 0 1px 0 rgba(0,0,0,0.055); }
        .gd-idk { color:rgba(0,0,0,0.46); }
        .gd-idv.is-dim { color:rgba(0,0,0,0.4); }
        .gd-idseat {
          background:rgba(0,0,0,0.045); border-color:rgba(0,0,0,0.12);
        }
        .gd-idpill.is-on {
          color:#047857; background:rgba(16,185,129,0.12); border-color:rgba(16,185,129,0.34);
        }
        .gd-idpill.is-on i { background:#059669; box-shadow:0 0 6px rgba(5,150,105,0.6); }
        .gd-idpill.is-wait {
          color:#b45309; background:rgba(245,158,11,0.13); border-color:rgba(245,158,11,0.34);
        }
        .gd-idpill.is-wait i { background:#d97706; box-shadow:0 0 6px rgba(217,119,6,0.6); }
        .gd-idpill.is-off {
          color:rgba(0,0,0,0.55); background:rgba(0,0,0,0.05); border-color:rgba(0,0,0,0.12);
        }
        .gd-idpill.is-off i { background:rgba(0,0,0,0.35); }
        .gd-railacts { border-left-color:rgba(0,0,0,0.09); }
        .gd-iconbtn {
          background:linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(238,238,244,0.95) 100%);
          border-color:rgba(0,0,0,0.12); color:#18181b;
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 7px rgba(0,0,0,0.12);
        }
        .gd-iconbtn:hover { border-color:rgba(0,0,0,0.26); }
        .gd-iconbtn.is-primary {
          background:linear-gradient(150deg, #18181b 0%, #3a3a46 100%);
          color:#ffffff; border-color:rgba(0,0,0,0.4);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.22), 0 3px 10px rgba(0,0,0,0.24);
        }
        .gd-quota-track { background:rgba(0,0,0,0.1); }
      }
    `;
    document.head.appendChild(st);
  }

  function ensureSeatBubbleCss() {
    if (document.getElementById("gd-seat-bubble-css")) return;
    const st = document.createElement("style");
    st.id = "gd-seat-bubble-css";
    st.textContent = `
      #grok-seat-action-menu.gd-seat-bubble {
        position: fixed;
        z-index: 1000003;
        width: 320px;
        max-width: min(320px, calc(100vw - 24px));
        max-height: min(86vh, 680px);
        display: flex;
        flex-direction: column;
        padding: 10px 10px 8px;
        box-sizing: border-box;
        overflow: hidden;
        font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        color: #e8e8ed;
        background: rgba(18, 18, 22, 0.94);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px !important;
        animation: none !important;
        transform: none !important;
        box-shadow: 0 12px 32px rgba(0,0,0,0.4);
        user-select: none;
        align-items: stretch !important;
      }
      #grok-seat-action-menu.gd-seat-bubble .gd-seat-scroll {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: none;
        display: flex;
        flex-direction: column;
      }
      #grok-seat-action-menu.gd-seat-bubble .gd-seat-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
      #grok-seat-action-menu.gd-seat-bubble .gd-idcard,
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-tray { width: 100%; box-sizing: border-box; }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border-radius: 8px;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        cursor: pointer;
        color: inherit !important;
        font: inherit;
        text-align: left;
        box-sizing: border-box;
        margin: 0;
        transform: none !important;
        animation: none !important;
      }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item:hover {
        background: rgba(255,255,255,0.06) !important;
        transform: none !important;
        box-shadow: none !important;
      }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item.is-active-model {
        background: rgba(255,255,255,0.08) !important;
        box-shadow: none !important;
      }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item.is-stopped { opacity: 0.55; }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item .gd-sw {
        pointer-events: auto;
        margin-left: 4px;
        flex: 0 0 36px;
      }
      #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item.is-danger { color: #f0a8a8 !important; }
      #grok-seat-action-menu.gd-seat-bubble .active-provider-hero-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 2px 8px;
        margin-bottom: 4px;
        border: 0;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        width: 100%;
        box-sizing: border-box;
      }
      #grok-seat-action-menu.gd-seat-bubble .gd-seat-more {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        margin-top: 6px;
        padding: 6px 8px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: 600 11px/1.3 inherit;
        cursor: pointer;
        opacity: 0.65;
      }
      #grok-seat-action-menu.gd-seat-bubble .gd-seat-more:hover { opacity: 1; background: rgba(255,255,255,0.05); }
      #grok-seat-action-menu.gd-seat-bubble .gd-railacts { justify-content: flex-start; border: none; padding: 4px 4px 8px; gap: 6px; }
      @media (prefers-color-scheme: light) {
        #grok-seat-action-menu.gd-seat-bubble {
          background: rgba(250, 250, 252, 0.96);
          color: #1c1c20;
          border-color: rgba(0,0,0,0.1);
          box-shadow: 0 12px 32px rgba(0,0,0,0.12);
        }
        #grok-seat-action-menu.gd-seat-bubble .whimsical-model-item.is-active-model {
          background: rgba(0,0,0,0.05) !important;
        }
      }
    `;
    document.head.appendChild(st);
  }

  function openSeatActionMenu(st, fmt, profile, id) {
    ensureStyles();
    ensureQuotaCss();
    ensureSeatBubbleCss();
    closeSeatActionMenu();
    hidePackedBubbles();
    const menu = document.createElement("div");
    menu.id = "grok-seat-action-menu";
    menu.className = "no-scrollbar gd-seat-bubble";

    const allProfiles = load().profiles || [];
    let idCollapsed = true;
    try { idCollapsed = localStorage.getItem("gd-idcard-collapsed") !== "0"; } catch (_) {}
    const signedNow = !!(fmt.signedIn || fmt.email || (st && (st.kind === "logged-in" || st.email)));
    const statusDot = signedNow ? "background:var(--gd-green)" : (st && st.kind === "logging-in" ? "background:var(--gd-amber)" : "background:var(--gd-text-dim)");
    const statusText = signedNow ? "Connected" : (st && st.kind === "logging-in" ? "Signing in…" : "Signed out");

    const seatFace = (p, snap, size) => {
      const px = size || 28;
      const letter = escHtml(seatAbbrev(p.id));
      const mascot = getProfileMascotSvg(p, p.id);
      const photo = sanitizeImageUrl(snap.photo);
      const box = `width:${px}px;height:${px}px;border-radius:50%;overflow:hidden;flex:0 0 ${px}px;display:flex;align-items:center;justify-content:center`;
      if (photo) {
        return `<span class="gd-seat-face" style="${box}"><img src="${escAttr(photo)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`;
      }
      if (mascot) {
        return `<span class="gd-seat-face" style="${box}">${mascot}</span>`;
      }
      return `<span class="gd-seat-face" style="${box};background:${escAttr(p.color || "#52525b")};color:#fff;font:700 ${Math.max(10, px * 0.42)}px/${px}px -apple-system,sans-serif">${letter}</span>`;
    };

    const quotaBar = (pid, kind) => {
      if (kind !== "cursor") return "";
      let q = null;
      try { q = require(path.join(ROOT, "seat-quota.js")).cachedQuota(pid); } catch {}
      const known = q && q.percentUsed != null;
      const w = known ? Math.max(0, Math.min(100, Number(q.percentUsed))) : 0;
      const col = !known ? "var(--gd-text-dim)" : w >= 90 ? "#fca5a5" : w >= 70 ? "#fbbf24" : "#34d399";
      const label = known ? Math.round(w) + "%" : "—";
      const tip = seatHoverText(pid, q);
      return `<div class="gd-quota" data-quota-id="${escAttr(pid)}" title="${escAttr(tip)}" data-tip="${escAttr(tip)}">
        <span class="gd-quota-track"><span class="gd-quota-fill" style="width:${w}%;background:${col}"></span></span>
        <span class="gd-quota-n" style="color:${col}">${escHtml(label)}</span>
      </div>`;
    };

    let swapButtonsHtml = allProfiles.map((p) => {
      const isCur = p.id === id;
      const snap = seatSnapshot(p.id);
      const letter = seatAbbrev(p.id);
      const pColor = getProfileColorInfo(p.color);
      const prov = getProviderInfo(snap.ident.provider || snap.ident.authId || p.id, p.id);
      const sub = snap.email || (snap.signed ? prov.name : "signed out");
      let q = null;
      try { q = require(path.join(ROOT, "seat-quota.js")).cachedQuota(p.id); } catch {}
      const stopTip = seatHoverText(p.id, q);
      const stopped = botsPaused(p.id);
      return `
        <div class="whimsical-model-item grok-swap-item${isCur ? " is-active-model" : ""}${stopped ? " is-stopped" : ""}" data-id="${escAttr(p.id)}" style="--glow-color:${escAttr(pColor.glow)}">
          ${seatFace(p, snap, 20)}
          <span style="min-width:0;flex:1">
            <span style="display:block;font-size:11px;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(letter)} · ${escHtml(p.name || p.id)}</span>
            <span style="display:block;font-size:9.5px;color:rgba(255,255,255,0.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(sub)}</span>
            ${quotaBar(p.id, p.kind)}
          </span>
          ${switchBtn(stopped, "is-stop", `data-seat-stop="${escAttr(p.id)}" title="${escAttr(stopTip)}" data-tip="${escAttr(stopTip)}"`)}
        </div>
      `;
    }).join("");

    menu.innerHTML = `
      <div class="gd-seat-scroll">
        <div class="active-provider-hero-pill">
          <span style="width:7px;height:7px;border-radius:50%;${statusDot};flex:0 0 7px"></span>
          <span style="font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(profile ? profile.name : fmt.title)}</span>
          <span style="font-size:10px;opacity:.55;margin-left:auto;white-space:nowrap">${escHtml(statusText)}</span>
          <button type="button" id="grok-idcard-toggle" class="gd-idtoggle${idCollapsed ? " is-collapsed" : ""}" title="Account details" aria-expanded="${idCollapsed ? "false" : "true"}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button type="button" id="grok-menu-close" style="background:none;border:none;color:inherit;opacity:.55;cursor:pointer;padding:0 2px;display:flex;align-items:center">
            ${ICONS.dismiss}
          </button>
        </div>

        <div class="gd-idcard${idCollapsed ? " is-collapsed" : ""}" id="grok-idcard">
          <div class="gd-idrow">
            <span class="gd-idk">Account</span>
            <span class="gd-idv ${fmt.email || fmt.hover ? "" : "is-dim"}" title="${escAttr(fmt.email || fmt.hover || fmt.full || "")}">${escHtml(fmt.email || fmt.hover || "No account bound")}</span>
          </div>
          <div class="gd-idrow">
            <span class="gd-idk">Seat</span>
            <span class="gd-idseat">${escHtml(id)}</span>
          </div>
        </div>

        <div class="whimsical-model-tray no-scrollbar">
          ${swapButtonsHtml}
        </div>
        <div id="grok-seat-more-body">
          ${(profile && profile.kind === "cursor") ? `
          <button type="button" id="grok-continue-local" class="whimsical-model-item" title="Keep this chat and settings. Local models pick up here.">
            <span style="font-size:11px;font-weight:650">Continue on Local D</span>
          </button>
          ` : ""}
          <button type="button" id="grok-menu-new-bot" class="whimsical-model-item" title="Create a bot on this computer">
            <span style="font-size:11px;font-weight:650">Create new Bot</span>
          </button>
          <div class="whimsical-model-item" id="grok-orb-avatar" role="switch"
               aria-checked="${orbAvatarOn() ? "true" : "false"}" tabindex="0"
               title="Put the active seat's photo on the left orb">
            ${seatFace(profile || { id }, seatSnapshot(id), 20)}
            <span style="min-width:0;flex:1">
              <span style="display:block;font-size:11px;font-weight:650">Seat photo on the orb</span>
            </span>
            ${switchBtn(orbAvatarOn(), "", 'data-orb-avatar="1"')}
          </div>
          <div class="gd-railacts">
            <button type="button" id="grok-menu-add-seat" class="gd-iconbtn is-primary" title="Add seat">${ICONS.plus}</button>
            ${isLocalSeat(id) || (profile && profile.kind === "local") ? "" : `<button type="button" id="grok-menu-clean-login" class="gd-iconbtn" title="Open Sign-In">${ICONS.browser}</button>`}
            <button type="button" id="grok-menu-pick-icon" class="gd-iconbtn" title="Change icon">${ICONS.palette}</button>
          </div>
          <button type="button" id="grok-menu-setup-wizard" class="whimsical-model-item" title="Open the first-time setup wizard to configure seats & AI engine">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--gd-aqua, #00f0ff)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span style="font-size:11px;font-weight:700;color:var(--gd-aqua, #00f0ff)">✨ Setup Wizard</span>
            <span style="font-size:9.5px;opacity:.55;margin-left:auto">Re-run</span>
          </button>
          <button type="button" id="grok-menu-setup-provider" class="whimsical-model-item" title="Configure OpenBurnBar, local models & API keys">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span style="font-size:11px;font-weight:650">OpenBurnBar & Models</span>
          </button>
          <a href="https://burnbar.app" target="_blank" id="grok-menu-burnbar-app" class="whimsical-model-item" title="Check out the official BurnBar macOS menu bar app" style="text-decoration:none;display:flex;align-items:center;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span style="font-size:11px;font-weight:650;color:#38bdf8">BurnBar Mac App ↗</span>
          </a>
          <button type="button" id="grok-menu-update-d" class="whimsical-model-item" title="Pull latest updates and safe in-place rebuild">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span style="font-size:11px;font-weight:650">Update Grok "D"</span>
          </button>
          ${fallOverBlock()}
          ${isLocalSeat(id) || (profile && profile.kind === "local") ? "" : `<button type="button" id="grok-menu-reset-login" class="whimsical-model-item is-danger">
            ${ICONS.reset}
            <span style="font-size:11px;font-weight:650">Reset session</span>
          </button>`}
        </div>
      </div>
    `;

    document.body.appendChild(menu);
    positionSeatBubble(menu);
    requestAnimationFrame(() => positionSeatBubble(menu));
    bindSeatMenuDismiss(menu);
    bindTimeTips(menu);
    refreshSeatQuotaBars(id);

    menu.querySelector("#grok-menu-close").addEventListener("click", closeSeatActionMenu);
    menu.querySelector("#grok-idcard-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      const card = menu.querySelector("#grok-idcard");
      const btn = menu.querySelector("#grok-idcard-toggle");
      const now = card.classList.toggle("is-collapsed");
      btn.classList.toggle("is-collapsed", now);
      btn.setAttribute("aria-expanded", now ? "false" : "true");
      try { localStorage.setItem("gd-idcard-collapsed", now ? "1" : "0"); } catch (_) {}
    });
    menu.querySelectorAll("[data-seat-stop]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const seat = btn.getAttribute("data-seat-stop");
        const next = !botsPaused(seat);
        toast(next ? ("Stopping " + profileDisplayName(seat) + "…") : ("Resuming " + profileDisplayName(seat) + "…"));
        setBotsPaused(next, seat).then(() => {
          toast(next ? (profileDisplayName(seat) + " stopped") : (profileDisplayName(seat) + " running"));
          openSeatActionMenu(st, fmt, profile, id);
        }).catch((err) => {
          logRendererError("stop-seat", err);
          toast("Unable to update pause state. Please retry.");
        });
      });
    });
    const orbRow = menu.querySelector("#grok-orb-avatar");
    if (orbRow) {
      const flipOrb = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !orbAvatarOn();
        setUiPref("orbAvatar", next);
        const knob = orbRow.querySelector(".gd-sw");
        if (knob) {
          knob.classList.toggle("is-on", next);
          knob.setAttribute("aria-pressed", next ? "true" : "false");
        }
        orbRow.setAttribute("aria-checked", next ? "true" : "false");
        try { paintSeatOrb(); } catch (_) {}
        const face = next ? seatOrbFace(id) : null;
        if (next && !face) toast("No photo or icon on this seat yet");
        else toast(next ? "Orb follows the active seat" : "Orb back to the Grok face");
      };
      orbRow.addEventListener("click", flipOrb);
      orbRow.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") flipOrb(e);
      });
    }

    const updateBtn = menu.querySelector("#grok-menu-update-d");
    if (updateBtn) {
      updateBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSeatActionMenu();
        toast("Updating Grok D to latest version in background…");
        try {
          const { spawn } = require("child_process");
          const updateScript = path.join(ROOT, "update.sh");
          const child = spawn("bash", [updateScript], { detached: true, stdio: "ignore" });
          child.unref();
        } catch (err) {
          toast("Update failed: " + err.message);
        }
      });
    }

    const wizardBtn = menu.querySelector("#grok-menu-setup-wizard");
    if (wizardBtn) {
      wizardBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSeatActionMenu();
        startOnboarding(true);
      });
    }

    const setupProviderBtn = menu.querySelector("#grok-menu-setup-provider");
    if (setupProviderBtn) {
      setupProviderBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSeatActionMenu();
        try {
          const hub = require(path.join(ROOT, "provider-hub.js"));
          hub.renderProviderModal();
        } catch (err) {
          const modelOrb = document.getElementById("pure-model-plasma-orb") || document.querySelector(".pure-plasma-orb-2");
          if (modelOrb) modelOrb.click();
        }
      });
    }

    const flipFallOver = (row) => {
      const key = row.getAttribute("data-fo");
      if (!key) return;
      const knob = row.querySelector(".gd-sw");
      const on = !(knob && knob.classList.contains("is-on"));
      let saved = false;
      try {
        const fo = foMod();
        if (fo && fo.saveConfig) {
          fo.saveConfig({ [key]: on });
          saved = true;
        }
      } catch (err) {
        logRendererError("save-failover", err);
        toast("Unable to save failover settings");
        return;
      }
      if (!saved) {
        toast("Fall over settings unavailable");
        return;
      }
      if (knob) {
        knob.classList.toggle("is-on", on);
        knob.setAttribute("aria-pressed", on ? "true" : "false");
      }
      row.setAttribute("aria-checked", on ? "true" : "false");
      if (key === "enabled") {
        const pill = menu.querySelector(".gd-focard .gd-idpill");
        if (pill) {
          pill.className = "gd-idpill " + (on ? "is-on" : "is-off");
          pill.innerHTML = "<i></i>" + (on ? "On" : "Off");
        }
      }
      const ui = foUi();
      const labels = (ui && ui.TOAST) || {};
      toast((labels[key] || key) + (on ? " on" : " off"));
    };
    menu.querySelectorAll("[data-fo]").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        flipFallOver(row);
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          flipFallOver(row);
        }
      });
    });
    menu.querySelectorAll(".grok-swap-item").forEach((b) => {
      b.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-seat-stop]")) return;
        const targetId = b.getAttribute("data-id");
        closeSeatActionMenu();
        if (targetId && targetId !== id) {
          toast("Swapping to " + profileDisplayName(targetId) + "…");
          switchTo(targetId);
        }
      });
    });
    const cont = menu.querySelector("#grok-continue-local");
    if (cont) {
      cont.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSeatActionMenu();
        toast("Continuing this chat on Local D…");
        captureChatHandoff();
        switchTo("local-d", { takeover: true });
      });
    }
    const resetEl = menu.querySelector("#grok-menu-reset-login");
    if (resetEl) resetEl.addEventListener("click", () => {
      closeSeatActionMenu();
      toast("Resetting browser profile for " + profileDisplayName(id) + "…");
      loginClean({ reset: true }).catch((e) => {
        logRendererError("reset", e);
        toast("Reset failed. Please retry.");
      });
    });
    const loginEl = menu.querySelector("#grok-menu-clean-login");
    if (loginEl) loginEl.addEventListener("click", () => {
      closeSeatActionMenu();
      loginClean({ reset: false }).catch((e) => {
        logRendererError("login", e);
        toast("Sign-in could not be started. Please retry.");
      });
    });
    menu.querySelector("#grok-menu-pick-icon").addEventListener("click", () => {
      closeSeatActionMenu();
      openGalleryIconPicker(id);
    });
    menu.querySelector("#grok-menu-add-seat").addEventListener("click", () => {
      closeSeatActionMenu();
      openSheet();
    });
    const newBot = menu.querySelector("#grok-menu-new-bot");
    if (newBot) {
      newBot.addEventListener("click", () => {
        closeSeatActionMenu();
        try {
          const r = require(path.join(ROOT, "create-bot-hook.js")).createViaBox("New Bot");
          const nm = (r && r.agent && r.agent.name) || "New Bot";
          toast("Created " + nm);
          try { pageCall("return await window.desktop.forceGatewayReconnect()"); } catch {}
        } catch (e) {
          logRendererError("create-bot", e);
          toast("Unable to create bot. Please retry.");
        }
      });
    }
  }

  function ensureChipCss() {
    ensureStyles();
    if (document.getElementById("gd-acc-chip-css")) return;
    const st = document.createElement("style");
    st.id = "gd-acc-chip-css";
    st.textContent = `
      #grok-d-login-chip {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 999990;
        cursor: pointer;
        text-align: left;
        padding: 5px 12px 5px 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(24, 24, 28, 0.88);
        color: #f4f4f5;
        min-width: 175px;
        max-width: 300px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        font: 600 11px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        display: flex;
        align-items: center;
        gap: 9px;
        transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        user-select: none;
      }
      #grok-d-login-chip:hover {
        transform: translateY(-1.5px);
        border-color: rgba(255, 255, 255, 0.24);
        background: rgba(32, 32, 38, 0.94);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
      }
      #grok-d-login-chip .gd-acc-photo {
        position: relative;
        overflow: visible !important;
      }
      #grok-d-login-chip .gd-acc-photo img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        display: block;
      }
      #grok-d-login-chip .gd-status-pip {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        border: 2px solid #18181c;
        box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
        z-index: 2;
        transition: background 0.2s ease;
      }
      #grok-d-login-chip .gd-status-pip.is-paused {
        background: #f59e0b;
        box-shadow: 0 0 6px rgba(245, 158, 11, 0.8);
      }
      #grok-d-login-chip .gd-status-pip.is-off {
        background: #71717a;
        box-shadow: none;
      }
      #grok-d-login-chip .gd-acc-tip {
        display: none;
        position: absolute;
        left: 0;
        bottom: calc(100% + 8px);
        z-index: 1;
        padding: 6px 10px;
        border-radius: 10px;
        background: #18181c;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #f4f4f5;
        white-space: nowrap;
        font: 500 11px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(16px);
      }
      #grok-d-login-chip:hover .gd-acc-tip, #grok-d-login-chip:focus .gd-acc-tip { display: block; }
      #grok-d-login-chip .gd-stop-btn {
        flex: 0 0 26px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.06);
        color: #fca5a5;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        margin: 0;
        transition: all 0.15s ease;
      }
      #grok-d-login-chip .gd-stop-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }
      #grok-d-login-chip .gd-stop-btn.is-paused {
        background: rgba(16, 185, 129, 0.15);
        border-color: rgba(16, 185, 129, 0.3);
        color: #10b981;
      }
    `;
    document.head.appendChild(st);
  }

  function setChipPhoto(photo, dataUrl, letter) {
    if (!photo) return;
    let pip = photo.querySelector(".gd-status-pip");
    const ok = typeof dataUrl === "string" && dataUrl.indexOf("data:image") === 0;
    let img = photo.querySelector("img");
    if (ok) {
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        photo.appendChild(img);
      }
      if (img.getAttribute("src") !== dataUrl) img.setAttribute("src", dataUrl);
      Array.from(photo.childNodes).forEach((n) => {
        if (n.nodeType === 3) n.remove();
        else if (n !== img && n !== pip) n.remove();
      });
    } else {
      if (img) img.remove();
      let textNode = Array.from(photo.childNodes).find((n) => n.nodeType === 3);
      if (textNode) {
        textNode.textContent = letter || "?";
      } else {
        photo.insertBefore(document.createTextNode(letter || "?"), photo.firstChild);
      }
      photo.style.backgroundImage = "";
    }
    if (!pip) {
      pip = document.createElement("span");
      pip.className = "gd-status-pip";
      pip.setAttribute("aria-hidden", "true");
      photo.appendChild(pip);
    }
  }

  function paintLoginChip() {
    ensureStyles();
    let chip = document.getElementById("grok-d-login-chip");
    if (chip && chip.tagName === "BUTTON") {
      chip.remove();
      chip = null;
    }
    if (!chip) {
      chip = el("div", `
        position:fixed;left:18px;bottom:18px;z-index:999990;cursor:pointer;text-align:left;
        padding:6px 12px 6px 8px;border-radius:999px;border:1px solid var(--gd-border);
        background:var(--gd-card-bg);color:var(--gd-text);min-width:175px;max-width:300px;
        box-shadow:var(--gd-shadow);backdrop-filter:blur(24px) saturate(190%);
        -webkit-backdrop-filter:blur(24px) saturate(190%);
        font:650 11px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
        display:flex;align-items:center;gap:9px;transition:transform 0.18s cubic-bezier(0.16,1,0.3,1), border-color 0.18s ease;
      `);
      chip.id = "grok-d-login-chip";
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      document.body.appendChild(chip);
    }
    ensureChipCss();

    const stopOk = chip.querySelector("#gd-chip-stop");
    if (!chip.querySelector("span.gd-acc-photo") || !stopOk || stopOk.tagName !== "BUTTON") {
      chip.innerHTML = `
        <span class='gd-acc-photo' aria-hidden='true' style='width:32px;height:32px;border-radius:50%;flex:0 0 32px;overflow:visible;display:inline-flex;align-items:center;justify-content:center;background:var(--gd-btn-sec-bg);border:1.5px solid var(--gd-border);color:var(--gd-text);font:700 13px/32px -apple-system,BlinkMacSystemFont,sans-serif'>
          D
          <span class='gd-status-pip' aria-hidden='true'></span>
        </span>
        <span style='min-width:0;flex:1'>
          <div class='gd-acc-title' style='color:var(--gd-text);font-weight:750;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'></div>
          <div class='gd-acc-detail' style='color:var(--gd-text-muted);font-weight:500;font-size:10px;margin-top:1.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'></div>
          <div class='gd-acc-hint' style='color:var(--gd-text-dim);font-weight:600;margin-top:2px;font-size:9px'>Click to swap or configure</div>
        </span>
        <button type="button" class="gd-stop-btn" id="gd-chip-stop" title="Stop this seat">${ICONS.stop}</button>
        <button type="button" id="grok-d-chip-toggle" title="Collapse to the avatar" aria-label="Collapse account chip">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>
        </button>
        <span class='gd-acc-tip'></span>
      `;
      chip._hasMenuListener = false;
    }

    if (document.getElementById("grokd-splash-stage")) {
      chip.style.visibility = "hidden";
    } else {
      chip.style.visibility = "visible";
    }

    // Collapsed, the chip is just the avatar — small enough to forget, and its
    // own way back. The expand click must not fall through to the swap sheet.
    const collapsed = chipCollapsed();
    chip.classList.toggle("is-collapsed", collapsed);
    chip.title = collapsed ? "Show account" : "";
    const chipToggle = chip.querySelector("#grok-d-chip-toggle");
    if (chipToggle && !chipToggle._gdWired) {
      chipToggle._gdWired = true;
      chipToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setUiPref("chipCollapsed", true);
        paintLoginChip();
      }, true);
    }
    if (!chip._gdExpandWired) {
      chip._gdExpandWired = true;
      chip.addEventListener("click", (e) => {
        if (!chipCollapsed()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setUiPref("chipCollapsed", false);
        paintLoginChip();
      }, true);
    }

    const id = activeId();
    const curProfile = (load().profiles || []).find((p) => p.id === id);

    const applyChip = (st) => {
      const acc = require(path.join(ROOT, "account-identity.js"));
      const fmt = acc.formatCursorAccount(st, id);
      const seatLetter = (id || "").replace(/^cursor-/, "").replace(/^local-/, "").toUpperCase() || "D";
      const profileName = curProfile ? curProfile.name : ("Seat " + seatLetter);
      const provider = fmt.provider || (mode() === "local" ? "Local" : "Cursor");
      fmt.title = profileName + " · " + provider;

      const title = chip.querySelector(".gd-acc-title");
      const detail = chip.querySelector(".gd-acc-detail");
      const photo = chip.querySelector(".gd-acc-photo");
      const tip = chip.querySelector(".gd-acc-tip");
      const pip = chip.querySelector(".gd-status-pip");
      const email = (fmt.email || (st && st.email) || "").trim();
      const hover = email || fmt.hover || "No email on this login";

      if (title) title.textContent = fmt.title;
      if (detail) {
        const base = email || fmt.detail || "";
        detail.textContent = botsPaused(id) ? (base ? "STOPPED · " + base : "STOPPED") : base;
        detail.style.color = botsPaused(id) ? "var(--gd-red-text)" : "";
      }
      if (pip) {
        const pausedNow = botsPaused(id);
        const signedNow = !!(fmt.signedIn || fmt.email || (st && (st.kind === "logged-in" || st.email)) || isLocalSeat(id));
        pip.className = "gd-status-pip" + (pausedNow ? " is-paused" : (signedNow ? "" : " is-off"));
      }
      const chipTip = seatHoverText(id, (() => {
        try { return require(path.join(ROOT, "seat-quota.js")).cachedQuota(id); }
        catch { return null; }
      })());
      chip.title = chipTip && chipTip !== "Cursor quota unavailable" ? chipTip : hover;
      chip.setAttribute("aria-label", (fmt.title + " " + hover).trim());
      if (tip) tip.textContent = hover;

      const stopEl = chip.querySelector("#gd-chip-stop");
      if (stopEl) {
        const pausedNow = botsPaused(id);
        stopEl.classList.toggle("is-paused", pausedNow);
        stopEl.innerHTML = pausedNow ? ICONS.play : ICONS.stop;
        stopEl.title = pausedNow
          ? "Resume this seat"
          : "Stop this seat — parks its routines and cuts its turns";
        if (!stopEl._wired) {
          stopEl._wired = true;
          const go = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            const seat = activeId();
            const next = !botsPaused(seat);
            toast(next ? ("Stopping " + profileDisplayName(seat) + "…") : ("Resuming " + profileDisplayName(seat) + "…"));
            setBotsPaused(next, seat).then(() => {
              toast(next ? (profileDisplayName(seat) + " stopped") : (profileDisplayName(seat) + " running"));
              paintLoginChip();
            }).catch((err) => {
              logRendererError("chip-stop", err);
              toast("Unable to update pause state. Please retry.");
            });
          };
          stopEl.addEventListener("click", go);
          stopEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") go(e);
          });
        }
      }

      if (!chip._hasMenuListener) {
        chip._hasMenuListener = true;
        chip.addEventListener("click", (e) => {
          if (e.target && e.target.closest && e.target.closest("#gd-chip-stop")) return;
          e.stopPropagation();
          const existing = document.getElementById("grok-seat-action-menu");
          if (existing) closeSeatActionMenu();
          else openSeatActionMenu(st, fmt, curProfile, id);
        });
      }

      const mascot = getProfileMascotSvg(curProfile, id);
      const pColor = getProfileColorInfo(curProfile ? curProfile.color : "#8b5cf6");
      const wantKey = (st && (st.authId || st.email)) || id;
      const cached = acc.readCache(id);
      if (photo) {
        photo.style.boxShadow = "0 0 10px " + pColor.glow;
        photo.style.border = "1.5px solid " + pColor.hex;
      }

      if (cached && cached.pictureDataUrl && (!st.authId || cached.authId === st.authId)) {
        chip._avatarKey = wantKey;
        chip._avatarUrl = cached.pictureDataUrl;
        setChipPhoto(photo, cached.pictureDataUrl, fmt.letter || seatLetter);
      } else if (mascot) {
        photo.innerHTML = `<div style="width:32px;height:32px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center">${mascot}</div>`;
      } else {
        setChipPhoto(photo, st && st.pictureDataUrl, fmt.letter || seatLetter);
      }

      if (chip._avatarKey === wantKey && chip._avatarUrl) {
        setChipPhoto(photo, chip._avatarUrl, fmt.letter || seatLetter);
        return;
      }

      return acc.resolveAvatarDataUrl(st).then((url) => {
        if (url) return url;
        return pageCall("return await window.desktop.cursorAccount.getAvatar()").then((r) => {
          const v = r && r.ok && r.value;
          return (typeof v === "string" && v.indexOf("data:image") === 0) ? v : null;
        }).catch(() => null);
      }).then((url) => {
        if (!url) url = acc.accountAvatarDataUrl(st);
        chip._avatarKey = wantKey;
        chip._avatarUrl = url;
        setChipPhoto(photo, url, fmt.letter || seatLetter);
        if (st && (st.authId || st.email) && url && url.indexOf("data:image") === 0) {
          acc.writeCache(id, {
            authId: st.authId,
            email: st.email,
            name: st.name || st.displayName,
            pictureUrl: st.profilePictureUrl,
            pictureDataUrl: url,
          });
        }
      });
    };

    applyChip(diskIdentity());
    if (chip._painting) return;
    chip._painting = true;
    identity().then((st) => applyChip(st)).catch(() => {}).finally(() => { chip._painting = false; });
  }

  function currentModelId() {
    try { return models.resolveConfig().model; } catch { return "grok-4.6"; }
  }

  async function applyModel(id) {
    if (models) models.setModel(id);
    if (window.desktop && window.desktop.agent && window.desktop.agent.setDefaultModel) {
      try {
        await window.desktop.agent.setDefaultModel({ modelId: id, maxMode: true, parameters: [] });
      } catch (e) {
        // local hook already persisted; cursor box may be mid-reconnect
      }
    }
    const sel = document.getElementById("grok-model-select");
    if (sel && sel.value !== id) sel.value = id;
    const modelClean = id.replace(/^cursor\//, "").replace(/-/g, " ");
    toast("Model set: " + modelClean);
    return id;
  }

  function readActiveAgent() {
    try {
      const j = JSON.parse(fs.readFileSync(ACTIVE_AGENT, "utf8"));
      if (j && j.activeAgentId) return j.activeAgentId;
    } catch {}
    try {
      const shim = require(path.join(ROOT, "gateway-shim.js"));
      const list = shim.getLocalAgents();
      if (list[0] && list[0].id) return list[0].id;
    } catch {}
    return null;
  }

  function findComposer() {
    return document.querySelector('[contenteditable="true"]')
      || document.querySelector('[role="textbox"]')
      || document.querySelector("textarea");
  }

  function composerText() {
    const el = findComposer();
    if (!el) return "";
    return String(el.innerText || el.value || "").trim();
  }

  function captureComposer() {
    const t = composerText();
    if (t) window.__grokdLastPrompt = t;
    return window.__grokdLastPrompt || "";
  }

  function queuedNotice() {
    return document.querySelector(".sand-queued-send-notice, [data-testid='sand-queued-send-notice']");
  }

  function queuedText(notice) {
    const raw = String((notice && notice.textContent) || "");
    const cut = raw.replace(/Will send when reconnected.*$/i, "").replace(/Waiting to send.*$/i, "").replace(/Cancel/gi, "").trim();
    return cut || captureComposer() || window.__grokdLastPrompt || "";
  }

  function sendLocal(text) {
    const agentId = readActiveAgent();
    if (!agentId) return Promise.reject(new Error("no active local agent"));
    const payload = JSON.stringify({ agentId, prompt: text, awaitTurn: false });
    return new Promise((resolve, reject) => {
      const req = require("http").request({
        host: "127.0.0.1",
        port: 1337,
        path: "/api/sendPrompt",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: AUTH,
          "content-length": Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 400), agentId });
        });
      });
      req.on("error", reject);
      req.setTimeout(15000, () => req.destroy(new Error("sendPrompt timeout")));
      req.end(payload);
    });
  }

  function typeComposer(text) {
    const el = findComposer();
    if (!el) throw new Error("composer not found");
    el.focus();
    try { document.execCommand("selectAll"); } catch {}
    const inserted = (() => {
      try { return document.execCommand("insertText", false, text); } catch { return false; }
    })();
    if (!inserted) {
      if ("value" in el) {
        el.value = text;
      } else {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    const sendBtn = document.querySelector('button[aria-label*="Send" i], button[data-testid*="send" i]');
    if (sendBtn) sendBtn.click();
    return true;
  }

  async function waitForReply(token, timeoutMs) {
    const t0 = Date.now();
    let last = document.body ? document.body.innerText : "";
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 500));
      const now = document.body ? document.body.innerText : "";
      if (now.includes(token) && now.length > last.length + 8) {
        const idx = now.lastIndexOf(token);
        return now.slice(idx, idx + 600);
      }
      last = now;
    }
    return null;
  }

  let flushed = "";
  async function flushQueued() {
    if (mode() !== "local") return false;
    if (window.__grokdFlushing) return false;
    const notice = queuedNotice();
    const text = queuedText(notice);
    if (!notice || !text || text === flushed) return false;
    window.__grokdFlushing = true;
    try {
      const r = await sendLocal(text);
      if (r.ok) {
        flushed = text;
        const btn = notice.querySelector && notice.querySelector("button");
        if (btn) btn.click();
        notice.style.display = "none";
        toast("Sent via local box");
        return true;
      }
    } catch (e) {
      logRendererError("flush-queued", e);
      toast("Send failed. Check local box connection.");
    } finally {
      setTimeout(() => { window.__grokdFlushing = false; }, 800);
    }
    return false;
  }

  function diskIdentity() {
    try {
      const acc = require(path.join(ROOT, "account-identity.js"));
      return acc.enrichStatus({ kind: "unknown" }, { profileId: activeId() });
    } catch {
      return { kind: "unknown" };
    }
  }

  async function identity() {
    if (isLocalSeat()) {
      return { kind: "logged-in", name: "Local D", provider: "local", authId: "local|d" };
    }
    const r = await pageCall("return await window.desktop.cursorAccount.getStatus()", 2500);
    const raw = (r && r.ok && r.value) || { kind: "unknown", error: r && r.error };
    try {
      const acc = require(path.join(ROOT, "account-identity.js"));
      const st = acc.enrichStatus(raw, { profileId: activeId() });
      if (st && (st.kind === "logged-in" || st.email || st.authId)) {
        acc.rememberStatus(st, activeId());
      }
      return st;
    } catch {
      return raw;
    }
  }

  function writeReady() {
    try {
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(READY, JSON.stringify({
        ts: Date.now(),
        mode: mode(),
        href: location.href,
      }));
    } catch {}
  }

  async function handleCommand(cmd) {
    if (!cmd || !cmd.id || !cmd.op) return;
    const out = { id: cmd.id, op: cmd.op, ok: false, ts: Date.now() };
    try {
      const tok = String(cmd.capability || cmd.authToken || cmd.token || "").trim();
      const g = secGuardMod();
      const authed = g && (
        g.verifyGatewayAuth(tok) ||
        g.verifySessionJwt(tok, "ui-bus") ||
        g.verifySessionJwt(tok, "local-mcp") ||
        g.verifySessionJwt(tok, "grokbot-proxy")
      );
      if (cmd.op !== "status" && !authed) {
        throw new Error("Unauthorized UI command: invalid or missing capability token");
      }
      if (cmd.op === "status") {
        const t = document.body ? document.body.innerText : "";
        const cover = document.querySelector(".sand-access-cover");
        const landing = document.querySelector(".sand-onboarding__landing");
        const kernel = document.getElementById("gd-kernel");
        const chat = chatLib() ? chatLib().chatSurface(document) : { composer: !!findComposer(), ok: !!findComposer() };
        let sky = false;
        try { sky = require(path.join(ROOT, "space-kernel.js")).onSky(); } catch {}
        out.ok = true;
        out.mode = mode();
        out.identity = authed ? await identity() : null;
        out.model = currentModelId();
        out.composer = !!chat.composer;
        out.agent = !!chat.agent;
        out.thread = !!chat.thread;
        out.chat = !!chat.ok;
        out.agentCount = document.querySelectorAll(".sand-agent-item").length;
        out.cover = !!cover;
        out.landing = !!landing;
        out.coverShown = !!(cover && !(cover.style && cover.style.display === "none"));
        out.landingShown = !!(landing && !(landing.style && landing.style.display === "none"));
        out.kernelDisplay = kernel ? (kernel.style.display || "") : "";
        out.sky = !!sky;
        out.skyCleared = !!window.__gdSkyCleared;
        out.queued = !!queuedNotice();
        out.unavail = /isn.?t available on this account/i.test(t);
        out.rec = /Will send when reconnected/.test(t);
        out.orbs = !!document.getElementById("pure-lava-orbs-root");
        out.bodyLen = t.length;
      } else if (cmd.op === "continue-sky") {
        out.enter = await dismissSky();
        out.chat = chatLib() ? chatLib().chatSurface(document) : { ok: !!findComposer() };
        out.ok = !!(out.chat && out.chat.ok);
      } else if (cmd.op === "login-clean") {
        out.login = await loginClean({ reset: !!cmd.reset });
        out.ok = true;
      } else if (cmd.op === "probe-auth") {
        out.probe = probeAuthToDisk();
        out.identity = await identity();
        out.usage = await usageAccepted();
        out.hasBox = hasRemoteComputer();
        out.ok = true;
      } else if (cmd.op === "ensure-box") {
        out.ensure = await ensureCursorComputer();
        out.ok = !!(out.ensure && /^(already|official-connect|reconnect|recreate|descriptor|login-descriptor|not-cursor|pending|paused)$/.test(out.ensure.action));
      } else if (cmd.op === "splash") {
        window.__grokd_splash_done = false;
        window.__grokdSplashPlaying = false;
        playCinematicSplash();
        out.ok = true;
      } else if (cmd.op === "onboard") {
        startOnboarding(true);
        out.ok = true;
      } else if (cmd.op === "set-model") {
        out.model = await applyModel(cmd.model);
        out.ok = true;
      } else if (cmd.op === "pause" || cmd.op === "stop-bots") {
        out.pause = await setBotsPaused(true);
        out.ok = true;
      } else if (cmd.op === "resume" || cmd.op === "resume-bots") {
        out.pause = await setBotsPaused(false);
        out.ok = true;
      } else if (cmd.op === "send") {
        const text = String(cmd.text || "").trim();
        if (!text) throw new Error("empty text");
        window.__grokdLastPrompt = text;
        out.mode = mode();
        out.identity = await identity();
        if (mode() === "local") {
          const r = await sendLocal(text);
          out.send = r;
          out.ok = !!r.ok;
          if (queuedNotice()) {
            const n = queuedNotice();
            const btn = n.querySelector && n.querySelector("button");
            if (btn) btn.click();
            n.style.display = "none";
          }
        } else {
          typeComposer(text);
          out.typed = true;
          out.reply = await waitForReply(cmd.token || text.slice(0, 12), cmd.timeoutMs || 90000);
          out.ok = !!(out.reply && out.reply.includes(cmd.token || text.slice(0, 12)));
        }
      } else if (cmd.op === "cover") {
        const cover = document.querySelector(".sand-access-cover")
          || document.querySelector(".sand-onboarding__landing");
        out.cover = applyCoverScheme(cover, cmd.mode);
        out.ok = true;
      } else if (cmd.op === "chatter") {
        out.chatter = require(path.join(ROOT, "bot-chatter.js")).preview(cmd.mode);
        out.ok = !!out.chatter;
      } else {
        throw new Error("unknown op " + cmd.op);
      }
    } catch (e) {
      out.error = String(e && e.message || e);
    }
    try { fs.writeFileSync(RESULT, JSON.stringify(out)); } catch {}
  }

  let _cmdInFlight = false;
  async function pollCommand() {
    if (_cmdInFlight) return;
    try {
      if (!fs.existsSync(COMMAND)) return;
      const proc = path.join(path.dirname(COMMAND), `.proc-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      fs.renameSync(COMMAND, proc);
      const cmd = JSON.parse(fs.readFileSync(proc, "utf8"));
      fs.unlinkSync(proc);
      _cmdInFlight = true;
      try {
        await handleCommand(cmd);
      } finally {
        _cmdInFlight = false;
      }
    } catch {
      _cmdInFlight = false;
    }
  }

  function inject() {
    try {
      if (uiPrefs().skyCleared) window.__gdSkyCleared = true;
    } catch (_) {}
    restoreGorgeousUi();
    // Real picker is the packed liquid-glass orbs. Do not draw a second bar.
    // Give those orbs a soap-bubble rim that reflects their own contents.
    if (orbStyle() === "classic") {
      try { require(path.join(ROOT, "bubble-rim.js")).stop(); } catch (_) {}
    } else {
      try { require(path.join(ROOT, "bubble-rim.js")).start(); } catch (_) {}
    }
    try {
      const plasma = path.join(ROOT, "plasma-selectors.js");
      if (fs.existsSync(plasma)) {
        require(plasma);
      }
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[plasma-selectors] " + e + "\n"); } catch (_) {}
    }
    try {
      const logos = require(path.join(ROOT, "provider-logos.js"));
      const kernel = require(path.join(ROOT, "space-kernel.js"));
      const scheme = uiPrefs().coverScheme;
      if (scheme === "light" || scheme === "dark") kernel.setScheme(scheme);
      kernel.start(logos.ORBITERS || []);
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[space-kernel] " + e + "\n"); } catch (_) {}
    }
    try { require(path.join(ROOT, "glass-theme.js")).start(); } catch (_) {}
    try { candyGrokMarks(); } catch (_) {}
    try { require(path.join(ROOT, "cursor-model-bubble.js")).start(); } catch (_) {}
    try { require(path.join(ROOT, "create-bot-hook.js")).start(); } catch (_) {}
    try { require(path.join(ROOT, "bot-chatter.js")).start(); } catch (_) {}
  }

  function onboardPath() {
    return path.join(ROOT, "onboarding.json");
  }

  function looksLikeExistingUser() {
    if (fs.existsSync(path.join(ROOT, "runtime", "last-switch.json"))) return true;
    if (fs.existsSync(path.join(ROOT, "profile-data", "cursor-a", "sand-data", "local-exec-daemon-connection.json"))) return true;
    try {
      const st = fs.statSync(path.join(ROOT, "profiles.json"));
      if (Date.now() - Number(st.birthtimeMs || st.ctimeMs || 0) > 6 * 3600 * 1000) return true;
    } catch {}
    return false;
  }

  function markExistingUserOnboarded() {
    const p = onboardPath();
    if (fs.existsSync(p)) return;
    if (!looksLikeExistingUser()) return;
    try {
      fs.writeFileSync(p, JSON.stringify({
        version: 1,
        completed: true,
        skipped: true,
        seenSplash: true,
        reason: "existing-user",
      }, null, 2) + "\n");
    } catch {}
  }

  function recentlySwitched() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, "runtime", "last-switch.json"), "utf8"));
      // Only skip splash on a real orb hop. 25s covers relaunch, not a cold open.
      return !!(j && Date.now() - Number(j.ts) < 25000);
    } catch {
      return false;
    }
  }

  function loadOnboardingAssets() {
    if (!document.getElementById("gd-onboard-css")) {
      const cssPath = path.join(ROOT, "splash", "onboarding.css");
      if (fs.existsSync(cssPath)) {
        const st = document.createElement("style");
        st.id = "gd-onboard-css";
        st.textContent = fs.readFileSync(cssPath, "utf8");
        document.head.appendChild(st);
      }
    }
    if (!window.GrokDOnboarding) {
      try { window.GrokDOnboarding = require(path.join(ROOT, "splash", "onboarding.js")); }
      catch (e) { try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[onboard] " + e + "\n"); } catch (_) {} }
    }
  }

  function startOnboarding(force) {
    loadOnboardingAssets();
    if (!window.GrokDOnboarding) return;
    window.GrokDOnboarding.start({ force: !!force });
  }

  function scopeSplashCss(raw) {
    return String(raw || "")
      .replace(/^\s*\*\s*\{[\s\S]*?\}\s*/m, "")
      .replace(/body,\s*html\s*\{[\s\S]*?\}\s*/m, "");
  }

  function killSplash() {
    try {
      const stage = document.getElementById("grokd-splash-stage");
      if (stage) stage.remove();
      const css = document.getElementById("gd-splash-css");
      if (css) css.remove();
      const chip = document.getElementById("grok-d-login-chip");
      if (chip) chip.style.visibility = "visible";
      const v = document.getElementById("grok-profile-veil");
      if (v) {
        if (isLocalSeat()) {
          v.remove();
        } else {
          v.style.visibility = "visible";
          v.style.opacity = "1";
          v.style.pointerEvents = "auto";
        }
      }
    } catch (_) {}
    try {
      const { webFrame } = require("electron");
      webFrame.executeJavaScript("window.__grokdSplashPlaying=false;true", true).catch(() => {});
    } catch (_) {}
  }

  function playCinematicSplash() {
    try {
      const htmlPath = path.join(ROOT, "splash", "index.html");
      if (!fs.existsSync(htmlPath)) throw new Error("missing splash/index.html");
      const extract = require(path.join(ROOT, "splash-extract.js"));
      const parts = extract.extractIndex(fs.readFileSync(htmlPath, "utf8"));
      if (!parts.stage || !parts.script) throw new Error("index.html missing stage/script");

      let st = document.getElementById("gd-splash-css");
      if (!st) {
        st = document.createElement("style");
        st.id = "gd-splash-css";
        document.head.appendChild(st);
      }
      st.textContent = extract.scopeCss(parts.style);

      const leftover = document.getElementById("grokd-splash-stage");
      if (leftover) leftover.remove();
      const hold = document.createElement("div");
      hold.innerHTML = parts.stage;
      const stage = hold.firstElementChild;
      if (!stage) throw new Error("stage parse failed");
      document.body.appendChild(stage);

      const { webFrame } = require("electron");
      const script = extract.hardenScript(parts.script);
      const boot = script +
        ";\nwindow.GrokDSplash=GrokDSplash;window.SplashAudio=SplashAudio;window.__grokdSplashPlaying=true;'started-new';";
      webFrame.executeJavaScript(boot, true).then((r) => {
        try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[splash] " + r + "\n"); } catch (_) {}
      }).catch((e) => {
        try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[splash-fail] " + e + "\n"); } catch (_) {}
      });
      setTimeout(killSplash, 16000);
    } catch (e) {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[splash] " + e + "\n"); } catch (_) {}
      killSplash();
    }
  }

  function onboardPending() {
    try {
      const raw = fs.existsSync(onboardPath())
        ? JSON.parse(fs.readFileSync(onboardPath(), "utf8"))
        : null;
      return !!(raw && raw.completed === false && raw.skipped !== true);
    } catch {
      return false;
    }
  }

  function injectSplash() {
    markExistingUserOnboarded();
    const leftover = document.getElementById("grokd-splash-stage");
    if (leftover) leftover.remove();
    if (recentlySwitched()) {
      window.__grokd_splash_done = true;
      // Seat switch relaunches D. Keep Seat-in up so a second Cursor login can finish.
      if (onboardPending()) startOnboarding(false);
      return;
    }
    if (window.__grokd_splash_done) return;
    window.__grokd_splash_done = true;
    playCinematicSplash();
    try {
      const raw = fs.existsSync(onboardPath())
        ? JSON.parse(fs.readFileSync(onboardPath(), "utf8"))
        : { completed: true };
      if (raw && raw.completed === false && raw.skipped !== true) {
        // Wizard waits until the slam finishes.
        setTimeout(() => startOnboarding(false), 4200);
      }
    } catch {}
  }

  function syncTitle() {
    try {
      const cur = document.title || "";
      if (!cur || cur.includes("Grok Bot") || cur.includes("Grok") || cur === "sand") {
        document.title = cur ? cur.replace(/Grok Bot D/g, 'grok"D"').replace(/Grok Bot/g, 'grok"D"') : 'grok"D"';
      }
    } catch (_) {}
  }

  function onBoot() {
    try { writeReady(); } catch (e) { try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[inject-boot] " + e + "\n"); } catch {} }
    // A stopped bot stays stopped across restarts unless the policy opts out.
    try {
      const m = pauseMod();
      if (m && m.applyStartupPolicy) {
        m.applyStartupPolicy().then((r) => {
          try {
            fs.appendFileSync("/tmp/grokbot-renderer.log",
              "[bot-pause] startup " + JSON.stringify(r) + "\n");
          } catch (_) {}
        }).catch(() => {});
      }
    } catch (_) {}
    syncTitle();
    injectSplash();
    inject();
    writeReady();
    try {
      const jobFile = path.join(RUNTIME, "continue-job.json");
      if (fs.existsSync(jobFile) && mode() === "local") {
        const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
        const text = String((job && job.text) || "");
        const id = job && job.agentId;
        if (text && id) {
          setTimeout(() => {
            try {
              const payload = JSON.stringify({ agentId: id, prompt: text, awaitTurn: false });
              const req = http.request({
                hostname: "127.0.0.1",
                port: 1337,
                path: "/api/sendPrompt",
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: AUTH,
                  "content-length": Buffer.byteLength(payload),
                },
                timeout: 8000,
              }, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  try { fs.unlinkSync(jobFile); } catch (_) {}
                }
              });
              req.on("error", () => {});
              req.write(payload);
              req.end();
            } catch (e) {
              try { fs.appendFileSync(path.join(ROOT, "runtime", "renderer.log"), "[continue-job] " + e + "\n"); } catch (_) {}
            }
          }, 2500);
        }
      }
    } catch (_) {}
    window.__grokd = {
      send: (text) => handleCommand({ id: "api", op: "send", text }),
      setModel: applyModel,
      status: () => handleCommand({ id: "api", op: "status" }),
      ensureBox: () => handleCommand({ id: "api", op: "ensure-box" }),
      loginClean,
    };
    ensureCursorComputer().catch((e) => {
      try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[ensure-box] " + e + "\n"); } catch (_) {}
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onBoot);
  else onBoot();
  if (window.__gdUiLoop) {
    try { clearInterval(window.__gdUiLoop); } catch (_) {}
  }
  window.__gdUiLoop = setInterval(() => {
    if (!document.body) return;
    try { syncTitle(); } catch {}
    try { restoreGorgeousUi(); } catch {}
    try { inject(); } catch {}
    try { writeReady(); } catch {}
    try { pollCommand(); } catch {}
    try { flushQueued(); } catch {}
    try { keepCursorComputer().catch(() => {}); } catch {}
    if (document.getElementById("grok-profile-veil")) {
      identity().then((s) => { if (s && s.kind === "logged-in") unveil(); }).catch(() => {});
    }
  }, 700);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      captureComposer();
      setTimeout(flushQueued, 60);
    }
  }, true);
  document.addEventListener("input", () => { captureComposer(); }, true);
})();
