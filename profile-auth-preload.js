"use strict";

function profileRoot() {
  const path = require("path");
  const os = require("os");
  return process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
}

function readMode() {
  try {
    const fs = require("fs");
    const path = require("path");
    const p = path.join(profileRoot(), "active-env.json");
    if (!fs.existsSync(p)) return "cursor";
    const env = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!env || typeof env !== "object") return "cursor";
    if (env.mode === "local" && (env.profileId === "local-d" || env.profileId === "local" || env.profileId === "grok-d")) {
      return "local";
    }
    return "cursor";
  } catch (e) {
    return "cursor";
  }
}

function log(msg) {
  try {
    require("./security-guard").auditLog("preload", msg);
  } catch (e) {}
}

function seedEncryptedDescriptor(opts) {
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const crypto = require("crypto");
    const { safeStorage } = require("electron");
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      log("seed-skip no-safeStorage");
      return;
    }
    const paths = require("./paths");
    const secGuard = require("./security-guard");
    const seat4 = process.env.GROK_SEAT4 || paths.SEAT4;
    const connPath = path.join(seat4, "sand-data", "local-exec-daemon-connection.json");
    if (!fs.existsSync(connPath)) return;
    const conn = JSON.parse(fs.readFileSync(connPath, "utf8"));
    const baseUrl = String((conn && conn.baseUrl) || "").trim();
    if (!baseUrl) return;
    let u;
    try { u = new URL(baseUrl); } catch { return; }
    if (u.username || u.password || u.search || u.hash) return;
    const host = u.hostname.toLowerCase();
    const isLoop = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    if (isLoop) {
      if (!(opts && opts.allowLocal)) return;
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      if (port < 1024 || port > 65535) return;
    } else {
      if (u.protocol !== "https:") return;
      if (!secGuard.isApprovedRemoteDescriptor(baseUrl)) return;
      if (secGuard.isPrivateOrLoopbackIp(host) || secGuard.parseIpv4Int(host) !== null) return;
    }
    let scope = null;
    try {
      const secrets = JSON.parse(fs.readFileSync(path.join(seat4, "sand-secrets.json"), "utf8"));
      const tok = secrets["cursor-access-token"];
      const payload = JSON.parse(Buffer.from(String(tok).split(".")[1], "base64url").toString("utf8"));
      const id = payload.sub || payload.authId;
      if (id) scope = crypto.createHash("sha256").update(id).digest("hex");
    } catch (e) {}
    if (!scope) {
      try {
        const existing = JSON.parse(fs.readFileSync(path.join(seat4, "gateway-descriptor.json"), "utf8"));
        scope = existing.accountScope || null;
      } catch (e) {}
    }
    if (!scope) {
      try {
        const settings = JSON.parse(fs.readFileSync(path.join(seat4, "sand-data", "settings.json"), "utf8"));
        scope = settings.mcpCustomInstructionsAccountScope || settings.hasSeenOnboardingAccountScope || null;
      } catch (e) {}
    }
    if (!scope) scope = crypto.createHash("sha256").update("local-d").digest("hex");
    if (!scope) return;
    const encrypted = safeStorage.encryptString(JSON.stringify(conn)).toString("base64");
    secGuard.ensureDir0700(seat4);
    secGuard.writeFile0600(path.join(seat4, "gateway-descriptor.json"), JSON.stringify({
      version: 1,
      accountScope: scope,
      savedAtMs: Date.now(),
      encrypted,
    }, null, 2) + "\n");
    log("seeded-descriptor " + scope.slice(0, 12));
  } catch (e) {
    log("seed-descriptor-err " + e);
  }
}

function installBridgeHooks() {
  try {
    const Q = window.desktop && window.desktop.internalAPI;
    if (!Q) return;
    log("install-bridge-hooks");
    try {
      const ident = (() => {
        try {
          return require(require("path").join(profileRoot(), "account-identity.js"));
        } catch { return null; }
      })();
      const orig = Q.cursorAccount && Q.cursorAccount.getStatus;
      if (typeof orig === "function") {
        Q.cursorAccount.getStatus = async function () {
          let initEnvId = "";
          try {
            initEnvId = JSON.parse(require("fs").readFileSync(
              require("path").join(profileRoot(), "active-env.json"), "utf8"
            )).profileId || "";
          } catch {}
          const s = await orig.apply(this, arguments);
          try {
            let currentEnvId = "";
            try {
              currentEnvId = JSON.parse(require("fs").readFileSync(
                require("path").join(profileRoot(), "active-env.json"), "utf8"
              )).profileId || "";
            } catch {}
            if (initEnvId && currentEnvId && initEnvId !== currentEnvId) {
              log("getStatus profile-switch-detected during await from " + initEnvId + " to " + currentEnvId);
              return ident ? ident.enrichStatus(s, { profileId: currentEnvId }) : s;
            }
            const envId = currentEnvId || initEnvId;
            const e = ident ? ident.enrichStatus(s, { profileId: envId }) : s;
            if (ident && e && (e.kind === "logged-in" || e.email || e.authId) && envId && envId === initEnvId) {
              try { ident.rememberStatus(e, envId); } catch {}
            }
            log("official-status " + JSON.stringify({
              kind: e && e.kind, authId: e && e.authId, email: e && e.email ? "yes" : "",
            }));
            return e;
          } catch (err) {
            log("enrich-err " + err);
            return s;
          }
        };
      }
      const origAvatar = Q.cursorAccount && Q.cursorAccount.getAvatar;
      if (typeof origAvatar === "function" && ident) {
        Q.cursorAccount.getAvatar = async function () {
          try {
            const official = await origAvatar.apply(this, arguments);
            if (typeof official === "string" && official.indexOf("data:image") === 0) return official;
          } catch (e) { log("avatar-official-err " + e); }
          try {
            let envId = "";
            try {
              envId = JSON.parse(require("fs").readFileSync(
                require("path").join(profileRoot(), "active-env.json"), "utf8"
              )).profileId || "";
            } catch {}
            const cached = envId && ident.readCache(envId);
            if (cached && cached.pictureDataUrl && String(cached.pictureDataUrl).indexOf("data:image") === 0) {
              return cached.pictureDataUrl;
            }
            return null;
          } catch (e) {
            log("avatar-resolve-err " + e);
            return null;
          }
        };
      }
      const origFresh = Q.cursorAccount && Q.cursorAccount.getSandAccessFresh;
      if (typeof origFresh === "function") {
        Q.cursorAccount.getSandAccessFresh = async function () {
          try {
            const a = await origFresh.apply(this, arguments);
            log("official-fresh " + JSON.stringify(a).slice(0, 200));
            if (a && a.state && a.state !== "unknown" && a.state !== "checking") return a;
          } catch (e) { log("fresh-err " + e); }
          return { state: "denied", reason: "sandbox-access-check-failed" };
        };
      }
    } catch (e) { log("wrap-err " + e); }
    try {
      const { safeStorage } = require("electron");
      const quota = require(require("path").join(profileRoot(), "seat-quota.js"));
      quota.refreshAll(safeStorage).catch((e) => log("quota-refresh " + e));
    } catch (e) { log("quota-boot " + e); }
    return Q;
  } catch (e) { log("boot-err " + e); }
}

const LOCAL_STATUS = (function () {
  const os = require("os");
  const u = os.userInfo();
  const localName = u.username || "local";
  return {
    kind: "logged-in",
    authId: "local|" + localName,
    email: localName + "@local",
    name: localName,
    isAnysphereUser: false,
  };
})();

function applyAuthPolicy(Q) {
  const mode = readMode();
  log("apply " + mode);
  if (mode !== "local") {
    try { seedEncryptedDescriptor(); } catch (e) { log("seed-wrap " + e); }
    return installBridgeHooks(Q);
  }

  Q.cursorAccount = Object.assign({}, Q.cursorAccount, {
    getStatus: async function () { return LOCAL_STATUS; },
    getAuthStatus: async function () { return LOCAL_STATUS; },
    getSandAccess: async function () {
      return { kind: "allowed", tier: "pro", isTrial: false };
    },
    getSandAccessFresh: async function () {
      return { state: "granted", reason: "none" };
    },
    login: async function () {
      log("local-login-noop");
      return LOCAL_STATUS;
    },
    logout: async function () {
      log("local-logout-noop");
      return LOCAL_STATUS;
    },
    getAvatar: async function () { return null; },
    getWeeklyUsage: async function () { return null; },
    getUsageSummary: async function () { return null; },
    getPrivacyModeEnabled: async function () { return false; },
  });
  Q.onboarding = Object.assign({}, Q.onboarding, {
    getSeen: async function () { return true; },
    setSeen: async function () {},
  });
  try { seedEncryptedDescriptor({ allowLocal: true }); } catch (e) { log("seed-local " + e); }
  return Q;
}

function isLocalMode() {
  return readMode() === "local";
}

// Main-process auth. Official E3.start(logged-out) leaves the coordinator
// inactive, so Create/list in the official UI no-op. Keep the local seat
// looking signed-in for as long as Dipshit/Local is active.
function wrapMainAuth(svc) {
  if (!svc || typeof svc.getStatus !== "function") return svc;
  const origGet = svc.getStatus.bind(svc);
  svc.getStatus = async function () {
    if (isLocalMode()) return Object.assign({}, LOCAL_STATUS);
    const res = await origGet();
    if (isLocalMode()) return Object.assign({}, LOCAL_STATUS);
    return res;
  };
  if (typeof svc.subscribe === "function") {
    const origSub = svc.subscribe.bind(svc);
    svc.subscribe = function (fn) {
      return origSub(function (status) {
        fn(isLocalMode() ? Object.assign({}, LOCAL_STATUS) : status);
      });
    };
  }
  ["login", "logout"].forEach((name) => {
    if (typeof svc[name] !== "function") return;
    const orig = svc[name].bind(svc);
    svc[name] = async function () {
      if (isLocalMode()) {
        log("local-" + name + "-noop");
        return Object.assign({}, LOCAL_STATUS);
      }
      const res = await orig.apply(this, arguments);
      if (isLocalMode()) return Object.assign({}, LOCAL_STATUS);
      return res;
    };
  });
  log("wrap-main-auth local=" + isLocalMode());
  return svc;
}

function pageWorldLocalScript() {
  const st = {
    kind: "logged-in",
    authId: "local|d",
    email: "",
    name: "Local D",
    isAnysphereUser: false,
  };
  return "(() => {"
    + "const st=" + JSON.stringify(st) + ";"
    + "const D=window.desktop;"
    + "if(!D||!D.cursorAccount)return \"no-desktop\";"
    + "D.cursorAccount.getStatus=async function(){return Object.assign({},st)};"
    + "if(typeof D.cursorAccount.getAuthStatus===\"function\")D.cursorAccount.getAuthStatus=async function(){return Object.assign({},st)};"
    + "D.cursorAccount.login=async function(){return Object.assign({},st)};"
    + "D.cursorAccount.logout=async function(){return Object.assign({},st)};"
    + "D.cursorAccount.getSandAccess=async function(){return {kind:\"allowed\",tier:\"pro\",isTrial:false}};"
    + "D.cursorAccount.getSandAccessFresh=async function(){return {state:\"granted\",reason:\"none\"}};"
    + "if(D.onboarding){D.onboarding.getSeen=async function(){return true};D.onboarding.setSeen=async function(){};}"
    + "return \"wrapped\";"
    + "})()";
}

module.exports = { applyAuthPolicy, seedEncryptedDescriptor, wrapMainAuth, LOCAL_STATUS, isLocalMode, readMode, pageWorldLocalScript };
