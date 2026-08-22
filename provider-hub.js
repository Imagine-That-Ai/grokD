// OpenBurnBar Provider Hub — liquid-glass subscription & key manager for Grok "D"
// Consumes the app's --gdg-* glass tokens (glass-theme.js) so it matches every
// other surface and flips with light mode. Exports { renderProviderModal, triggerOAuth }.
"use strict";

(function () {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

  const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  const CONFIG_PATH = path.join(ROOT, "model-config.json");
  const HUB = "http://127.0.0.1:8320";

  function readConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {}
    return {};
  }

  function saveConfig(patch) {
    try {
      const cur = readConfig();
      const next = { ...cur, ...patch };
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
      return next;
    } catch (e) {
      console.error("[provider-hub] saveConfig error:", e);
      return readConfig();
    }
  }

  // Renderer pages sit on remote/file origins; browser fetch to 127.0.0.1 gets
  // killed as mixed content. We're loaded via require(), so Node's http is
  // right here — use it for every loopback call. No CORS. No mixed content.
  function hubFetch(url, opts = {}) {
    const nodeHttp = require("http");
    const timeoutMs = opts.timeoutMs || 2500;
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(url); } catch (e) { return reject(e); }
      const req = nodeHttp.request({
        hostname: u.hostname,
        port: Number(u.port) || 80,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: { "content-type": "application/json", ...(opts.headers || {}) },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try { json = JSON.parse(text || "{}"); } catch {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text, json });
        });
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { timedOut: true })));
      req.on("error", reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  async function triggerOAuth(provider) {
    try {
      const r = await hubFetch(`${HUB}/api/oauth/login`, { method: "POST", body: JSON.stringify({ provider }) });
      return r.json || { ok: false };
    } catch (e) {
      console.error("[provider-hub] OAuth trigger error:", e);
      return { ok: false, error: e.message };
    }
  }

  // ---- providers -----------------------------------------------------------
  const PROVIDERS = [
    { id: "openrouter", name: "OpenRouter", sub: "Every model · free tier included", brand: "#6c7bff", oauth: true,
      glyph: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.8v16.4M3.8 12h16.4" stroke="currentColor" stroke-width="2"/></svg>' },
    { id: "openai", name: "ChatGPT", sub: "Plus & Pro via Codex login", brand: "#19c39c", oauth: true,
      glyph: '<svg viewBox="0 0 24 24"><path d="M12 4.5a5 5 0 0 1 4.9 4 4.4 4.4 0 0 1-1.2 8.6H8.3A4.4 4.4 0 0 1 7.1 8.5 5 5 0 0 1 12 4.5Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
    { id: "claude", name: "Claude", sub: "Pro & Team · native messages API", brand: "#f08057", oauth: true,
      glyph: '<svg viewBox="0 0 24 24"><path d="M6 18 12 5l6 13M8.6 13.6h6.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { id: "xai", name: "xAI Grok", sub: "Grok subscription · x.ai", brand: "#e8e8ee", oauth: true,
      glyph: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M12 10.4 17.6 5M12 10.4 6.4 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
    { id: "deepseek", name: "DeepSeek", sub: "chat · reasoner", brand: "#5b8cff", oauth: false,
      glyph: '<svg viewBox="0 0 24 24"><path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5Zm0 4.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6Z" fill="currentColor"/></svg>' },
    { id: "gemini", name: "Gemini", sub: "Flash & Pro · Google AI", brand: "#8ab4ff", oauth: false,
      glyph: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z" fill="currentColor"/></svg>' },
  ];
  // MiniMax keeps parity with the proxy's PROVIDER_DEFAULTS.
  PROVIDERS.push({ id: "minimax", name: "MiniMax", sub: "Text-01 · abab", brand: "#ff5c72", oauth: false,
    glyph: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 12h7M12 8.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' });

  const maskOf = (v) => (!v ? "" : v.length > 8 ? `${v.slice(0, 4)}•••${v.slice(-3)}` : "•••");
  const connected = (cfg, p) => Boolean(cfg.providers?.[p]?.apiKey || cfg[p === "claude" ? "anthropicApiKey" : `${p}ApiKey`]);

  // ---- styles --------------------------------------------------------------
  function css() {
    return `
    #grok-provider-hub-modal{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;
      background:rgba(4,4,10,.42);backdrop-filter:blur(26px) saturate(150%);-webkit-backdrop-filter:blur(26px) saturate(150%);
      opacity:0;transition:opacity .32s cubic-bezier(.16,1,.3,1);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
    #grok-provider-hub-modal.gd-on{opacity:1}
    #grok-provider-hub-modal .gd-panel{position:relative;width:min(720px,94vw);max-height:86vh;display:flex;flex-direction:column;
      border-radius:26px;border:1px solid var(--gdg-border,rgba(255,255,255,.16));
      background:var(--gdg-shell,linear-gradient(168deg,rgba(255,255,255,.10),rgba(255,255,255,.024) 36%,rgba(10,10,18,.62) 76%,rgba(4,4,8,.84)));
      box-shadow:var(--gdg-bevel,inset 0 1px 0 rgba(255,255,255,.22)),var(--gdg-sink,inset 0 -8px 22px rgba(0,0,0,.46)),var(--gdg-lift,0 28px 70px rgba(0,0,0,.82));
      color:var(--gdg-text,rgba(255,255,255,.94));overflow:hidden;
      transform:translateY(14px) scale(.96);transition:transform .42s cubic-bezier(.16,1,.3,1)}
    #grok-provider-hub-modal.gd-on .gd-panel{transform:none}
    #grok-provider-hub-modal .gd-panel::before{content:"";position:absolute;inset:0 0 auto;height:1px;pointer-events:none;
      background:linear-gradient(90deg,transparent 4%,rgba(255,255,255,.5) 50%,transparent 96%);opacity:.55}
    #grok-provider-hub-modal .gd-head{display:flex;align-items:center;gap:13px;padding:20px 22px 16px}
    #grok-provider-hub-modal .gd-mark{width:38px;height:38px;border-radius:13px;flex:0 0 auto;display:grid;place-items:center;
      background:radial-gradient(140% 160% at 30% 10%,rgba(255,176,88,.85),rgba(158,52,10,.92) 70%);border:1px solid rgba(255,190,120,.35);
      box-shadow:inset 0 1px 0 rgba(255,220,170,.55),0 6px 18px rgba(180,70,10,.45)}
    #grok-provider-hub-modal .gd-mark svg{width:21px;height:21px;color:#ffe9d2}
    #grok-provider-hub-modal .gd-title{font-size:16px;font-weight:750;letter-spacing:-.01em;line-height:1.15}
    #grok-provider-hub-modal .gd-sub{font-size:11.5px;color:var(--gdg-text-dim,rgba(255,255,255,.56));margin-top:2px}
    #grok-provider-hub-modal .gd-pill{margin-left:auto;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;
      border:1px solid var(--gdg-border,rgba(255,255,255,.16));background:var(--gdg-chip,rgba(16,16,28,.6));font-size:10.5px;font-weight:650;
      letter-spacing:.04em;text-transform:uppercase;color:var(--gdg-text-dim,rgba(255,255,255,.56))}
    #grok-provider-hub-modal .gd-led{width:7px;height:7px;border-radius:99px;background:#8b90a0;box-shadow:0 0 0 0 transparent}
    #grok-provider-hub-modal .gd-pill.ok .gd-led{background:#43d17c;box-shadow:0 0 9px rgba(67,209,124,.9);animation:gd-pulse 2.2s ease-out infinite}
    #grok-provider-hub-modal .gd-pill.warn .gd-led{background:#ffb347;box-shadow:0 0 9px rgba(255,179,71,.85)}
    #grok-provider-hub-modal .gd-pill.down .gd-led{background:#ff6b6b;box-shadow:0 0 9px rgba(255,107,107,.85)}
    @keyframes gd-pulse{0%{box-shadow:0 0 0 0 rgba(67,209,124,.55)}70%{box-shadow:0 0 0 8px rgba(67,209,124,0)}100%{box-shadow:0 0 0 0 rgba(67,209,124,0)}}
    #grok-provider-hub-modal .gd-body{padding:2px 22px 18px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}
    #grok-provider-hub-modal .gd-body::-webkit-scrollbar{width:5px}
    #grok-provider-hub-modal .gd-body::-webkit-scrollbar-thumb{border-radius:99px;background:rgba(255,255,255,.18)}
    #grok-provider-hub-modal .gd-label{font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
      color:var(--gdg-text-dim,rgba(255,255,255,.56));margin:16px 2px 9px}
    #grok-provider-hub-modal .gd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
    #grok-provider-hub-modal .gd-card{position:relative;padding:13px 14px;border-radius:18px;border:1px solid var(--gdg-border,rgba(255,255,255,.14));
      background:var(--gdg-chip,radial-gradient(150% 170% at 28% 8%,rgba(255,255,255,.13),rgba(16,16,28,.66)));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.14);transition:transform .24s cubic-bezier(.16,1,.3,1),border-color .24s,box-shadow .24s}
    #grok-provider-hub-modal .gd-card:hover{transform:translateY(-2px);border-color:${"rgba(255,255,255,.3)"};box-shadow:inset 0 1px 0 rgba(255,255,255,.24),0 10px 26px rgba(0,0,0,.42)}
    #grok-provider-hub-modal .gd-card.on{border-color:color-mix(in srgb,var(--brand) 55%,transparent);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 0 0 1px color-mix(in srgb,var(--brand) 32%,transparent),0 8px 26px -8px var(--brand)}
    #grok-provider-hub-modal .gd-crow{display:flex;align-items:center;gap:10px}
    #grok-provider-hub-modal .gd-glyph{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;
      color:var(--brand);background:color-mix(in srgb,var(--brand) 14%,transparent);border:1px solid color-mix(in srgb,var(--brand) 30%,transparent)}
    #grok-provider-hub-modal .gd-glyph svg{width:16px;height:16px}
    #grok-provider-hub-modal .gd-name{font-size:13px;font-weight:700}
    #grok-provider-hub-modal .gd-desc{font-size:10.5px;color:var(--gdg-text-dim,rgba(255,255,255,.56));margin-top:1px}
    #grok-provider-hub-modal .gd-state{display:flex;align-items:center;justify-content:space-between;margin-top:11px;min-height:24px}
    #grok-provider-hub-modal .gd-dotrow{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:650;color:var(--gdg-text-dim)}
    #grok-provider-hub-modal .gd-card.on .gd-dotrow{color:var(--brand)}
    #grok-provider-hub-modal .gd-dotrow i{width:5px;height:5px;border-radius:99px;background:currentColor;display:inline-block}
    #grok-provider-hub-modal .gd-btn{border:1px solid var(--gdg-border,rgba(255,255,255,.2));cursor:pointer;color:inherit;
      font-size:11px;font-weight:700;font-family:inherit;padding:5px 12px;border-radius:999px;background:var(--gdg-chip,rgba(16,16,28,.6));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.18);transition:transform .18s cubic-bezier(.16,1,.3,1),border-color .18s,filter .18s}
    #grok-provider-hub-modal .gd-btn:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.44)}
    #grok-provider-hub-modal .gd-btn:active{transform:scale(.96)}
    #grok-provider-hub-modal .gd-btn.brand{border-color:color-mix(in srgb,var(--brand) 55%,transparent);color:var(--brand)}
    #grok-provider-hub-modal .gd-keyrow{display:flex;align-items:center;gap:9px;padding:8px 12px;border-radius:14px;
      border:1px solid var(--gdg-field-border,rgba(255,255,255,.12));background:rgba(8,8,16,.28);margin-bottom:7px}
    #grok-provider-hub-modal input.gd-in{flex:1;min-width:0;background:transparent;border:none;outline:none;color:inherit;
      font:500 12px/1.5 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.02em}
    #grok-provider-hub-modal input.gd-in::placeholder{color:var(--gdg-text-dim,rgba(255,255,255,.36));font-family:inherit}
    #grok-provider-hub-modal .gd-engines{display:flex;flex-direction:column;gap:7px}
    #grok-provider-hub-modal .gd-engine{display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:14px;
      border:1px dashed var(--gdg-field-border,rgba(255,255,255,.14));font-size:11.5px;color:var(--gdg-text-dim)}
    #grok-provider-hub-modal .gd-engine.up{border-style:solid;color:var(--gdg-text,rgba(255,255,255,.94))}
    #grok-provider-hub-modal .gd-foot{display:flex;align-items:center;padding:13px 22px 16px;border-top:1px solid var(--gdg-field-border,rgba(255,255,255,.09))}
    #grok-provider-hub-modal a.gd-link{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:650;color:#ffb37a;
      text-decoration:none;padding:5px 11px;border-radius:999px;border:1px solid rgba(255,179,122,.3);background:rgba(255,140,60,.08)}
    #grok-provider-hub-modal a.gd-link:hover{filter:brightness(1.15)}
    #grok-provider-hub-modal .gd-ver{margin-left:auto;font-size:10px;color:var(--gdg-text-dim);letter-spacing:.05em}
    #grok-provider-hub-modal .gd-x{position:absolute;top:14px;right:14px;width:27px;height:27px;border-radius:99px;display:grid;place-items:center;
      cursor:pointer;color:var(--gdg-text-dim);border:1px solid var(--gdg-border,rgba(255,255,255,.16));background:var(--gdg-chip,rgba(16,16,28,.55));
      transition:transform .18s,color .18s;z-index:2}
    #grok-provider-hub-modal .gd-x:hover{transform:rotate(90deg);color:var(--gdg-text)}
    #grok-provider-hub-modal .gd-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(8px);padding:9px 17px;
      border-radius:999px;font-size:12px;font-weight:600;color:var(--gdg-text,#fff);background:rgba(14,14,24,.86);
      border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(18px);opacity:0;transition:all .3s cubic-bezier(.16,1,.3,1);z-index:1000001;pointer-events:none}
    #grok-provider-hub-modal .gd-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    @media (prefers-color-scheme:light){
      #grok-provider-hub-modal{background:rgba(240,240,248,.4)}
      #grok-provider-hub-modal .gd-keyrow{background:rgba(255,255,255,.5)}
    }`;
  }

  function toast(msg) {
    let t = document.querySelector(".gd-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "gd-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => t && t.classList.remove("show"), 3200);
  }

  function ensureGlassTokens() {
    try {
      const probe = getComputedStyle(document.documentElement).getPropertyValue("--gdg-shell").trim();
      if (!probe) require(path.join(ROOT, "glass-theme.js")).start();
    } catch (_) {}
  }

  // ---- live status ---------------------------------------------------------
  async function alive(url) {
    try { const r = await hubFetch(url, { timeoutMs: 1600 }); return r.ok; } catch {}
    return false;
  }

  async function pollGateway(pill) {
    const set = (cls, txt) => { pill.className = `gd-pill ${cls}`; pill.querySelector("span:last-child").textContent = txt; };
    if (await alive(`${HUB}/api/openburnbar-identity`)) return set("ok", "Gateway live");
    if (await alive(`http://127.0.0.1:8330/api/openburnbar-identity`)) return set("warn", "Fallback :8330");
    set("down", "Gateway down");
  }

  async function probeEngines(host) {
    for (const el of host.querySelectorAll(".gd-engine[data-port]")) {
      const port = el.dataset.port;
      try {
        const url = port === "11434" ? `http://127.0.0.1:11434/api/tags` : `http://127.0.0.1:${port}/v1/models`;
        const r = await hubFetch(url, { timeoutMs: 1400 });
        if (!r.ok) throw 0;
        const n = (r.json.models || r.json.data || []).length;
        el.classList.add("up");
        el.querySelector(".gd-eng-note").textContent = n ? `${n} model${n === 1 ? "" : "s"} detected` : "reachable";
      } catch {
        el.querySelector(".gd-eng-note").textContent = "not detected · run it to auto-connect";
      }
    }
  }

  function watchConnection(providerId, card, deadline) {
    const iv = setInterval(async () => {
      if (Date.now() > deadline || !card.isConnected) return clearInterval(iv);
      try {
        const r = await hubFetch(`${HUB}/api/providers`, { timeoutMs: 1500 });
        if (r.json && r.json.config) paintCard(card, providerId, r.json.config);
      } catch {}
    }, 3000);
  }

  function paintCard(card, p, cfg) {
    const on = connected(cfg, p);
    card.classList.toggle("on", on);
    const dotrow = card.querySelector(".gd-dotrow");
    const btn = card.querySelector(".gd-btn");
    if (on) {
      const key = cfg.providers?.[p]?.apiKey || cfg[p === "claude" ? "anthropicApiKey" : `${p}ApiKey`] || "";
      dotrow.innerHTML = `<i></i>Connected ${key && key.includes("•") ? `· ${maskOf(key)}` : ""}`;
      if (btn && !btn.dataset.keep) { btn.textContent = "Refresh"; btn.dataset.mode = "refresh"; }
    } else {
      dotrow.innerHTML = `<i></i>Not linked`;
      if (btn && !btn.dataset.keep) { btn.textContent = p.oauth ? "Login" : "Add key"; btn.dataset.mode = p.oauth ? "login" : "key"; }
    }
  }

  // ---- render --------------------------------------------------------------
  function renderProviderModal() {
    ensureGlassTokens();
    document.getElementById("grok-provider-hub-modal")?.remove();

    const cfg = readConfig();
    const modal = document.createElement("div");
    modal.id = "grok-provider-hub-modal";
    modal.innerHTML = `
      <style>${css()}</style>
      <div class="gd-panel">
        <div class="gd-x" title="Close">
          <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div class="gd-head">
          <div class="gd-mark">
            <svg viewBox="0 0 24 24"><path d="M12 3c1 3.2-.8 4.9-2.3 6.5C8 11.3 7 13 7 15a5 5 0 0 0 10 0c0-1.9-.8-3.4-1.7-4.7-.5 1-1.2 1.8-2.3 2.2.6-2.9-.4-6.6-1-9.5Z" fill="currentColor"/></svg>
          </div>
          <div>
            <div class="gd-title">Provider Hub</div>
            <div class="gd-sub">One gateway on :8320 · your subscriptions, keys & local engines</div>
          </div>
          <div class="gd-pill"><i class="gd-led"></i><span>Checking…</span></div>
        </div>
        <div class="gd-body">
          <div class="gd-label">Subscriptions</div>
          <div class="gd-cards">${PROVIDERS.map((p) => `
            <div class="gd-card" style="--brand:${p.brand}" data-pid="${p.id}">
              <div class="gd-crow">
                <div class="gd-glyph">${p.glyph}</div>
                <div><div class="gd-name">${p.name}</div><div class="gd-desc">${p.sub}</div></div>
              </div>
              <div class="gd-state">
                <span class="gd-dotrow"><i></i>…</span>
                <button type="button" class="gd-btn"></button>
              </div>
            </div>`).join("")}
          </div>
          <div class="gd-label">API Keys</div>
          <div class="gd-keys">
            ${PROVIDERS.map((p) => `
              <div class="gd-keyrow" data-kid="${p.id}">
                <span style="font-size:11px;font-weight:700;width:74px;color:var(--brand)">${p.name}</span>
                <input class="gd-in" type="password" autocomplete="off"
                  placeholder="${connected(cfg, p.id) ? "saved · type to replace" : p.id === "gemini" ? "AIzaSy…" : "sk-…"}"
                  value="">
                <button type="button" class="gd-btn" data-save="${p.id}">Save</button>
              </div>`).join("")}
          </div>
          <div class="gd-label">Local Engines</div>
          <div class="gd-engines">
            <div class="gd-engine" data-port="11434">🦙 Ollama · :11434 <span style="flex:1"></span><span class="gd-eng-note">checking…</span></div>
            <div class="gd-engine" data-port="1234">🧪 LM Studio · :1234 <span style="flex:1"></span><span class="gd-eng-note">checking…</span></div>
          </div>
        </div>
        <div class="gd-foot">
          <a class="gd-link" href="https://burnbar.app" target="_blank" rel="noopener">🔥 BurnBar Mac App ↗</a>
          <span class="gd-ver">OPENBURNBAR · GATEWAY :8320</span>
        </div>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("gd-on"));

    const close = () => {
      modal.classList.remove("gd-on");
      setTimeout(() => modal.remove(), 340);
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    modal.querySelector(".gd-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);

    const pill = modal.querySelector(".gd-pill");
    pollGateway(pill);
    const body = modal.querySelector(".gd-body");
    body.querySelectorAll(".gd-card").forEach((card) => paintCard(card, card.dataset.pid, cfg));
    probeEngines(body);

    // OAuth / refresh buttons
    modal.querySelectorAll(".gd-card").forEach((card) => {
      const pid = card.dataset.pid;
      const meta = PROVIDERS.find((x) => x.id === pid);
      const btn = card.querySelector(".gd-btn");
      btn.addEventListener("click", async () => {
        if (btn.dataset.mode === "key") {
          card.querySelector(".gd-keyrow input")?.focus();
          toast(`${meta.name}: paste the key below, then Save`);
          return;
        }
        btn.disabled = true;
        btn.textContent = "Opening…";
        const r = await triggerOAuth(pid);
        btn.disabled = false;
        if (!r || r.ok === false) {
          toast(r?.error === "cliproxyapi binary not found"
            ? "Install CLIProxy (brew install cliproxyapi) for subscription logins"
            : `Could not start ${meta.name} login`);
          return;
        }
        toast(`${meta.name} login opened in browser — finish it there`);
        watchConnection(pid, card, Date.now() + 90000);
      });
    });

    // Key saves
    modal.querySelectorAll("[data-save]").forEach((b) => {
      b.addEventListener("click", () => {
        const pid = b.dataset.save;
        const input = b.closest(".gd-keyrow").querySelector("input");
        const val = (input.value || "").trim();
        if (!val) { toast("Paste a key first"); return; }
        const meta = PROVIDERS.find((x) => x.id === pid);
        const topLevel = pid === "claude" ? "anthropicApiKey" : `${pid}ApiKey`;
        const cur = readConfig();
        saveConfig({
          [topLevel]: val,
          providers: { ...(cur.providers || {}), [pid]: { ...(cur.providers?.[pid] || {}), enabled: true, apiKey: val, savedAt: Date.now() } },
        });
        input.value = "";
        input.placeholder = "saved · type to replace";
        toast(`${meta.name} key saved · gateway hot-reloaded`);
        const card = modal.querySelector(`.gd-card[data-pid="${pid}"]`);
        if (card) paintCard(card, pid, readConfig());
      });
    });
  }

  module.exports = { renderProviderModal, triggerOAuth };
})();
