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

function clearCursorHost(seat4) {
  const files = [
    "gateway-descriptor.json",
    "sand-data/local-exec-daemon-connection.json",
    "sand-data/local-exec-daemon-credential.json",
    ".env-descriptor-account-bindings.json",
  ];
  for (const rel of files) {
    try { fs.rmSync(path.join(seat4, rel), { force: true }); } catch {}
  }
}

function writeLocalHost(seat4) {
  const p = connectionPath(seat4);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    baseUrl: "http://127.0.0.1:1337",
    token: "fake-gateway-token",
  }));
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
function installFromDescriptor(seat4, safeStorage, extraFiles) {
  const files = [
    path.join(seat4, "gateway-descriptor.json"),
    ...(Array.isArray(extraFiles) ? extraFiles : []),
  ];
  for (const file of files) {
    const conn = decryptDescriptor(file, safeStorage);
    if (!conn) continue;
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
  clearCursorHost,
  writeLocalHost,
  credentialPath,
  findLocalCredential,
  installLocalCredential,
  pickRemoteConnection,
  installConnection,
  snapshotHost,
  secretsPath,
  newerFile,
  accountScopeFromSecrets,
  resetForeignSettings,
  decryptDescriptor,
  installFromDescriptor,
};
