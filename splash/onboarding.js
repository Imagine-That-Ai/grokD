// grokD seat-in: walks a first-run user from splash → a working Local or Cursor seat.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokDOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE = "onboarding.json";

  function host() {
    if (typeof require === "function") {
      try {
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const { spawn, execFileSync } = require("child_process");
        const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
        const statePath = path.join(ROOT, FILE);
        let models = null;
        try { models = require(path.join(ROOT, "model-lib.js")); } catch (_) {}
        const store = (() => {
          try { return require(path.join(ROOT, "profile-store.js")); } catch (_) { return null; }
        })();
        return {
          demo: false,
          readState() {
            try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
            catch { return null; }
          },
          writeState(s) {
            fs.mkdirSync(ROOT, { recursive: true });
            fs.writeFileSync(statePath, JSON.stringify(s, null, 2) + "\n");
          },
          ports: { box: 1337, host: 1338, infer: 8787, cliproxy: 8322, openburnbar: 8320, vibeproxy: 8325 },
          portUp(port) {
            if (models && models.portOpen) return models.portOpen(port);
            try {
              execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore", timeout: 800 });
              return true;
            } catch { return false; }
          },
          startBox() {
            const sh = path.join(ROOT, "ensure-local-box.sh");
            if (!fs.existsSync(sh)) throw new Error("ensure-local-box.sh is missing");
            spawn("bash", [sh], { detached: true, stdio: "ignore" }).unref();
          },
          setProxy(target, model) {
            if (!models) throw new Error("model-lib missing");
            return models.setModel(model || models.resolveConfig().model, target);
          },
          models() { return (models && models.CURATED) || []; },
          currentModel() { return models ? models.resolveConfig() : { model: "grok-4.6", proxyTarget: "cliproxy" }; },
          seats() {
            if (store && store.detectedCursorProfiles) return store.detectedCursorProfiles();
            return [];
          },
          switchTo(id) {
            const sw = path.join(ROOT, "switch-profile.js");
            spawn(process.execPath, [sw, "switch", id], { detached: true, stdio: "ignore" }).unref();
          },
          addSignIn() {
            if (store) {
              const existing = store.list().find((p) => p.kind === "cursor" && !p.identitySource && !p.sourceUserData);
              if (existing) return existing.id;
            }
            const sw = path.join(ROOT, "switch-profile.js");
            const out = execFileSync(process.execPath, [sw, "add", "--name", "My Cursor", "--kind", "cursor"], {
              encoding: "utf8",
              timeout: 15000,
            });
            const j = JSON.parse(out.trim().split("\n").pop());
            return j.id;
          },
          cursorStatus() {
            try {
              if (typeof window !== "undefined" && window.desktop && window.desktop.cursorAccount) {
                return window.desktop.cursorAccount.getStatus();
              }
            } catch (_) {}
            return Promise.resolve({ kind: "unknown" });
          },
        };
      } catch (_) {}
    }
    return {
      demo: true,
      _s: null,
      readState() { return this._s; },
      writeState(s) { this._s = s; try { localStorage.setItem("gd-onboard", JSON.stringify(s)); } catch (_) {} },
      ports: { box: 1337, host: 1338, infer: 8787, cliproxy: 8322, openburnbar: 8320, vibeproxy: 8325 },
      portUp(port) { return port === 1337 || port === 8322; },
      startBox() {},
      setProxy(target, model) { return { proxyTarget: target, model: model || "grok-4.6" }; },
      models() {
        return [
          { id: "grok-4.6", name: "Grok 4.6" },
          { id: "claude-opus-5", name: "Claude Opus 5" },
          { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
        ];
      },
      currentModel() { return { model: "grok-4.6", proxyTarget: "cliproxy" }; },
      seats() { return [{ id: "cursor-b", name: "Grok B", seat: "B" }]; },
      switchTo() {},
      addSignIn() { return "my-cursor"; },
      cursorStatus() { return Promise.resolve({ kind: "logged-in", authId: "demo" }); },
    };
  }

  function blank() {
    return {
      version: 1,
      completed: false,
      skipped: false,
      seenSplash: false,
      path: null,
      step: "choose",
      proxyTarget: null,
      model: null,
      cursorProfile: null,
    };
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function start(opts) {
    if (typeof document === "undefined") return null;
    if (document.getElementById("gd-onboard")) return document.getElementById("gd-onboard").__api;
    const h = (opts && opts.host) || host();
    const state = Object.assign(blank(), h.readState() || {});
    if (opts && opts.force) {
      state.completed = false;
      state.skipped = false;
    }
    if (state.completed || state.skipped) return null;

    const root = el("div");
    root.id = "gd-onboard";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Set up Grok D");
    root.innerHTML = `
      <div class="gd-mesh"></div>
      <div class="gd-vignette"></div>
      <div class="gd-shell">
        <aside class="gd-hinge" aria-hidden="true">
          <div class="gd-pin"></div>
          <div class="gd-wire"></div>
          <div class="gd-bead" id="gd-bead"></div>
          <div class="gd-d">D</div>
          <div class="gd-mascot"></div>
        </aside>
        <section class="gd-panel">
          <div class="gd-kicker" id="gd-kicker">Seat in</div>
          <h1 id="gd-title"></h1>
          <p class="gd-lede" id="gd-lede"></p>
          <div id="gd-body"></div>
          <div class="gd-actions" id="gd-actions"></div>
          <p class="gd-note" id="gd-note"></p>
        </section>
      </div>
    `;
    document.body.appendChild(root);

    const api = { host: h, state, root, render, save, finish, skip };
    root.__api = api;

    function save() { h.writeState(state); }

    function note(msg, kind) {
      const n = root.querySelector("#gd-note");
      n.textContent = msg || "";
      n.className = "gd-note" + (kind ? " " + kind : "");
    }

    function setBead(t) {
      const bead = root.querySelector("#gd-bead");
      if (bead) bead.style.top = (12 + t * 62) + "%";
    }

    function skip() {
      state.skipped = true;
      save();
      dismiss();
    }

    function finish() {
      state.completed = true;
      state.step = "done";
      save();
      dismiss();
    }

    function dismiss() {
      root.style.transition = "opacity .45s ease, filter .45s ease";
      root.style.opacity = "0";
      root.style.filter = "blur(10px)";
      setTimeout(() => root.remove(), 480);
    }

    function go(step) {
      state.step = step;
      save();
      render();
    }

    function actions(nodes) {
      const wrap = root.querySelector("#gd-actions");
      wrap.innerHTML = "";
      nodes.forEach((n) => wrap.appendChild(n));
    }

    function btn(label, cls, fn) {
      const b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    }

    function probe() {
      const p = h.ports;
      return {
        box: h.portUp(p.box),
        host: h.portUp(p.host),
        infer: h.portUp(p.infer),
        cliproxy: h.portUp(p.cliproxy),
        openburnbar: h.portUp(p.openburnbar),
        vibeproxy: h.portUp(p.vibeproxy),
      };
    }

    function renderChoose() {
      setBead(0.08);
      root.querySelector("#gd-kicker").textContent = "After the slam";
      root.querySelector("#gd-title").textContent = "Who sits here?";
      root.querySelector("#gd-lede").textContent = "Pick how this copy of Grok D talks. You can change it later with the orbs.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const grid = el("div", "gd-choices");
      const local = el("button", "gd-seat");
      local.type = "button";
      local.dataset.kind = "local";
      local.innerHTML = "<em>This Mac</em><span>Bots stay on this computer. Next you start the local box and choose a proxy.</span>";
      local.addEventListener("click", () => {
        state.path = "local";
        go("local-box");
      });
      const cursor = el("button", "gd-seat");
      cursor.type = "button";
      cursor.dataset.kind = "cursor";
      cursor.innerHTML = "<em>Cursor</em><span>Sign in with your account, or import a Grok Bot already on this Mac.</span>";
      cursor.addEventListener("click", () => {
        state.path = "cursor";
        go("cursor-source");
      });
      grid.appendChild(local);
      grid.appendChild(cursor);
      body.appendChild(grid);
      actions([btn("I'll finish this later", "gd-skip", skip)]);
    }

    function renderLocalBox() {
      setBead(0.28);
      root.querySelector("#gd-kicker").textContent = "This Mac · computer";
      root.querySelector("#gd-title").textContent = "Start the local box";
      root.querySelector("#gd-lede").textContent = "D talks to a computer on this machine. These three listeners have to be up.";
      const up = probe();
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      [
        ["Shim :1337", "The door the app knocks on", up.box],
        ["Host :1338", "The actual local computer", up.host],
        ["Models :8787", "Where replies are routed", up.infer],
      ].forEach(([title, sub, ok]) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = title;
        left.querySelector("small").textContent = sub;
        const pill = el("span", "gd-pill " + (ok ? "up" : "down"), ok ? "listening" : "down");
        row.appendChild(left);
        row.appendChild(pill);
        list.appendChild(row);
      });
      body.appendChild(list);
      const ready = up.box && up.host;
      const start = btn(ready ? "Box is up — continue" : "Start this Mac", "gd-go", () => {
        if (ready) { go("local-proxy"); return; }
        try {
          h.startBox();
          note("Starting the local box…", "");
          start.disabled = true;
          setTimeout(() => { start.disabled = false; render(); }, 1600);
        } catch (e) {
          note(String(e.message || e), "bad");
        }
      });
      actions([start, btn("Back", "gd-ghost", () => go("choose")), btn("Skip", "gd-skip", skip)]);
      if (!ready) note("If Start does nothing, install Node and open D again.");
    }

    function renderLocalProxy() {
      setBead(0.5);
      root.querySelector("#gd-kicker").textContent = "This Mac · proxy";
      root.querySelector("#gd-title").textContent = "Where should answers come from?";
      root.querySelector("#gd-lede").textContent = "The local box asks one of these proxies for a model. Pick the one you actually run.";
      const up = probe();
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      const choices = [
        ["cliproxy", "CLI Proxy", ":8322", up.cliproxy],
        ["openburnbar", "OpenBurnBar", ":8320", up.openburnbar],
        ["vibeproxy", "Vibe Proxy", ":8325", up.vibeproxy],
      ];
      choices.forEach(([id, name, port, ok]) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = name;
        left.querySelector("small").textContent = port + (ok ? " · listening" : " · not running");
        const use = btn("Use this", "gd-ghost", () => {
          state.proxyTarget = id;
          try { h.setProxy(id, state.model); } catch (e) { note(String(e.message || e), "bad"); return; }
          go("local-model");
        });
        const pill = el("span", "gd-pill " + (ok ? "up" : "down"), ok ? "up" : "down");
        const right = document.createElement("div");
        right.style.display = "flex";
        right.style.gap = "8px";
        right.style.alignItems = "center";
        right.appendChild(pill);
        right.appendChild(use);
        row.appendChild(left);
        row.appendChild(right);
        list.appendChild(row);
      });
      body.appendChild(list);
      actions([btn("Back", "gd-ghost", () => go("local-box")), btn("Skip", "gd-skip", skip)]);
    }

    function renderLocalModel() {
      setBead(0.72);
      const cur = h.currentModel();
      root.querySelector("#gd-kicker").textContent = "This Mac · first model";
      root.querySelector("#gd-title").textContent = "First model";
      root.querySelector("#gd-lede").textContent = "This is what new chats use. You can change it any time from the model menu.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const chips = el("div", "gd-models");
      const list = h.models();
      const picked = state.model || cur.model;
      list.forEach((m) => {
        const c = el("button", "gd-chip", m.name);
        c.type = "button";
        c.setAttribute("aria-pressed", m.id === picked ? "true" : "false");
        c.addEventListener("click", () => {
          state.model = m.id;
          try { h.setProxy(state.proxyTarget || cur.proxyTarget, m.id); } catch (e) { note(String(e.message || e), "bad"); return; }
          render();
        });
        chips.appendChild(c);
      });
      body.appendChild(chips);
      actions([
        btn("Use " + (picked || "this model"), "gd-go", () => {
          state.model = picked;
          try { h.setProxy(state.proxyTarget || cur.proxyTarget, picked); } catch (e) { note(String(e.message || e), "bad"); return; }
          go("local-ready");
        }),
        btn("Back", "gd-ghost", () => go("local-proxy")),
      ]);
    }

    function renderLocalReady() {
      setBead(0.92);
      const cur = h.currentModel();
      const up = probe();
      root.querySelector("#gd-kicker").textContent = "This Mac · ready";
      root.querySelector("#gd-title").textContent = "This Mac is ready";
      root.querySelector("#gd-lede").textContent = "Local box " + (up.box ? "is listening" : "still starting") +
        ". Answers go through " + (state.proxyTarget || cur.proxyTarget) +
        " as " + (state.model || cur.model) + ".";
      root.querySelector("#gd-body").innerHTML = "";
      actions([
        btn("Enter D", "gd-go", finish),
        btn("Back", "gd-ghost", () => go("local-model")),
      ]);
      note(up.box ? "Composer should send without a reconnect banner." : "If send queues, tap Start this Mac again from the previous step.", up.box ? "good" : "");
    }

    function renderCursorSource() {
      setBead(0.35);
      root.querySelector("#gd-kicker").textContent = "Cursor · who";
      root.querySelector("#gd-title").textContent = "Use whose Cursor?";
      root.querySelector("#gd-lede").textContent = "Import a Grok Bot already signed in on this Mac, or sign in inside this app.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      const seats = h.seats();
      seats.forEach((s) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = "Import " + s.name;
        left.querySelector("small").textContent = "Copies that login into D. Does not change the other app.";
        const use = btn("Import", "gd-ghost", () => applyCursor(s.id));
        row.appendChild(left);
        row.appendChild(use);
        list.appendChild(row);
      });
      const own = el("div", "gd-row");
      own.innerHTML = "<div><strong>Sign in here</strong><small>No other Grok Bot required. Cursor will ask you to log in.</small></div>";
      own.appendChild(btn("Sign in", "gd-ghost", () => {
        try {
          const id = h.addSignIn();
          applyCursor(id);
        } catch (e) {
          note(String(e.message || e), "bad");
        }
      }));
      list.appendChild(own);
      body.appendChild(list);
      actions([btn("Back", "gd-ghost", () => go("choose")), btn("Skip", "gd-skip", skip)]);
      if (!seats.length) note("No other Grok Bot logins found. Sign in here.");
    }

    function applyCursor(id) {
      state.cursorProfile = id;
      state.step = "cursor-login";
      save();
      note("Opening that seat…", "");
      try { h.switchTo(id); } catch (e) { note(String(e.message || e), "bad"); return; }
      if (h.demo) {
        go("cursor-login");
        return;
      }
      renderCursorLogin();
    }

    function renderCursorLogin() {
      setBead(0.7);
      root.querySelector("#gd-kicker").textContent = "Cursor · sign in";
      root.querySelector("#gd-title").textContent = "Sign in when Cursor asks";
      root.querySelector("#gd-lede").textContent = "If a login window appears, finish it. D will notice when this seat is in.";
      root.querySelector("#gd-body").innerHTML = "";
      const check = btn("Check now", "gd-go", () => pollLogin(true));
      actions([check, btn("Back", "gd-ghost", () => go("cursor-source")), btn("Skip", "gd-skip", skip)]);
      pollLogin(false);
    }

    function pollLogin(manual) {
      note(manual ? "Checking…" : "Waiting for Cursor…");
      Promise.resolve(h.cursorStatus()).then((s) => {
        if (s && s.kind === "logged-in") {
          state.step = "cursor-ready";
          save();
          render();
          return;
        }
        note(s && s.kind === "logging-in" ? "Login is in progress." : "Not signed in yet.", "");
      }).catch((e) => note(String(e.message || e), "bad"));
    }

    function renderCursorReady() {
      setBead(0.92);
      root.querySelector("#gd-kicker").textContent = "Cursor · ready";
      root.querySelector("#gd-title").textContent = "You're in";
      root.querySelector("#gd-lede").textContent = "This seat is using your Cursor login. If the app still says the account has no access, wait for the computer to come up, or import a Grok Bot that already has one.";
      root.querySelector("#gd-body").innerHTML = "";
      actions([btn("Enter D", "gd-go", finish)]);
    }

    function render() {
      const step = state.step || "choose";
      if (step === "choose") renderChoose();
      else if (step === "local-box") renderLocalBox();
      else if (step === "local-proxy") renderLocalProxy();
      else if (step === "local-model") renderLocalModel();
      else if (step === "local-ready") renderLocalReady();
      else if (step === "cursor-source") renderCursorSource();
      else if (step === "cursor-login" || step === "cursor-apply") renderCursorLogin();
      else if (step === "cursor-ready") renderCursorReady();
      else renderChoose();
    }

    save();
    render();

    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") skip();
    });
    return api;
  }

  function shouldShow(h) {
    const hostApi = h || host();
    const s = Object.assign(blank(), hostApi.readState() || {});
    return !s.completed && !s.skipped;
  }

  function markSplashSeen() {
    const h = host();
    const s = Object.assign(blank(), h.readState() || {});
    s.seenSplash = true;
    h.writeState(s);
    return s;
  }

  return { start, shouldShow, markSplashSeen, host, blank };
});
