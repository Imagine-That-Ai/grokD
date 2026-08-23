// Copy / clear / snapshot the computer connection that D actually uses.
// Another seat's gateway-descriptor.json is encrypted with that app's
// safeStorage, so the plaintext sand-data connection is the portable piece.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const secGuard = require("./security-guard");

const REL = [
  "sand-secrets.json",
  "gateway-descriptor.json",
  "sand-data/local-exec-daemon-connection.json",
  "sand-data/local-exec-daemon-credential.json",
  "sand-data/settings.json",
];

function copyFile(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  return secGuard.copyFile0600(src, dst);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function isRemoteConnection(fileOrObj) {
  const j = typeof fileOrObj === "string" ? readJson(fileOrObj) : fileOrObj;
  if (!j || typeof j !== "object" || Array.isArray(j)) return false;
  if (typeof j.baseUrl !== "string") return false;
  const u = j.baseUrl;
  if (!u || u.includes("127.0.0.1") || u.includes("localhost")) return false;
  if (!/^https:\/\//i.test(u) || !secGuard.isApprovedRemoteComputerDescriptor(u)) return false;
  if (j.token !== undefined && typeof j.token !== "string") return false;
  return true;
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
  resetForeignSettings(seat4, null);
}

function isLoopbackUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
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
  if (clearLoopbackFile(connectionPath(seat4))) {
    n += 1;
    try { fs.rmSync(path.join(seat4, "sand-data", "local-exec-daemon-credential.json"), { force: true }); } catch {}
  }
  return n > 0;
}

function clearLocalDaemonLeftover(seat4) {
  return clearLocalLeftovers(seat4);
}

function writeLocalHost(seat4) {
  const payload = JSON.stringify({
    baseUrl: "http://127.0.0.1:1337",
    token: secGuard.getGatewayToken(),
  }, null, 2) + "\n";
  for (const p of [connectionPath(seat4), daemonConnectionPath(seat4)]) {
    secGuard.ensureDir0700(path.dirname(p));
    secGuard.writeFile0600(p, payload);
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
  resetForeignSettings(seat4, accountScopeFromSecrets(seat4));
  // A leftover local :1337 in daemon-data makes official try this-Mac
  // local-exec, which then dies with "desktop ownership lost".
  try { fs.rmSync(daemonConnectionPath(seat4), { force: true }); } catch {}
  try { fs.rmSync(path.join(seat4, "daemon-data", "local-exec-daemon-credential.json"), { force: true }); } catch {}
  return true;
}

// destRoot has to belong to the profile that is active right now, or a switch
// landing mid-snapshot writes one profile's secrets into another's directory.
// A tmp destRoot is an isolated test and always passes.
function destMatchesActiveProfile(root, destRoot, isTmp) {
  if (isTmp) return true;
  try {
    const envPath = path.join(root, "active-env.json");
    if (!fs.existsSync(envPath)) return true;
    const env = JSON.parse(fs.readFileSync(envPath, "utf8"));
    if (!env || !env.profileId) return true;
    return path.resolve(destRoot) === path.resolve(path.join(root, "profile-data", env.profileId));
  } catch { return true; }
}

function snapshotHost(seat4, destRoot, opts) {
  const root = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  const allowSwitchLock = opts && opts.allowSwitchLock === true;
  const isTmp = path.resolve(destRoot).startsWith(path.resolve(os.tmpdir()));

  const lockPath = path.join(root, ".snapshot.lock");
  const fd = secGuard.acquireFileLock(lockPath, { waitMs: 4000, staleMs: 15000 });
  if (fd === null) return [];
  try {
    if (!allowSwitchLock) {
      try {
        const swLock = path.join(root, ".switch-profile.lock");
        if (fs.existsSync(swLock)) {
          const stat = fs.statSync(swLock);
          if (Date.now() - stat.mtimeMs < 10000) {
            return [];
          }
        }
      } catch {}
      if (!destMatchesActiveProfile(root, destRoot, isTmp)) return [];
    }

    const copied = [];
    const secDir = path.join(destRoot, "secrets");
    secGuard.ensureDir0700(secDir);

    // Sync secrets and credentials
    for (const rel of REL) {
      const isSecret = rel === "sand-secrets.json" || rel === "gateway-descriptor.json";
      const src = path.join(seat4, rel);
      const dest = isSecret ? path.join(secDir, path.basename(rel)) : path.join(destRoot, rel);
      if (fs.existsSync(src)) {
        if (copyFile(src, dest)) {
          copied.push(rel);
        }
      } else {
        // Clean up stale snapshot files when deleted on host logout
        try { fs.rmSync(dest, { force: true }); } catch {}
      }
    }
    return copied;
  } finally {
    secGuard.releaseFileLock(lockPath, fd);
  }
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
  let changed = false;
  if (j["mcpCustomInstructions"] !== undefined || j["mcpCustomInstructionsAccountScope"] !== undefined) {
    if (!accountScope || !j["mcpCustomInstructionsAccountScope"] || j["mcpCustomInstructionsAccountScope"] !== accountScope) {
      delete j["mcpCustomInstructions"];
      delete j["mcpCustomInstructionsAccountScope"];
      changed = true;
    }
  }
  if (j["hasSeenOnboarding"] !== undefined || j["hasSeenOnboardingAccountScope"] !== undefined) {
    if (!accountScope || !j["hasSeenOnboardingAccountScope"] || j["hasSeenOnboardingAccountScope"] !== accountScope) {
      delete j["hasSeenOnboarding"];
      delete j["hasSeenOnboardingAccountScope"];
      changed = true;
    }
  }
  if (changed) {
    secGuard.writeFile0600(p, JSON.stringify(j, null, 2) + "\n");
    return true;
  }
  return false;
}

function decryptDescriptor(file, safeStorage, expectedScope) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
  const gd = readJson(file);
  if (!gd || typeof gd.encrypted !== "string") return null;
  if (!expectedScope || !gd.accountScope || gd.accountScope !== expectedScope) {
    return null;
  }
  try {
    const conn = JSON.parse(safeStorage.decryptString(Buffer.from(gd.encrypted, "base64")));
    return isRemoteConnection(conn) ? conn : null;
  } catch {
    return null;
  }
}

const _remoteProbeCache = new Map();

function probeRemoteUrlSync(url, timeoutMs) {
  const ms = timeoutMs == null ? 1500 : Math.min(timeoutMs, 2000);
  if (!url || typeof url !== "string") return false;
  if (url.includes("\\") || url.includes("@")) return false;
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") return true;
  if (parsed.protocol !== "https:") return false;
  if (!secGuard.isApprovedRemoteComputerDescriptor(parsed.origin)) return false;

  const canonical = parsed.origin;
  const now = Date.now();
  const cached = _remoteProbeCache.get(canonical);
  if (cached && now - cached.t < 15000) return cached.healthy;

  let pinnedIp = null;
  try {
    const ipOut = require("child_process").execFileSync("python3", [
      "-c",
      "import socket, sys\nprint(socket.gethostbyname(sys.argv[1]))",
      host,
    ], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (ipOut && !secGuard.isPrivateOrLoopbackIp(ipOut)) {
      pinnedIp = ipOut;
    }
  } catch (_) {}

  if (!pinnedIp) {
    _remoteProbeCache.set(canonical, { healthy: false, t: now });
    return false;
  }

  try {
    const maxTimeSec = Math.max(1, Math.ceil(ms / 1000));
    const out = require("child_process").execFileSync("curl", [
      "--proto", "=https",
      "--resolve", `${host}:443:${pinnedIp}`,
      "-sS", "-o", "/dev/null", "-w", "%{http_code}",
      "--max-time", String(maxTimeSec),
      canonical + "/health",
    ], { encoding: "utf8", timeout: ms + 500, stdio: ["ignore", "pipe", "ignore"] });
    const code = Number(String(out).trim());
    const healthy = code === 200 || code === 204;
    _remoteProbeCache.set(canonical, { healthy, t: now });
    return healthy;
  } catch {
    _remoteProbeCache.set(canonical, { healthy: false, t: now });
    return false;
  }
}

function installFromDescriptor(seat4, safeStorage, extraFiles) {
  const currentScope = accountScopeFromSecrets(seat4);
  if (!currentScope) return null;
  const files = [
    path.join(seat4, "gateway-descriptor.json"),
    ...(Array.isArray(extraFiles) ? extraFiles : []),
  ];
  for (const file of files) {
    const conn = decryptDescriptor(file, safeStorage, currentScope);
    if (!conn || !isRemoteConnection(conn)) continue;
    const recheckedScope = accountScopeFromSecrets(seat4);
    if (recheckedScope !== currentScope) continue;
    const dest = connectionPath(seat4);
    secGuard.writeFile0600(dest, JSON.stringify(conn, null, 2));
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
