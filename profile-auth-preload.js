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
    const seat4 = process.env.GROK_SEAT4 ||
      path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
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
const LOCAL_ACCESS_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: "local|d",
    email: "local@localhost",
    exp: 4102444800,
  })).toString("base64url"),
  "local",
].join(".");
const wrappedMainAuthServices = new WeakSet();
const wrappedMainAuthFactories = new WeakMap();
const LOCAL_SAFE_STORAGE_MAGIC = Buffer.from("GROKDSS1", "ascii");

function cloneLocalStatus() {
  return Object.assign({}, LOCAL_STATUS);
}

function localSafeStorageKey() {
  const crypto = require("crypto");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const seat = process.env.GROK_SEAT4 ||
    path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
  const dir = path.join(seat, ".grokd-local-safe-storage");
  const keyPath = path.join(dir, "key");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  let key;
  try {
    key = fs.readFileSync(keyPath);
  } catch (e) {
    if (!e || e.code !== "ENOENT") throw e;
    const candidate = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, candidate, { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if (!writeError || writeError.code !== "EEXIST") throw writeError;
    }
    key = fs.readFileSync(keyPath);
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("invalid local safeStorage key");
  }
  fs.chmodSync(keyPath, 0o600);
  return key;
}

function installLocalSafeStorage(safeStorage) {
  if (!isLocalMode()) return false;
  if (!safeStorage || typeof safeStorage !== "object") return false;
  if (safeStorage.__grokDLocalSafeStorage === true) return true;
  const crypto = require("crypto");
  const encryptString = function (value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", localSafeStorageKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([
      LOCAL_SAFE_STORAGE_MAGIC,
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]);
  };
  const decryptString = function (value) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const header = LOCAL_SAFE_STORAGE_MAGIC.length;
    if (
      data.length < header + 12 + 16 ||
      !data.subarray(0, header).equals(LOCAL_SAFE_STORAGE_MAGIC)
    ) {
      const error = new Error("foreign safeStorage ciphertext in local mode");
      error.code = "GROKD_LOCAL_SAFE_STORAGE_FOREIGN_CIPHERTEXT";
      throw error;
    }
    const iv = data.subarray(header, header + 12);
    const tag = data.subarray(header + 12, header + 28);
    const encrypted = data.subarray(header + 28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", localSafeStorageKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  };
  const replacements = {
    isEncryptionAvailable: function () { return true; },
    encryptString,
    decryptString,
  };
  for (const [name, replacement] of Object.entries(replacements)) {
    try { safeStorage[name] = replacement; } catch (e) {}
    if (safeStorage[name] !== replacement) {
      try {
        Object.defineProperty(safeStorage, name, {
          configurable: true,
          enumerable: true,
          value: replacement,
          writable: true,
        });
      } catch (e) {}
    }
    if (safeStorage[name] !== replacement) return false;
  }
  try {
    Object.defineProperty(safeStorage, "__grokDLocalSafeStorage", {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  } catch (e) {
    return false;
  }
  return safeStorage.__grokDLocalSafeStorage === true;
}

function createLocalMainAuth() {
  const listeners = new Set();
  const emit = function () {
    for (const fn of listeners) {
      try { fn(cloneLocalStatus()); } catch (e) { log("local-main-listener " + e); }
    }
    return cloneLocalStatus();
  };
  const noOpStatus = async function () { return emit(); };
  return {
    getStatus: async function () { return cloneLocalStatus(); },
    getAuthStatus: async function () { return cloneLocalStatus(); },
    getValidAccessToken: async function () { return LOCAL_ACCESS_TOKEN; },
    getSelectedTeamId: async function () { return null; },
    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    login: noOpStatus,
    logout: noOpStatus,
    cancelLogin: noOpStatus,
    addAccount: noOpStatus,
    switchToSavedAccount: noOpStatus,
    updateDisplayName: noOpStatus,
    devLogin: noOpStatus,
    revokeForAccountRefusal: async function () {
      return { kind: "completed", status: cloneLocalStatus() };
    },
  };
}

function applyAuthPolicy(Q) {
  if (!Q || typeof Q !== "object") return Q;
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

  const officialCursor = Q.cursorAccount || {};
  const subscribeOfficial = typeof officialCursor.onStatusChanged === "function"
    ? officialCursor.onStatusChanged.bind(officialCursor)
    : null;
  Q.cursorAccount = Object.assign({}, officialCursor, {
    getStatus: async function () { return cloneLocalStatus(); },
    getAuthStatus: async function () { return cloneLocalStatus(); },
    getSandAccess: async function () {
      return { kind: "allowed", tier: "pro", isTrial: false };
    },
    getSandAccessFresh: async function () {
      return { state: "granted", reason: "none" };
    },
    login: async function () {
      log("local-login-noop");
      return cloneLocalStatus();
    },
    logout: async function () {
      log("local-logout-noop");
      return cloneLocalStatus();
    },
    getAvatar: async function () { return null; },
    getWeeklyUsage: async function () { return null; },
    getUsageSummary: async function () { return null; },
    getPrivacyModeEnabled: async function () { return false; },
    onStatusChanged: function (fn) {
      if (typeof fn !== "function") return function () {};
      let active = true;
      const emitLocal = function () {
        if (active) fn(cloneLocalStatus());
      };
      emitLocal();
      let stop = null;
      if (subscribeOfficial) {
        try { stop = subscribeOfficial(emitLocal); }
        catch (e) { log("local-status-subscribe " + e); }
      }
      return function () {
        active = false;
        if (typeof stop === "function") {
          try { stop(); } catch (e) {}
        }
      };
    },
  });
  Q.onboarding = Object.assign({}, Q.onboarding, {
    getSeen: async function () { return true; },
    setSeen: async function () {},
  });
  // Local mode consumes the plaintext loopback descriptor directly. Avoid
  // safeStorage here: a freshly signed local app would otherwise block on a
  // macOS Keychain approval prompt before its first window becomes usable.
  log("local-descriptor plaintext");
  return Q;
}

function isLocalMode() {
  try {
    const env = JSON.parse(require("fs").readFileSync(
      require("path").join(profileRoot(), "active-env.json"),
      "utf8"
    ));
    const mode = env && env.mode ? env.mode : "local";
    if (mode === "local") return true;
    return String((env && env.profileId) || "").indexOf("local") === 0;
  } catch (e) {
    return true;
  }
}

// Replace the official auth factory before its first call. A newly ad-hoc
// signed local build is not authorized to decrypt the official Cursor
// Keychain item, so constructing SandCursorAuthService can block the entire
// first window behind a macOS approval dialog. Cursor mode still calls the
// original factory and receives the official service unchanged in behavior.
function wrapEnsureMainAuth(ensure) {
  if (typeof ensure !== "function") return ensure;
  const existing = wrappedMainAuthFactories.get(ensure);
  if (existing) return existing;
  let localService = null;
  const wrapped = function () {
    if (isLocalMode()) {
      if (!localService) {
        localService = createLocalMainAuth();
        log("create-local-main-auth");
      }
      return Promise.resolve(localService);
    }
    let result;
    try {
      result = ensure.apply(this, arguments);
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(result).then(wrapMainAuth);
  };
  wrappedMainAuthFactories.set(ensure, wrapped);
  wrappedMainAuthFactories.set(wrapped, wrapped);
  return wrapped;
}

// Main-process auth. Official E3.start(logged-out) leaves the coordinator
// inactive, so Create/list in the official UI no-op. Keep the local seat
// looking signed-in for as long as Dipshit/Local is active.
function wrapMainAuth(svc) {
  if (!svc || typeof svc.getStatus !== "function") return svc;
  if (wrappedMainAuthServices.has(svc)) return svc;
  wrappedMainAuthServices.add(svc);
  const origGet = svc.getStatus.bind(svc);
  svc.getStatus = async function () {
    if (isLocalMode()) return cloneLocalStatus();
    return origGet();
  };
  if (typeof svc.subscribe === "function") {
    const origSub = svc.subscribe.bind(svc);
    svc.subscribe = function (fn) {
      return origSub(function (status) {
        fn(isLocalMode() ? cloneLocalStatus() : status);
      });
    };
  }
  ["login", "logout"].forEach((name) => {
    if (typeof svc[name] !== "function") return;
    const orig = svc[name].bind(svc);
    svc[name] = async function () {
      if (isLocalMode()) {
        log("local-" + name + "-noop");
        return cloneLocalStatus();
      }
      return orig.apply(this, arguments);
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

module.exports = {
  applyAuthPolicy,
  seedEncryptedDescriptor,
  installLocalSafeStorage,
  createLocalMainAuth,
  wrapEnsureMainAuth,
  wrapMainAuth,
  LOCAL_STATUS,
  isLocalMode,
  pageWorldLocalScript,
};
