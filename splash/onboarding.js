// grokD seat-in: walks a first-run user from splash → a working Local or Cursor seat.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokDOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE = "onboarding.json";
  const OPENBURNBAR_PORT = 8320;
  const LOCAL_PROXY_CHOICES = [
    {
      id: "openburnbar",
      name: "OpenBurnBar",
      port: 8320,
      description: "OpenAI-compatible npm gateway",
      badge: "Recommended",
      logo: "../assets/burnbar-mark.svg",
    },
    {
      id: "cliproxy",
      name: "CLI Proxy",
      port: 8322,
      description: "Direct local CLI bridge",
      logo: "../assets/cliproxy-mark.svg",
    },
    {
      id: "vibeproxy",
      name: "Vibe Proxy",
      port: 8325,
      description: "Alternate local route",
      logo: "../assets/vibeproxy-mark.svg",
    },
  ];

  function isOpenBurnBarHealthPayload(value, port) {
    return Boolean(
      value &&
      value.status === "ok" &&
      value.service === "openburnbar-proxy" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      value.port === (port ?? OPENBURNBAR_PORT)
    );
  }

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
        const accounts = (() => {
          try { return require(path.join(ROOT, "onboard-accounts.js")); } catch (_) { return null; }
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
            if (port === OPENBURNBAR_PORT) {
              try {
                const output = execFileSync("/usr/bin/curl", [
                  "--fail",
                  "--silent",
                  "--show-error",
                  "--max-time",
                  "1",
                  "--noproxy",
                  "*",
                  `http://127.0.0.1:${port}/health`,
                ], {
                  encoding: "utf8",
                  stdio: ["ignore", "pipe", "ignore"],
                  timeout: 1500,
                });
                return isOpenBurnBarHealthPayload(JSON.parse(output), port);
              } catch { return false; }
            }
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
          currentModel() { return models ? models.resolveConfig() : { model: "grok-4.6", proxyTarget: "openburnbar" }; },
          installOpenBurnBar(onFailure) {
            const inst = path.join(ROOT, "openburnbar-install.js");
            let info = { install: { proxy: "npx -y openburnbar proxy --port 8320 --allow-local-key" } };
            try { info = require(inst).info(); } catch (_) {}
            const child = spawn("npx", ["-y", "openburnbar", "proxy", "--port", "8320", "--allow-local-key"], { detached: true, stdio: "ignore" });
            const fail = (error, log) => {
              if (log) process.stderr.write("Could not start OpenBurnBar proxy: " + error.message + "\n");
              if (typeof onFailure === "function") onFailure(error);
            };
            child.once("error", (error) => fail(error, true));
            child.once("exit", (code, signal) => {
              const detail = signal ? ` (${signal})` : ` (exit ${code})`;
              fail(new Error("OpenBurnBar exited before it became ready" + detail), false);
            });
            child.unref();
            return info;
          },
          seats() {
            if (store && store.detectedCursorProfiles) return store.detectedCursorProfiles();
            return [];
          },
          switchTo(id) {
            const sw = path.join(ROOT, "switch-profile.js");
            const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" });
            spawn(process.execPath, [sw, "switch", id], { detached: true, stdio: "ignore", env }).unref();
          },
          addSignIn() {
            if (store && accounts) {
              const p = accounts.addSignInProfile(store);
              return p.id;
            }
            const name = accounts ? accounts.nextSignInName([]) : "My Cursor";
            const sw = path.join(ROOT, "switch-profile.js");
            const out = execFileSync(process.execPath, [sw, "add", "--name", name, "--kind", "cursor"], {
              encoding: "utf8",
              timeout: 15000,
              env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
            });
            const j = JSON.parse(out.trim().split("\n").pop());
            return j.id;
          },
          snapshotCurrent() {
            const sw = require(path.join(ROOT, "switch-profile.js"));
            const p = store && store.getActive();
            if (!p) return null;
            return sw.snapshot(p);
          },
          renameProfile(id, name) {
            if (store && store.rename) return store.rename(id, name);
            return null;
          },
          listedCursor() {
            if (!store) return [];
            return store.list().filter((p) => p.kind === "cursor");
          },
          importSeat(id) {
            if (store && store.importDetected) return store.importDetected(id).id;
            return id;
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
      _openBurnBarInstalled: false,
      portUp(port) {
        return port === 1337 ||
          port === 8322 ||
          (port === OPENBURNBAR_PORT && this._openBurnBarInstalled);
      },
      startBox() {},
      setProxy(target, model) { return { proxyTarget: target, model: model || "grok-4.6" }; },
      models() {
        return [
          { id: "grok-4.6", name: "Grok 4.6" },
          { id: "claude-opus-5", name: "Claude Opus 5" },
          { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
        ];
      },
      currentModel() { return { model: "grok-4.6", proxyTarget: "openburnbar" }; },
      installOpenBurnBar() {
        this._openBurnBarInstalled = true;
        return {
          npmProxy: true,
          install: { proxy: "npx -y openburnbar proxy --port 8320 --allow-local-key" },
        };
      },
      seats() { return [{ id: "cursor-a", name: "Grok A", seat: "A" }]; },
      switchTo() {},
      _signIns: 0,
      addSignIn() {
        this._signIns += 1;
        return this._signIns === 1 ? "my-cursor" : "my-cursor-" + this._signIns;
      },
      snapshotCurrent() { return true; },
      renameProfile() { return null; },
      listedCursor() { return []; },
      importSeat(id) { return id; },
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
      cursorProfiles: [],
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
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Set up Grok D");
    root.setAttribute("aria-describedby", "gd-lede");
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
          <p class="gd-note" id="gd-note" role="status" aria-live="polite"></p>
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

    function acc() {
      try {
        if (typeof require === "function") {
          const path = require("path");
          const os = require("os");
          const root = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
          return require(path.join(root, "onboard-accounts.js"));
        }
      } catch (_) {}
      return {
        alreadyIds: (s) => {
          const ids = [];
          (s.cursorProfiles || []).forEach((x) => { if (x && x.id) ids.push(x.id); });
          if (s.cursorProfile && ids.indexOf(s.cursorProfile) < 0) ids.push(s.cursorProfile);
          return ids;
        },
        remember: (s, entry) => {
          const list = (s.cursorProfiles || []).slice();
          const i = list.findIndex((x) => x && x.id === entry.id);
          if (i >= 0) list[i] = Object.assign({}, list[i], entry);
          else list.push(entry);
          return Object.assign({}, s, { cursorProfiles: list, cursorProfile: entry.id });
        },
        unusedImports: (detected, added) => {
          const have = {};
          (added || []).forEach((id) => { have[id] = true; });
          return (detected || []).filter((s) => s && s.id && !have[s.id]);
        },
        displayName: (st, fb) => (st && (st.email || st.name)) || fb || "Cursor",
      };
    }

    function keepAccount(entry) {
      const next = acc().remember(state, entry);
      state.cursorProfiles = next.cursorProfiles;
      state.cursorProfile = next.cursorProfile;
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
      root.querySelector("#gd-lede").textContent = "Pick how this copy of grok\"D\" talks. Cursor can take more than one login. You can change it later with the orbs.";
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
      cursor.innerHTML = "<em>Cursor</em><span>Sign in with one or more Cursor accounts, or import a Grok Bot already on this Mac.</span>";
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
      root.querySelector("#gd-kicker").textContent = "This Mac · routing";
      root.querySelector("#gd-title").textContent = "Choose your gateway";
      root.querySelector("#gd-lede").textContent = "Pick the local bridge D should use. OpenBurnBar is the recommended default and installs from npm.";
      const up = probe();
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-proxy-grid");
      LOCAL_PROXY_CHOICES.forEach((choice) => {
        const { id, name, port, description, badge, logo } = choice;
        const ok = up[id];
        const row = el("div", "gd-proxy-choice" + (id === "openburnbar" ? " is-primary" : ""));
        row.dataset.proxy = id;

        const identity = el("div", "gd-proxy-identity");
        const mark = el("span", "gd-proxy-logo");
        const image = document.createElement("img");
        image.src = logo;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        mark.appendChild(image);

        const copy = el("div", "gd-proxy-copy");
        if (badge) copy.appendChild(el("span", "gd-proxy-badge", badge));
        copy.appendChild(el("strong", "", name));
        copy.appendChild(el("small", "", description));
        identity.appendChild(mark);
        identity.appendChild(copy);

        const controls = el("div", "gd-proxy-controls");
        const endpoint = el("code", "gd-proxy-port", "localhost:" + port);
        const pill = el("span", "gd-pill " + (ok ? "up" : "down"), ok ? "Ready" : "Offline");
        pill.setAttribute("aria-label", name + " is " + (ok ? "ready" : "offline"));
        const useLabel = id === "openburnbar" && !ok ? "Install & use" : "Use " + name;
        const use = btn(useLabel, id === "openburnbar" ? "gd-go" : "gd-ghost", () => {
          const select = () => {
            try { h.setProxy(id, state.model); } catch (e) { note(String(e.message || e), "bad"); return; }
            state.proxyTarget = id;
            go("local-model");
          };
          if (id === "openburnbar" && !ok && h.installOpenBurnBar) {
            let launchError = null;
            let launchReady = false;
            try {
              h.installOpenBurnBar((error) => { if (!launchReady) launchError = error; });
            } catch (e) {
              note(String(e.message || e), "bad");
              return;
            }
            use.disabled = true;
            use.textContent = "Starting…";
            row.setAttribute("aria-busy", "true");
            note("Starting the OpenBurnBar npm gateway on :8320. The first npx run can take a moment.", "");
            const deadline = Date.now() + 30000;
            const waitForReady = () => {
              if (state.step !== "local-proxy") return;
              if (launchError) {
                use.disabled = false;
                use.textContent = "Try again";
                row.removeAttribute("aria-busy");
                note(String(launchError.message || launchError), "bad");
                return;
              }
              if (h.portUp(h.ports.openburnbar)) {
                launchReady = true;
                select();
                return;
              }
              if (Date.now() >= deadline) {
                use.disabled = false;
                use.textContent = "Try again";
                row.removeAttribute("aria-busy");
                note(
                  "OpenBurnBar did not start. Run npx -y openburnbar proxy --port 8320 --allow-local-key in Terminal to see the error.",
                  "bad"
                );
                return;
              }
              setTimeout(waitForReady, 500);
            };
            setTimeout(waitForReady, 250);
            return;
          }
          select();
        });
        use.classList.add("gd-proxy-button");
        controls.appendChild(endpoint);
        controls.appendChild(pill);
        controls.appendChild(use);
        row.appendChild(identity);
        row.appendChild(controls);
        list.appendChild(row);
      });
      body.appendChild(list);
      if (!up.openburnbar) {
        note("OpenBurnBar is offline. You can also start it in Terminal: npx -y openburnbar proxy --port 8320 --allow-local-key", "");
      }
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
        btn("Add Cursor accounts", "gd-ghost", () => {
          if (state.path === "local") state.path = "both";
          go("cursor-source");
        }),
        btn("Back", "gd-ghost", () => go("local-model")),
      ]);
      note(up.box ? "Composer should send without a reconnect banner." : "If send queues, tap Start this Mac again from the previous step.", up.box ? "good" : "");
    }

    function renderCursorSource() {
      setBead(0.35);
      const helpers = acc();
      const added = helpers.alreadyIds(state);
      const n = (state.cursorProfiles || []).length;
      root.querySelector("#gd-kicker").textContent = n ? "Cursor · another" : "Cursor · who";
      root.querySelector("#gd-title").textContent = n ? "Add another account" : "Use whose Cursor?";
      root.querySelector("#gd-lede").textContent = n
        ? n + " already in. Import another Grok Bot, or sign in with a different Cursor account."
        : "Import a Grok Bot already signed in on this Mac, or sign in here. You can add more than one.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      (state.cursorProfiles || []).forEach((p) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = p.name || p.id;
        left.querySelector("small").textContent = p.source === "import" ? "Imported · kept" : "Signed in · kept";
        row.appendChild(left);
        row.appendChild(el("span", "gd-pill up", "in"));
        list.appendChild(row);
      });
      const seats = helpers.unusedImports(h.seats(), added);
      seats.forEach((s) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = "Import " + s.name;
        left.querySelector("small").textContent = "Copies that login into D. Does not change the other app.";
        const use = btn("Import", "gd-ghost", () => applyCursor(s.id, {
          name: s.name,
          source: "import",
        }));
        row.appendChild(left);
        row.appendChild(use);
        list.appendChild(row);
      });
      const own = el("div", "gd-row");
      own.innerHTML = n
        ? "<div><strong>Sign in with another account</strong><small>Opens a fresh Cursor login. Each account becomes its own seat.</small></div>"
        : "<div><strong>Sign in here</strong><small>No other Grok Bot required. Cursor will ask you to log in. You can add more after.</small></div>";
      own.appendChild(btn("Sign in", "gd-ghost", () => {
        try {
          const id = h.addSignIn();
          applyCursor(id, { name: "New Cursor", source: "signin" });
        } catch (e) {
          note(String(e.message || e), "bad");
        }
      }));
      list.appendChild(own);
      body.appendChild(list);
      const back = n ? "cursor-ready" : (state.path === "both" ? "local-ready" : "choose");
      const acts = [btn("Back", "gd-ghost", () => go(back)), btn("Skip", "gd-skip", skip)];
      if (n) acts.unshift(btn("Done · " + n + " in", "gd-go", () => go("cursor-ready")));
      actions(acts);
      if (!seats.length && !n) note("No other Grok Bot logins found. Sign in here.");
    }

    function applyCursor(id, meta) {
      try {
        if (meta && meta.source === "import" && h.importSeat) id = h.importSeat(id);
      } catch (e) {
        note(String(e.message || e), "bad");
        return;
      }
      keepAccount({
        id,
        name: (meta && meta.name) || id,
        source: (meta && meta.source) || "signin",
      });
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
          try { if (h.snapshotCurrent) h.snapshotCurrent(); } catch (e) { note(String(e.message || e), "bad"); }
          const label = acc().displayName(s, state.cursorProfile);
          try { if (h.renameProfile && state.cursorProfile) h.renameProfile(state.cursorProfile, label); } catch (_) {}
          keepAccount({
            id: state.cursorProfile,
            name: label,
            source: ((state.cursorProfiles || []).find((x) => x.id === state.cursorProfile) || {}).source || "signin",
            email: s.email || "",
          });
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
      const list = state.cursorProfiles || [];
      const n = list.length || (state.cursorProfile ? 1 : 0);
      root.querySelector("#gd-kicker").textContent = "Cursor · ready";
      root.querySelector("#gd-title").textContent = n > 1 ? n + " accounts are in" : "You're in";
      root.querySelector("#gd-lede").textContent = n > 1
        ? "Each login is its own seat. Add another, or enter D."
        : "This seat is using your Cursor login. Add another account if you have one, or enter D.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      if (list.length) {
        const wrap = el("div", "gd-list");
        list.forEach((p) => {
          const row = el("div", "gd-row");
          const left = document.createElement("div");
          left.innerHTML = `<strong></strong><small></small>`;
          left.querySelector("strong").textContent = p.name || p.id;
          left.querySelector("small").textContent = p.email
            ? p.email
            : (p.source === "import" ? "Imported" : "Signed in");
          row.appendChild(left);
          row.appendChild(el("span", "gd-pill up", "in"));
          wrap.appendChild(row);
        });
        body.appendChild(wrap);
      }
      actions([
        btn("Enter D", "gd-go", finish),
        btn("Add another account", "gd-ghost", () => go("cursor-source")),
      ]);
    }

    function render() {
      note("");
      const step = state.step || "choose";
      root.dataset.step = step;
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

  return { start, shouldShow, markSplashSeen, host, blank, isOpenBurnBarHealthPayload };
});
