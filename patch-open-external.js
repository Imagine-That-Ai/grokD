"use strict";
// Main-process hook: clean-browser login + seed this seat's computer from a descriptor.
try {
  const fs = require("fs");
  const path = require("path");
  const { app, shell, safeStorage } = require("electron");
  const paths = require("./paths");
  const secGuard = require("./security-guard");
  const ROOT = paths.ROOT;
  const SEAT4 = paths.SEAT4;
  const login = require(path.join(ROOT, "browser-login.js"));
  const box = require(path.join(ROOT, "box-state.js"));

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
          process.resourcesPath ? path.join(process.resourcesPath, "icon.icns") : null,
          path.join(ROOT, "hack", "grokd_icon_color.icns"),
        ].filter(Boolean);
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

  const ALLOWED_EXTERNAL_DOMAINS = [
    "cursor.com", "cursor.sh", "grok.com", "x.ai", "github.com",
    "google.com", "accounts.google.com", "linear.app", "notion.so", "notion.com",
    "stripe.com", "sentry.io", "amplitude.com", "render.com", "resend.com",
    "cloudflare.com", "openrouter.ai", "anthropic.com", "openai.com", "burnbar.app"
  ];
  const ALLOWED_LOOPBACK_PORTS = new Set([80, 443, 1337, 3000, 8320, 8322, 8325, 54321]);

  function isAllowedExternalUrl(parsed, rawUrl) {
    if (!parsed) return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const proto = parsed.protocol;
    const host = parsed.hostname.toLowerCase();
    if (proto === "http:") {
      if (host !== "127.0.0.1" && host !== "localhost") return false;
      const port = Number(parsed.port) || 80;
      return ALLOWED_LOOPBACK_PORTS.has(port);
    }
    if (secGuard.isPrivateOrLoopbackIp(host)) return false;
    return ALLOWED_EXTERNAL_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  }

  if (!shell.__grokDCleanBrowser) {
    const orig = shell.openExternal.bind(shell);
    shell.openExternal = async function (url, opts) {
      if (!url || typeof url !== "string") return;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (login.isLoginUrl(url)) {
        const r = login.openCleanBrowser(url, login.activeProfileId(), { reset: false });
        if (r && r.ok) return;
        throw new Error("Failed to open login URL in clean isolated browser environment");
      }
      if (/login|auth|signin|oauth/i.test(parsed.pathname) || /redirect_uri=/i.test(parsed.search)) {
        return;
      }
      if (!isAllowedExternalUrl(parsed, url)) {
        return;
      }
      return orig(url, opts);
    };
    shell.__grokDCleanBrowser = true;
  }

  function log(msg) {
    secGuard.auditLog("main-seed", msg);
  }

  function seedComputer() {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        log("enc-unavailable");
        return;
      }
      const seat4 = SEAT4;
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

  let _harvesting = false;
  async function harvestIdentity() {
    if (_harvesting) return;
    _harvesting = true;
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
        seat4: SEAT4,
        profileId: env.profileId || acc.activeProfileId(),
      });
      log("ident " + JSON.stringify({
        ok: r && r.ok, email: r && r.email ? "yes" : "", photo: r && r.hasPhoto, err: r && r.error,
      }));
      try {
        const quota = require(path.join(ROOT, "seat-quota.js"));
        await quota.refreshAll(safeStorage);
      } catch (e) {
        log("quota-err " + e);
      }
    } catch (e) {
      log("ident-err " + e);
    } finally {
      _harvesting = false;
    }
  }

  if (app.isReady()) { seedComputer(); harvestIdentity(); }
  else app.whenReady().then(() => { seedComputer(); harvestIdentity(); });
  setInterval(() => { harvestIdentity().catch(() => {}); }, 30000);
} catch (e) {
  try {
    const secGuard = require("./security-guard");
    secGuard.auditLog("open-ext-err", String(e && e.message || e));
  } catch (_) {}
}
