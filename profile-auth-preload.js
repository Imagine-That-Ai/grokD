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
    const env = JSON.parse(fs.readFileSync(path.join(profileRoot(), "active-env.json"), "utf8"));
    return env && env.mode ? env.mode : "local";
  } catch (e) {
    return "local";
  }
}

function log(msg) {
  try {
    require("fs").appendFileSync("/tmp/grokbot-hack/auth-policy.log", msg + "\n");
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
    const seat4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
    const connPath = path.join(seat4, "sand-data", "local-exec-daemon-connection.json");
    if (!fs.existsSync(connPath)) return;
    const conn = JSON.parse(fs.readFileSync(connPath, "utf8"));
    if (!conn.baseUrl) return;
    const isLoop = /127\.0\.0\.1|localhost/.test(conn.baseUrl);
    if (isLoop && !(opts && opts.allowLocal)) return;
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
    fs.writeFileSync(path.join(seat4, "gateway-descriptor.json"), JSON.stringify({
      version: 1,
      accountScope: scope,
      savedAtMs: Date.now(),
      encrypted,
    }));
    log("seeded-descriptor " + scope.slice(0, 12));
  } catch (e) {
    log("seed-descriptor-err " + e);
  }
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
    try {
      const ident = (() => {
        try {
          return require(require("path").join(profileRoot(), "account-identity.js"));
        } catch { return null; }
      })();
      const orig = Q.cursorAccount && Q.cursorAccount.getStatus;
      if (typeof orig === "function") {
        Q.cursorAccount.getStatus = async function () {
          const s = await orig.apply(this, arguments);
          try {
            let envId = "";
            try {
              envId = JSON.parse(require("fs").readFileSync(
                require("path").join(profileRoot(), "active-env.json"), "utf8"
              )).profileId || "";
            } catch {}
            const e = ident ? ident.enrichStatus(s, { profileId: envId }) : s;
            if (ident && e && (e.kind === "logged-in" || e.email || e.authId) && envId) {
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
          return { state: "granted", reason: "none" };
        };
      }
    } catch (e) { log("wrap-err " + e); }
    try {
      const { safeStorage } = require("electron");
      const quota = require(require("path").join(profileRoot(), "seat-quota.js"));
      quota.refreshAll(safeStorage).catch((e) => log("quota-refresh " + e));
    } catch (e) { log("quota-boot " + e); }
    return Q;
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
  try {
    const env = JSON.parse(require("fs").readFileSync(
      require("path").join(profileRoot(), "active-env.json"),
      "utf8"
    ));
    return env && env.mode === "local";
  } catch (e) {
    return false;
  }
}

// Main-process auth. Official E3.start(logged-out) leaves the coordinator
// inactive, so Create/list in the official UI no-op. Keep the local seat
// looking signed-in for as long as Dipshit/Local is active.
function wrapMainAuth(svc) {
  if (!svc || typeof svc.getStatus !== "function") return svc;
  const origGet = svc.getStatus.bind(svc);
  svc.getStatus = async function () {
    if (isLocalMode()) return Object.assign({}, LOCAL_STATUS);
    return origGet();
  };
  if (typeof svc.subscribe === "function") {
    const origSub = svc.subscribe.bind(svc);
    svc.subscribe = function (fn) {
      return origSub(function (status) {
        fn(isLocalMode() ? Object.assign({}, LOCAL_STATUS) : status);
      });
    };
  }
  log("wrap-main-auth local=" + isLocalMode());
  return svc;
}

module.exports = { applyAuthPolicy, seedEncryptedDescriptor, wrapMainAuth, LOCAL_STATUS, isLocalMode };
