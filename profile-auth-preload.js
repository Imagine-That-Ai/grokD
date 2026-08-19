"use strict";

function readMode() {
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const env = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".grok", "grokbot-d", "active-env.json"), "utf8"));
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

function seedEncryptedDescriptor() {
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const crypto = require("crypto");
    const { safeStorage } = require("electron");
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return;
    const seat4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
    const connPath = path.join(seat4, "sand-data", "local-exec-daemon-connection.json");
    if (!fs.existsSync(connPath)) return;
    const conn = JSON.parse(fs.readFileSync(connPath, "utf8"));
    if (!conn.baseUrl || /127\.0\.0\.1|localhost/.test(conn.baseUrl)) return;
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

function applyAuthPolicy(Q) {
  const mode = readMode();
  log("apply " + mode);
  if (mode !== "local") {
    try { seedEncryptedDescriptor(); } catch (e) { log("seed-wrap " + e); }
    try {
      const ident = (() => {
        try {
          return require(require("path").join(require("os").homedir(), ".grok", "grokbot-d", "account-identity.js"));
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
                require("path").join(require("os").homedir(), ".grok", "grokbot-d", "active-env.json"), "utf8"
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
                require("path").join(require("os").homedir(), ".grok", "grokbot-d", "active-env.json"), "utf8"
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
      const quota = require(require("path").join(require("os").homedir(), ".grok", "grokbot-d", "seat-quota.js"));
      quota.refreshAll(safeStorage).catch((e) => log("quota-refresh " + e));
    } catch (e) { log("quota-boot " + e); }
    return Q;
  }

  Q.cursorAccount = Object.assign({}, Q.cursorAccount, {
    getStatus: async function () {
      return {
        kind: "logged-in",
        authId: "google-oauth2|user_01KX4ZNEM0JA0VXBG7EEG5FBQ7",
        email: "alberto@local",
        name: "Alberto",
        isAnysphereUser: false,
      };
    },
    getSandAccess: async function () {
      return { kind: "allowed", tier: "pro", isTrial: false };
    },
    getSandAccessFresh: async function () {
      return { kind: "allowed", tier: "pro", isTrial: false };
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
  return Q;
}

module.exports = { applyAuthPolicy };
