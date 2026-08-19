"use strict";
// Main-process hook: clean-browser login + seed this seat's computer from a descriptor.
try {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { app, shell, safeStorage } = require("electron");
  const home = os.homedir();
  const ROOT = path.join(home, ".grok", "grokbot-d");
  const login = require(path.join(ROOT, "browser-login.js"));
  const box = require(path.join(ROOT, "box-state.js"));

  try {
    // Process name must stay "Grok Bot" so official tokens decrypt
    // (keychain: "Grok Bot Safe Storage"). Window + dock say grok"D".
    app.setName("Grok Bot");
    app.name = "Grok Bot";
    const { BrowserWindow } = require("electron");
    const updateTitle = (win) => {
      if (!win || win.isDestroyed()) return;
      try {
        const cur = win.getTitle() || "";
        if (!cur || cur.includes("Grok Bot") || cur.includes("Grok") || cur === "sand") {
          win.setTitle(cur ? cur.replace(/Grok Bot D/g, 'grok"D"').replace(/Grok Bot/g, 'grok"D"') : 'grok"D"');
        }
      } catch (_) {}
      win.on("page-title-updated", (e, title) => {
        if (title && (title.includes("Grok Bot") || title.includes("Grok") || title === "sand")) {
          e.preventDefault();
          win.setTitle(title.replace(/Grok Bot D/g, 'grok"D"').replace(/Grok Bot/g, 'grok"D"'));
        }
      });
    };
    if (BrowserWindow) {
      BrowserWindow.getAllWindows().forEach(updateTitle);
      app.on("browser-window-created", (_, win) => updateTitle(win));
    }
  } catch (e) {}

  if (!shell.__grokDCleanBrowser) {
    const orig = shell.openExternal.bind(shell);
    shell.openExternal = async function (url, opts) {
      if (login.isLoginUrl(url)) {
        const r = login.openCleanBrowser(url, login.activeProfileId(), { reset: false });
        if (r && r.ok) return;
      }
      return orig(url, opts);
    };
    shell.__grokDCleanBrowser = true;
  }

  function log(msg) {
    try { fs.appendFileSync("/tmp/grokbot-hack/auth-policy.log", "[main-seed] " + msg + "\n"); } catch {}
  }

  function seedComputer() {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        log("enc-unavailable");
        return;
      }
      const seat4 = path.join(home, "Library/Application Support/GrokBotSeat4");
      if (box.isRemoteConnection(box.connectionPath(seat4))) {
        log("already-remote");
        return;
      }
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8")); } catch {}
      if (env.mode === "local") {
        try {
          const auth = require(path.join(ROOT, "profile-auth-preload.js"));
          auth.seedEncryptedDescriptor({ allowLocal: true });
          log("seeded-local-descriptor");
        } catch (e) {
          log("seed-local-err " + e);
        }
        return;
      }
      const extras = [];
      const store = (() => { try { return require(path.join(ROOT, "profile-store.js")); } catch { return null; } })();
      const active = store && store.getActive && store.getActive();
      const id = (active && active.id) || env.profileId || "";
      const identity = active && (active.identitySource || active.sourceUserData);
      if (id) extras.push(path.join(ROOT, "profile-data", id, "secrets", "gateway-descriptor.json"));
      if (identity) extras.push(path.join(identity, "gateway-descriptor.json"));
      const url = box.installFromDescriptor(seat4, safeStorage, extras);
      log(url ? ("seeded " + url.slice(0, 64)) : "no-decrypt");
    } catch (e) {
      log("seed-err " + e);
    }
  }

  async function harvestIdentity() {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        log("ident-enc-unavailable");
        return;
      }
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8")); } catch {}
      if (env.mode === "local") return;
      const acc = require(path.join(ROOT, "account-identity.js"));
      const r = await acc.harvestWithSafeStorage(safeStorage, {
        seat4: path.join(home, "Library/Application Support/GrokBotSeat4"),
        profileId: env.profileId || acc.activeProfileId(),
      });
      log("ident " + JSON.stringify({
        ok: r && r.ok, email: r && r.email ? "yes" : "", photo: r && r.hasPhoto, err: r && r.error,
      }));
    } catch (e) {
      log("ident-err " + e);
    }
    try {
      const quota = require(path.join(ROOT, "seat-quota.js"));
      await quota.refreshAll(safeStorage);
    } catch (e) {
      log("quota-err " + e);
    }
  }

  if (app.isReady()) { seedComputer(); harvestIdentity(); }
  else app.whenReady().then(() => { seedComputer(); harvestIdentity(); });
  setInterval(() => { harvestIdentity().catch(() => {}); }, 30000);
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[open-ext] " + e + "\n"); } catch (_) {}
}
