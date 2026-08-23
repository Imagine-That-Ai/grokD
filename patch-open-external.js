"use strict";
// Main-process hook: clean-browser login + seed this seat's computer from a descriptor.
try {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { app, shell, safeStorage } = require("electron");
  const home = os.homedir();
  const ROOT = process.env.GROK_PROFILE_ROOT || path.join(home, ".grok", "grokbot-d");
  const SEAT4 = process.env.GROK_SEAT4 || path.join(home, "Library/Application Support/GrokBotSeat4");
  const login = require(path.join(ROOT, "browser-login.js"));
  const box = require(path.join(ROOT, "box-state.js"));
  const authPolicy = require(path.join(ROOT, "profile-auth-preload.js"));

  function log(msg) {
    try { fs.appendFileSync("/tmp/grokbot-hack/auth-policy.log", "[main-seed] " + msg + "\n"); } catch {}
  }

  if (authPolicy.isLocalMode()) {
    if (!authPolicy.installLocalSafeStorage(safeStorage)) {
      const error = new Error("could not install local safeStorage");
      log("local-safe-storage-failed " + error);
      try { app.exit(1); } catch {}
      throw error;
    }
    log("local-safe-storage-installed");
  }

  try {
    const DISPLAY = 'grok"D"';
    // Keychain slot is "Grok Bot Safe Storage". Do not setName(DISPLAY) —
    // quotes and a new name mint a second keychain and drop renderer secrets.
    app.setName("Grok Bot");
    try { app.setAboutPanelOptions({ applicationName: DISPLAY }); } catch (_) {}
    try {
      if (app.dock && typeof app.dock.setIcon === "function") {
        const iconCandidates = [
          path.join(ROOT, "assets", "grokd-icon.icns"),
          path.join(process.resourcesPath, "icon.icns"),
          path.join(ROOT, "hack", "grokd_icon_color.icns"),
        ];
        for (const ic of iconCandidates) {
          if (fs.existsSync(ic)) {
            app.dock.setIcon(ic);
            break;
          }
        }
      }
    } catch (_) {}
    const { BrowserWindow } = require("electron");
    const updateTitle = (win) => {
      if (!win || win.isDestroyed()) return;
      try {
        const cur = win.getTitle() || "";
        if (!cur || cur.includes("Grok Bot") || cur.includes("Grok") || cur === "sand") {
          win.setTitle(cur ? cur.replace(/Grok Bot D/g, DISPLAY).replace(/Grok Bot/g, DISPLAY) : DISPLAY);
        }
      } catch (_) {}
      win.on("page-title-updated", (e, title) => {
        if (title && (title.includes("Grok Bot") || title.includes("Grok") || title === "sand")) {
          e.preventDefault();
          win.setTitle(title.replace(/Grok Bot D/g, DISPLAY).replace(/Grok Bot/g, DISPLAY));
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

  function seedComputer() {
    try {
      if (authPolicy.isLocalMode()) {
        // This Mac reads sand-data/local-exec-daemon-connection.json directly.
        // Encrypting that same descriptor through safeStorage is redundant and
        // can show a Keychain approval dialog after every locally signed build.
        log("local-descriptor-plaintext");
        return;
      }
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        log("enc-unavailable");
        return;
      }
      if (box.isRemoteConnection(box.connectionPath(SEAT4))) {
        log("already-remote");
        return;
      }
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8")); } catch {}
      const extras = [];
      const store = (() => { try { return require(path.join(ROOT, "profile-store.js")); } catch { return null; } })();
      const active = store && store.getActive && store.getActive();
      const id = (active && active.id) || env.profileId || "";
      const identity = active && (active.identitySource || active.sourceUserData);
      if (id) extras.push(path.join(ROOT, "profile-data", id, "secrets", "gateway-descriptor.json"));
      if (identity) extras.push(path.join(identity, "gateway-descriptor.json"));
      const url = box.installFromDescriptor(SEAT4, safeStorage, extras);
      log(url ? ("seeded " + url.slice(0, 64)) : "no-decrypt");
    } catch (e) {
      log("seed-err " + e);
    }
  }

  async function harvestIdentity() {
    try {
      if (authPolicy.isLocalMode()) return;
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        log("ident-enc-unavailable");
        return;
      }
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8")); } catch {}
      const acc = require(path.join(ROOT, "account-identity.js"));
      const r = await acc.harvestWithSafeStorage(safeStorage, {
        seat4: SEAT4,
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
