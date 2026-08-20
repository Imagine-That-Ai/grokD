// Copy / clear / snapshot the computer connection that D actually uses.
// Another seat's gateway-descriptor.json is encrypted with that app's
// safeStorage, so the plaintext sand-data connection is the portable piece.
"use strict";

const fs = require("fs");
const path = require("path");

const REL = [
  "sand-secrets.json",
  "gateway-descriptor.json",
  "sand-data/local-exec-daemon-connection.json",
  "sand-data/local-exec-daemon-credential.json",
  "sand-data/settings.json",
];

function copyFile(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function isRemoteConnection(fileOrObj) {
  const j = typeof fileOrObj === "string" ? readJson(fileOrObj) : fileOrObj;
  if (!j || typeof j.baseUrl !== "string") return false;
  const u = j.baseUrl;
  if (!u || u.includes("127.0.0.1") || u.includes("localhost")) return false;
  return /^https:\/\//i.test(u);
}

function connectionPath(root) {
  return path.join(root, "sand-data", "local-exec-daemon-connection.json");
}

function daemonConnectionPath(root) {
  return path.join(root, "daemon-data", "local-exec-daemon-connection.json");
}

function clearCursorHost(seat4) {
  const files = [
    "gateway-descriptor.json",
    "sand-data/local-exec-daemon-connection.json",
    "sand-data/local-exec-daemon-credential.json",
    "daemon-data/local-exec-daemon-connection.json",
    "daemon-data/local-exec-daemon-credential.json",
    ".env-descriptor-account-bindings.json",
  ];
  for (const rel of files) {
    try { fs.rmSync(path.join(seat4, rel), { force: true }); } catch {}
  }
}

function isLoopbackUrl(url) {
  return typeof url === "string" && /127\.0\.0\.1|localhost/.test(url);
}

function clearLoopbackFile(file) {
  const j = readJson(file);
  if (!j || !isLoopbackUrl(j.baseUrl)) return false;
  try { fs.rmSync(file, { force: true }); } catch {}
  return true;
}

// Cursor seats keep an https VM even when it is offline. Only wipe loopback
// leftovers that make official start this-Mac local-exec.
function clearLocalLeftovers(seat4) {
  let n = 0;
  if (clearLoopbackFile(daemonConnectionPath(seat4))) {
    n += 1;
    try { fs.rmSync(path.join(seat4, "daemon-data", "local-exec-daemon-credential.json"), { force: true }); } catch {}
  }
  if (clearLoopbackFile(connectionPath(seat4))) n += 1;
  return n > 0;
}

function clearLocalDaemonLeftover(seat4) {
  return clearLocalLeftovers(seat4);
}

function writeLocalHost(seat4) {
  const payload = JSON.stringify({
    baseUrl: "http://127.0.0.1:1337",
    token: "fake-gateway-token",
  });
  for (const p of [connectionPath(seat4), daemonConnectionPath(seat4)]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, payload);
  }
}

function credentialPath(root) {
  return path.join(root, "sand-data", "local-exec-daemon-credential.json");
}

function findLocalCredential(extraRoots) {
  const roots = Array.isArray(extraRoots) ? extraRoots.slice() : [];
  const home = require("os").homedir();
  roots.push(
    path.join(home, ".grok", "grokbot-d", "profile-data", "local-d"),
    path.join(home, ".grok", "grokbot-d", "local-d-secrets"),
  );
  for (const root of roots) {
    if (!root) continue;
    const p = credentialPath(root);
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        if (j && j.credential) return p;
      } catch {}
    }
  }
  return null;
}

function installLocalCredential(seat4, extraRoots) {
  const src = findLocalCredential(extraRoots);
  if (!src) return false;
  return copyFile(src, credentialPath(seat4));
}

function pickRemoteConnection(roots) {
  for (const root of roots) {
    if (!root) continue;
    const p = connectionPath(root);
    if (isRemoteConnection(p)) return p;
  }
  return null;
}

// Official Grok Bot A on this machine has no VM file — the computer is this Mac.
// A leftover D snapshot of a dead cursorvm.com pod is not a substitute.
function officialUsesThisMac(identityRoot) {
  if (!identityRoot || !fs.existsSync(identityRoot)) return false;
  return !isRemoteConnection(connectionPath(identityRoot));
}

function activeProbe() {
  const fn = module.exports && module.exports.probeRemoteUrlSync;
  return typeof fn === "function" ? fn : probeRemoteUrlSync;
}

function isHealthyRemoteFile(file) {
  if (!isRemoteConnection(file)) return false;
  const j = readJson(file);
  if (!j || !j.baseUrl) return false;
  try { return !!activeProbe()(j.baseUrl); }
  catch { return false; }
}

// Probe ranks. Probe fail does not drop an https VM (offline is not "no computer").
function chooseCursorConnection(identityRoot, savedRoot) {
  const official = identityRoot ? pickRemoteConnection([identityRoot]) : null;
  const saved = pickRemoteConnection([savedRoot]);
  if (official && isHealthyRemoteFile(official)) return official;
  if (saved && isHealthyRemoteFile(saved)) return saved;
  if (official) return official;
  if (saved) return saved;
  return null;
}

function installConnection(fromFile, seat4) {
  if (!fromFile || !fs.existsSync(fromFile)) return false;
  if (!isRemoteConnection(fromFile)) return false;
  const fromRoot = path.dirname(path.dirname(fromFile));
  copyFile(fromFile, connectionPath(seat4));
  copyFile(
    path.join(fromRoot, "sand-data", "local-exec-daemon-credential.json"),
    path.join(seat4, "sand-data", "local-exec-daemon-credential.json")
  );
  copyFile(
    path.join(fromRoot, "sand-data", "settings.json"),
    path.join(seat4, "sand-data", "settings.json")
  );
  // A leftover local :1337 in daemon-data makes official try this-Mac
  // local-exec, which then dies with "desktop ownership lost".
  try { fs.rmSync(daemonConnectionPath(seat4), { force: true }); } catch {}
  try { fs.rmSync(path.join(seat4, "daemon-data", "local-exec-daemon-credential.json"), { force: true }); } catch {}
  return true;
}

function snapshotHost(seat4, destRoot) {
  const copied = [];
  for (const rel of REL) {
    if (copyFile(path.join(seat4, rel), path.join(destRoot, rel === "sand-secrets.json" || rel === "gateway-descriptor.json" ? path.join("secrets", path.basename(rel)) : rel))) {
      copied.push(rel);
    }
  }
  return copied;
}

function secretsPath(root) {
  const a = path.join(root, "sand-secrets.json");
  if (fs.existsSync(a)) return a;
  const b = path.join(root, "secrets", "sand-secrets.json");
  return fs.existsSync(b) ? b : null;
}

function newerFile(a, b) {
  const am = a && fs.existsSync(a) ? fs.statSync(a).mtimeMs : 0;
  const bm = b && fs.existsSync(b) ? fs.statSync(b).mtimeMs : 0;
  if (!am && !bm) return null;
  return am >= bm ? a : b;
}

function accountScopeFromSecrets(rootOrFile) {
  const p = rootOrFile && fs.existsSync(rootOrFile) && fs.statSync(rootOrFile).isFile()
    ? rootOrFile
    : secretsPath(rootOrFile);
  const j = readJson(p);
  const tok = j && j["cursor-access-token"];
  if (typeof tok !== "string" || !tok.startsWith("scoped:v1:")) return null;
  const rest = tok.slice("scoped:v1:".length);
  const i = rest.indexOf(":");
  const scope = i > 0 ? rest.slice(0, i) : "";
  return /^[0-9a-f]{64}$/.test(scope) ? scope : null;
}

function resetForeignSettings(seat4, accountScope) {
  const p = path.join(seat4, "sand-data", "settings.json");
  const j = readJson(p);
  if (!j) return false;
  const keys = [
    "mcpCustomInstructionsAccountScope",
    "hasSeenOnboardingAccountScope",
  ];
  let changed = false;
  for (const k of keys) {
    if (!j[k]) continue;
    if (!accountScope || j[k] !== accountScope) {
      delete j[k];
      changed = true;
    }
  }
  if (!changed) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  return true;
}

function decryptDescriptor(file, safeStorage) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
  const gd = readJson(file);
  if (!gd || typeof gd.encrypted !== "string") return null;
  try {
    const conn = JSON.parse(safeStorage.decryptString(Buffer.from(gd.encrypted, "base64")));
    return isRemoteConnection(conn) ? conn : null;
  } catch {
    return null;
  }
}

// Electron-only: turn a safeStorage gateway-descriptor into the plaintext VM URL.
function probeRemoteUrlSync(url, timeoutMs) {
  const ms = timeoutMs == null ? 3500 : timeoutMs;
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/127\.0\.0\.1|localhost/.test(url)) return true;
  // curl, not `node -e`. The renderer cannot spawn a nested ContextifyScript.
  try {
    const out = require("child_process").execFileSync("curl", [
      "-sS", "-o", "/dev/null", "-w", "%{http_code}",
      "--max-time", String(Math.max(1, Math.ceil(ms / 1000))),
      "-k", String(url).replace(/\/$/, "") + "/health",
    ], { encoding: "utf8", timeout: ms + 800, stdio: ["ignore", "pipe", "ignore"] });
    const code = Number(String(out).trim());
    return Number.isFinite(code) && code > 0 && code !== 404 && code < 500;
  } catch {
    return false;
  }
}

function installFromDescriptor(seat4, safeStorage, extraFiles) {
  const files = [
    path.join(seat4, "gateway-descriptor.json"),
    ...(Array.isArray(extraFiles) ? extraFiles : []),
  ];
  for (const file of files) {
    const conn = decryptDescriptor(file, safeStorage);
    if (!conn || !isRemoteConnection(conn)) continue;
    const dest = connectionPath(seat4);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(conn));
    return conn.baseUrl;
  }
  return null;
}

module.exports = {
  REL,
  copyFile,
  readJson,
  isRemoteConnection,
  connectionPath,
  daemonConnectionPath,
  clearCursorHost,
  clearLocalLeftovers,
  clearLocalDaemonLeftover,
  writeLocalHost,
  credentialPath,
  findLocalCredential,
  installLocalCredential,
  pickRemoteConnection,
  officialUsesThisMac,
  isHealthyRemoteFile,
  chooseCursorConnection,
  installConnection,
  snapshotHost,
  secretsPath,
  newerFile,
  accountScopeFromSecrets,
  resetForeignSettings,
  decryptDescriptor,
  installFromDescriptor,
  probeRemoteUrlSync,
};
