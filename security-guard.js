"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const dns = require("dns");
const http = require("http");
const https = require("https");
const paths = require("./paths");

const ROOT = paths.ROOT;
const GATEWAY_TOKEN_FILE = path.join(ROOT, "gateway.token");
const SESSION_KEY_FILE = path.join(ROOT, "session.key");

// --- 1. Filesystem Permissions (Finding 15 / Finding 4) ---
function ensureDir0700(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
  } catch (_) {}
  return dir;
}

function writeFile0600(filePath, content) {
  ensureDir0700(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

// Atomic JSON write: the bytes land on a same-directory temp file and are then
// renamed over the target, so a concurrent reader never sees a half-written file.
function writeJsonAtomic0600(destPath, value) {
  const dir = path.dirname(destPath);
  const tmp = path.join(dir, `.tmp-${path.basename(destPath)}-${crypto.randomBytes(4).toString("hex")}`);
  writeFile0600(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, destPath);
}

function appendFile0600(filePath, content) {
  ensureDir0700(path.dirname(filePath));
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  fs.appendFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

// Single sink for the auth/quota audit trails: 0700 dir, 0600 file, and
// redaction applied once here rather than per caller.
function auditLog(tag, msg, logName = "auth-policy.log") {
  try {
    appendFile0600(path.join(ROOT, "runtime", logName), `[${tag}] ${redactSensitiveText(String(msg))}\n`);
  } catch (_) {}
}

function copyFile0600(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  const srcStat = fs.lstatSync(src);
  if (srcStat.isSymbolicLink() || !srcStat.isFile()) {
    throw new Error(`Refusing to copy non-regular or symlinked source file: ${src}`);
  }
  const parent = path.dirname(dst);
  ensureDir0700(parent);
  if (fs.existsSync(dst)) {
    const dstStat = fs.lstatSync(dst);
    if (dstStat.isSymbolicLink() || !dstStat.isFile()) {
      try { fs.unlinkSync(dst); } catch (_) {}
    }
  }
  const content = fs.readFileSync(src);
  const tmp = path.join(parent, `.${path.basename(dst)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let fd;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(tmp, flags, 0o600);
    fs.writeSync(fd, content, 0, content.length);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, dst);
    try { fs.chmodSync(dst, 0o600); } catch (_) {}
    return true;
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

// Blocking sleep that parks the thread instead of spinning the CPU.
const _sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(_sleepBuf, 0, 0, ms);
}

// Exclusive lockfile, synchronous. Callers decide what to do when the lock is
// busy, so this only reports the outcome: fd on success, null on timeout.
function acquireFileLock(lockFile, opts) {
  try { ensureDir0700(path.dirname(lockFile)); } catch (_) {}
  const waitMs = (opts && opts.waitMs) || 5000;
  const staleMs = (opts && opts.staleMs) || 20000;
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      try { fs.writeSync(fd, String(process.pid) + "\n"); } catch (_) {}
      return fd;
    } catch (e) {
      if (e.code !== "EEXIST") return null;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          let isAlive = false;
          try {
            const content = fs.readFileSync(lockFile, "utf8").trim();
            const pid = parseInt(content, 10);
            if (pid && Number.isInteger(pid) && pid > 0) {
              process.kill(pid, 0);
              isAlive = true;
            }
          } catch (_) {
            isAlive = false;
          }
          if (!isAlive) {
            try { fs.unlinkSync(lockFile); } catch (_) {}
            continue;
          }
        }
      } catch (_) {}
      sleepSync(50);
    }
  }
  return null;
}

function releaseFileLock(lockFile, fd) {
  if (fd === null || fd === undefined) return;
  try { fs.closeSync(fd); } catch (_) {}
  try { fs.unlinkSync(lockFile); } catch (_) {}
}

// --- 2. Gateway Capability Management (Finding 2 & 9) ---
let _cachedGatewayToken = null;

function getGatewayToken() {
  const isValidEntropy = (s) => {
    if (!s || typeof s !== "string") return false;
    const t = s.trim();
    if (t.length < 32) return false;
    if (!/^[a-zA-Z0-9_-]{32,}$/.test(t)) return false;
    return true;
  };
  if (process.env.SAND_HOST_GATEWAY_TOKEN && isValidEntropy(process.env.SAND_HOST_GATEWAY_TOKEN)) {
    return process.env.SAND_HOST_GATEWAY_TOKEN.trim();
  }
  if (process.env.GROK_GATEWAY_TOKEN && isValidEntropy(process.env.GROK_GATEWAY_TOKEN)) {
    return process.env.GROK_GATEWAY_TOKEN.trim();
  }
  try {
    if (fs.existsSync(GATEWAY_TOKEN_FILE)) {
      const tok = fs.readFileSync(GATEWAY_TOKEN_FILE, "utf8").trim();
      if (isValidEntropy(tok)) {
        _cachedGatewayToken = tok;
        return _cachedGatewayToken;
      }
    }
  } catch (_) {}
  if (_cachedGatewayToken && isValidEntropy(_cachedGatewayToken)) return _cachedGatewayToken;
  _cachedGatewayToken = crypto.randomBytes(32).toString("hex");
  try {
    ensureDir0700(path.dirname(GATEWAY_TOKEN_FILE));
    writeFile0600(GATEWAY_TOKEN_FILE, _cachedGatewayToken);
  } catch (_) {}
  return _cachedGatewayToken;
}

// True when `key` is a loopback placeholder rather than a real upstream
// credential — including the live gateway token, which must never be sent
// to a third-party provider as a Bearer credential.
function isGatewayOrLoopbackMarker(key) {
  if (!key || typeof key !== "string") return false;
  const k = key.trim();
  if (!k || k.includes("cliproxy") || k.includes("gateway")) return true;
  const gw = getGatewayToken();
  return Boolean(gw && timingSafeEqualStr(k, gw));
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(maxLen);
  const padB = Buffer.alloc(maxLen);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

function verifyGatewayAuth(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) return false;
  const expected = getGatewayToken();
  return timingSafeEqualStr(token, expected);
}

// --- 3. Cryptographic Session Token & HMAC Management (Finding 2 & 9) ---
function getSessionHmacSecret() {
  try {
    if (fs.existsSync(SESSION_KEY_FILE)) {
      const sec = fs.readFileSync(SESSION_KEY_FILE, "utf8").trim();
      if (sec && sec.length >= 32) return sec;
    }
  } catch (_) {}
  const newSecret = crypto.randomBytes(32).toString("hex");
  try {
    ensureDir0700(path.dirname(SESSION_KEY_FILE));
    writeFile0600(SESSION_KEY_FILE, newSecret);
  } catch (_) {}
  return newSecret;
}

function b64urlEncode(obj) {
  return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function mintSessionJwt(opts = {}) {
  const sub = opts.sub || "grokbot-local";
  const email = opts.email || "local@grokbot.internal";
  const audience = opts.audience || "local-mcp";
  const expSec = opts.expiresInSeconds;
  const expiresInSeconds = (Number.isFinite(expSec) && expSec > 0) ? expSec : (86400 * 30);
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    email,
    aud: audience,
    iat: now,
    nbf: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomUUID(),
  };
  const headStr = b64urlEncode(header);
  const payStr = b64urlEncode(payload);
  const signInput = `${headStr}.${payStr}`;
  const secret = getSessionHmacSecret();
  const signature = crypto.createHmac("sha256", secret).update(signInput).digest("base64url");
  return `${signInput}.${signature}`;
}

function verifySessionJwt(jwtString, expectedAudience = "local-mcp") {
  if (!jwtString || typeof jwtString !== "string") return null;
  const parts = jwtString.trim().split(".");
  if (parts.length !== 3) return null;
  const [headStr, payStr, sigStr] = parts;
  const secret = getSessionHmacSecret();
  const signInput = `${headStr}.${payStr}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(signInput).digest("base64url");
  if (!timingSafeEqualStr(sigStr, expectedSig)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payStr));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now) return null;
    if (expectedAudience && payload.aud !== expectedAudience) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function verifyProxyBridgeAuth(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (verifySessionJwt(token, "local-mcp") || verifySessionJwt(token, "grokbot-proxy")) return true;
  if (timingSafeEqualStr(token, getGatewayToken())) return true;
  return false;
}

function verifyOAuthTriggerAuth(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (verifySessionJwt(token, "openburnbar-oauth")) return true;
  if (timingSafeEqualStr(token, getGatewayToken())) return true;
  return false;
}

function verifyAgentControlAuth(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (verifySessionJwt(token, "agent-control")) return true;
  if (timingSafeEqualStr(token, getGatewayToken())) return true;
  return false;
}

function verifyBotCreateAuth(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (verifySessionJwt(token, "bot-create")) return true;
  if (timingSafeEqualStr(token, getGatewayToken())) return true;
  return false;
}

// --- 4. Provider Security & Allowlist Schema (Finding 4 & 9) ---
const ALLOWED_CONFIG_KEYS = new Set([
  "proxyTarget", "apiKey", "model", "activeModel", "cursorAccount",
  "openrouterApiKey", "openaiApiKey", "anthropicApiKey", "xaiApiKey",
  "minimaxApiKey", "deepseekApiKey", "geminiApiKey", "groqApiKey",
  "providers", "customModels", "savedAt", "version",
]);

const ALLOWED_PROVIDER_IDS = new Set([
  "openrouter", "openai", "anthropic", "claude", "xai", "grok",
  "minimax", "deepseek", "gemini", "groq", "ollama", "lmstudio", "custom",
]);

function redactProviderSecrets(val) {
  if (Array.isArray(val)) return val.map(redactProviderSecrets);
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (/api_?key|token|secret|password|authorization|refreshtoken|accesstoken/i.test(k) && typeof v === "string" && v) {
        out[k] = v.length > 8 ? `${v.slice(0, 4)}•••${v.slice(-3)}` : "••••••••";
      } else {
        out[k] = redactProviderSecrets(v);
      }
    }
    return out;
  }
  return val;
}

const ALLOWED_PROV_SUBKEYS = new Set(["apiKey", "baseUrl", "model", "models", "enabled", "color", "name", "id", "port", "url", "order"]);

function validateProviderConfigPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Invalid provider config patch: must be an object");
  }
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (!ALLOWED_CONFIG_KEYS.has(k)) continue;

    if (k === "providers") {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        clean.providers = {};
        for (const [pId, pCfg] of Object.entries(v)) {
          if (ALLOWED_PROVIDER_IDS.has(pId) && pCfg && typeof pCfg === "object" && !Array.isArray(pCfg)) {
            const subClean = {};
            for (const [subK, subV] of Object.entries(pCfg)) {
              if (subK === "__proto__" || subK === "constructor" || subK === "prototype") continue;
              if (ALLOWED_PROV_SUBKEYS.has(subK)) {
                subClean[subK] = subV;
              }
            }
            clean.providers[pId] = subClean;
          }
        }
      }
      continue;
    }

    if (k === "customModels") {
      if (Array.isArray(v)) {
        clean.customModels = v.filter((m) => typeof m === "string" && m.length > 0 && m.length < 128);
      }
      continue;
    }

    if (typeof v === "string" && v.length < 1024) {
      clean[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      clean[k] = v;
    }
  }
  return clean;
}

const APPROVED_PROVIDER_DOMAINS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "api.x.ai",
  "openrouter.ai",
  "api.minimax.io",
  "api.minimaxi.chat",
  "api.minimax.chat",
  "api.deepseek.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.together.xyz",
  "api.mistral.ai",
  "api.cohere.ai",
  "api.fireworks.ai",
  "bridge.baseten.co",
  "api.cloudflare.com",
  "api.wafer.ai",
  "api.modal.run",
  "ai-gateway.vercel.sh",
  "api2.cursor.sh",
]);

const ALLOWED_LOOPBACK_PORTS = new Set([11434, 1234, 8080, 5000, 8000, 8320, 8322, 8325, 8484, 1337, 1338, 8787]);

function isApprovedProviderUrl(urlStr, options = {}) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const port = u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80);

    // 1. Loopback destinations are permitted for approved local model bridges
    if (u.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]")) {
      if (ALLOWED_LOOPBACK_PORTS.has(port)) return true;
      return false;
    }

    // 2. Public HTTPS endpoints MUST be in the explicit approved provider domains allowlist
    if (u.protocol === "https:") {
      if (isPrivateOrLoopbackIp(host)) return false;
      if (APPROVED_PROVIDER_DOMAINS.has(host)) return true;
      // If domain is not in the allowlist, require an explicit per-provider approved capability
      if (options && (options.approvedCustomDomain === true || options.allowCustomDomain === true)) return true;
      if (process.env.GROK_ALLOW_CUSTOM_PROVIDER_DOMAINS === "1") return true;
      return false;
    }
  } catch (_) {}
  return false;
}

// Single-use OAuth State Store (Mandatory, No Dev Bypass, Auto-pruned)
const _oauthStateMap = new Map();

function pruneOAuthStates() {
  const now = Date.now();
  for (const [k, v] of _oauthStateMap.entries()) {
    if (!v || now - v.createdAt > 10 * 60 * 1000) {
      _oauthStateMap.delete(k);
    }
  }
}

function createOAuthState(provider, account = "default") {
  pruneOAuthStates();
  if (_oauthStateMap.size > 500) {
    const oldest = _oauthStateMap.keys().next().value;
    if (oldest) _oauthStateMap.delete(oldest);
  }
  const stateNonce = crypto.randomBytes(24).toString("hex");
  _oauthStateMap.set(stateNonce, {
    provider: String(provider).toLowerCase(),
    account: String(account),
    createdAt: Date.now(),
  });
  return stateNonce;
}

function consumeOAuthState(stateNonce) {
  pruneOAuthStates();
  if (!stateNonce || typeof stateNonce !== "string") return null;
  const entry = _oauthStateMap.get(stateNonce);
  if (!entry) return null;
  _oauthStateMap.delete(stateNonce);
  const now = Date.now();
  if (now - entry.createdAt > 10 * 60 * 1000) return null; // 10 minute expiry
  return entry;
}

// --- 5. Workspace Path Boundaries & Strict SSRF / DNS Rebinding Validation (Finding 2, 5, 10) ---
const SENSITIVE_DENY_PATTERNS = [
  /[\\/]\.ssh([\\/]|$)/i,
  /[\\/]Library[\\/]Keychains([\\/]|$)/i,
  /[\\/]\.aws([\\/]|$)/i,
  /[\\/]\.gnupg([\\/]|$)/i,
  /[\\/]\.config[\\/](gh|gcloud|aws|cursor)([\\/]|$)/i,
  /[\\/]\.bash_history$/i,
  /[\\/]\.zsh_history$/i,
  /[\\/]\.profile$/i,
  /[\\/]\.bash_profile$/i,
  /[\\/]\.bashrc$/i,
  /[\\/]\.zshrc$/i,
  /[\\/]\.env(\.[a-zA-Z0-9_-]+)?$/i,
  /[\\/]\.netrc$/i,
  /[\\/]\.npmrc$/i,
  /[\\/]id_[a-zA-Z0-9_-]+$/i,
  /\.(pem|key|p12|pfx|pkcs12)$/i,
  /[\\/]box-token\.json$/i,
  /[\\/]gateway\.token$/i,
  /[\\/]gateway-descriptor\.json$/i,
  /[\\/]sand-secrets\.json$/i,
  /[\\/]local-exec-daemon-credential\.json$/i,
  /[\\/]local-exec-daemon-connection\.json$/i,
  /[\\/]sand-data([\\/]|$)/i,
  /[\\/]daemon-data([\\/]|$)/i,
  /[\\/]session\.key$/i,
  /[\\/]takeover\.json$/i,
  /[\\/]paused\.json$/i,
  /[\\/]automations-store\.json$/i,
  /[\\/]quota-.*\.json$/i,
  /[\\/]seat-quota\.json$/i,
  /[\\/]profiles\.json$/i,
  /[\\/]model-config\.json$/i,
  /[\\/]runtime([\\/]|$)/i,
  /[\\/]\.git([\\/]|$)/i,
  /[\\/]store\.db([\\/]|$)/i,
  /[\\/]agent-transcripts([\\/]|$)/i,
  /\.out$/i,
  /\.lock$/i,
  /[\\/]etc([\\/]|$)/i,
  /[\\/]private[\\/]etc([\\/]|$)/i,
];

function isSensitivePath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") return true;
  const p = path.resolve(targetPath);
  return SENSITIVE_DENY_PATTERNS.some((pat) => pat.test(p));
}

// Resolve symlinks on a path that need not exist yet: walk up to the nearest
// existing ancestor, realpath that, then re-attach the missing tail. A guard
// comparing the unresolved path could be walked out of its root by a symlink.
// Throws are left to the caller so each guard keeps its own failure policy.
function realpathBestEffort(targetPath) {
  const abs = path.resolve(targetPath);
  if (fs.existsSync(abs)) return fs.realpathSync(abs);
  let cur = path.dirname(abs);
  while (!fs.existsSync(cur) && cur !== path.dirname(cur)) cur = path.dirname(cur);
  if (fs.existsSync(cur)) return path.join(fs.realpathSync(cur), path.relative(cur, abs));
  return abs;
}

// Roots have to be compared post-realpath too, or a symlinked root never matches.
function realpathRoots(roots) {
  return roots.map((r) => {
    try { return fs.existsSync(r) ? fs.realpathSync(r) : path.resolve(r); }
    catch { return path.resolve(r); }
  });
}

function isPathInWorkspace(targetPath, allowedRoots = []) {
  if (isSensitivePath(targetPath)) return false;
  const abs = path.resolve(targetPath);
  let real = abs;
  try { real = realpathBestEffort(abs); } catch (_) {}

  if (isSensitivePath(real)) return false;

  const lower = real.toLowerCase();
  if (
    lower.includes(`${path.sep}box-data${path.sep}agents`) ||
    lower.includes(`${path.sep}box-data${path.sep}profile-data`) ||
    lower.includes(`${path.sep}box-data${path.sep}automations`) ||
    lower.includes(`${path.sep}box-data${path.sep}agent-transcripts`) ||
    lower.includes(`${path.sep}sand-data`) ||
    lower.includes(`${path.sep}daemon-data`) ||
    lower.includes(`${path.sep}.grok${path.sep}grokbot-d${path.sep}profile-data`) ||
    lower.includes(`${path.sep}.grok${path.sep}grokbot-d${path.sep}runtime`)
  ) {
    return false;
  }

  const hack = paths.existingHack();
  const defaultRoots = [
    hack,
    path.join(hack, "box-data", "workspace"),
    path.join(ROOT, "box-data", "workspace"),
    path.join(os.homedir(), "Documents", "Developer"),
  ];
  const roots = realpathRoots([...defaultRoots, ...allowedRoots]);

  return roots.some((r) => real.startsWith(r + path.sep) || real === r);
}

function parseIpv4Int(ipStr) {
  if (!ipStr || typeof ipStr !== "string") return null;
  let s = ipStr.trim().replace(/\.+$/, "");
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const parts = s.split(".");
  if (parts.length >= 1 && parts.length <= 4) {
    const vals = [];
    for (const p of parts) {
      if (!p) return null;
      let v = 0;
      if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
      else if (/^0[0-7]+$/.test(p) && p !== "0") v = parseInt(p, 8);
      else if (/^[0-9]+$/.test(p)) v = parseInt(p, 10);
      else return null;
      if (v < 0 || isNaN(v)) return null;
      vals.push(v);
    }
    let res = 0;
    if (vals.length === 4) {
      if (vals.some((v) => v > 255)) return null;
      res = (vals[0] << 24) | (vals[1] << 16) | (vals[2] << 8) | vals[3];
    } else if (vals.length === 3) {
      if (vals[0] > 255 || vals[1] > 255 || vals[2] > 65535) return null;
      res = (vals[0] << 24) | (vals[1] << 16) | vals[2];
    } else if (vals.length === 2) {
      if (vals[0] > 255 || vals[1] > 16777215) return null;
      res = (vals[0] << 24) | vals[1];
    } else if (vals.length === 1) {
      if (vals[0] > 4294967295) return null;
      res = vals[0];
    }
    return res >>> 0;
  }
  return null;
}

function parseIpv6Blocks(ipv6Str) {
  if (!ipv6Str || typeof ipv6Str !== "string") return null;
  let s = ipv6Str.trim().toLowerCase().replace(/\.+$/, "");
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  // Strip zone index if any (e.g. %eth0)
  s = s.replace(/%.+$/, "");

  // Check if ending contains embedded IPv4 (e.g. ::ffff:127.0.0.1)
  const lastColon = s.lastIndexOf(":");
  let ipv4Suffix = null;
  if (lastColon !== -1 && s.slice(lastColon + 1).includes(".")) {
    ipv4Suffix = s.slice(lastColon + 1);
    s = s.slice(0, lastColon);
  }

  const parts = s.split("::");
  if (parts.length > 2) return null; // Only one :: allowed

  let left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  let right = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  let ipv4Words = [];
  if (ipv4Suffix) {
    const ip32 = parseIpv4Int(ipv4Suffix);
    if (ip32 === null) return null;
    ipv4Words = [((ip32 >>> 16) & 0xffff).toString(16), (ip32 & 0xffff).toString(16)];
  }

  const totalGiven = left.length + right.length + ipv4Words.length;
  if (parts.length === 1) {
    if (totalGiven !== 8) return null;
  } else {
    if (totalGiven >= 8) return null;
  }

  const missing = 8 - totalGiven;
  const zeros = Array(missing).fill("0");
  const fullHexList = parts.length === 2
    ? [...left, ...zeros, ...right, ...ipv4Words]
    : [...left, ...ipv4Words];

  if (fullHexList.length !== 8) return null;

  const blocks = [];
  for (const h of fullHexList) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
    blocks.push(parseInt(h, 16));
  }
  return blocks;
}

// IPv6 prefixes whose low 32 bits are an embedded IPv4 address: IPv4-mapped
// ::ffff:0:0/96, IPv4-translated ::ffff:0:0:0/96, IPv4-compatible ::/96, and
// the NAT64 well-known prefix 64:ff9b::/96. Each entry is the leading 6 words.
const IPV4_EMBED_PREFIXES = [
  [0, 0, 0, 0, 0, 0xffff],
  [0, 0, 0, 0, 0xffff, 0],
  [0, 0, 0, 0, 0, 0],
  [0x0064, 0xff9b, 0, 0, 0, 0],
];

function isPrivateOrLoopbackIp(hostname) {
  if (!hostname) return true;
  let h = hostname.toLowerCase().trim();
  // Strip trailing dots
  h = h.replace(/\.+$/, "");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.replace(/%.+$/, "");

  // Denied hostnames and domain suffixes
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "127.0.0.1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".corp") ||
    h.endsWith(".home.arpa") ||
    h.endsWith(".lan") ||
    h.endsWith(".home") ||
    h.endsWith(".intranet") ||
    h.endsWith(".private") ||
    h.endsWith(".test") ||
    h.endsWith(".invalid") ||
    h.endsWith(".onion") ||
    h === "instance-data" ||
    h === "metadata.google.internal" ||
    h === "metadata" ||
    h === "169.254.169.254"
  ) {
    return true;
  }

  // IPv4 validation
  const ipv4Int = parseIpv4Int(h);
  if (ipv4Int !== null) {
    return isPrivateIpv4Int(ipv4Int);
  }

  // IPv6 validation
  const blocks = parseIpv6Blocks(h);
  if (blocks !== null) {
    // 1. Loopback ::1 (0:0:0:0:0:0:0:1)
    if (blocks.every((b, i) => (i === 7 ? b === 1 : b === 0))) return true;
    // 2. Unspecified :: (0:0:0:0:0:0:0:0)
    if (blocks.every((b) => b === 0)) return true;
    // 3. Unique Local Address fc00::/7 (fc00: - fdff:)
    if ((blocks[0] & 0xfe00) === 0xfc00) return true;
    // 4. Link-Local Unicast fe80::/10 (fe80: - febf:)
    if ((blocks[0] & 0xffc0) === 0xfe80) return true;
    // 5. Site-Local Unicast fec0::/10 (fec0: - feff:)
    if ((blocks[0] & 0xffc0) === 0xfec0) return true;
    // 6. Multicast ff00::/8
    if ((blocks[0] & 0xff00) === 0xff00) return true;
    // 7. Documentation 2001:db8::/32
    if (blocks[0] === 0x2001 && blocks[1] === 0x0db8) return true;
    // 8. Discard-Only 100::/64
    if (blocks[0] === 0x0100 && blocks[1] === 0 && blocks[2] === 0 && blocks[3] === 0) return true;
    // 9. ORCHIDv2 2001:20::/28 or 2001:10::/28
    if (blocks[0] === 0x2001 && (blocks[1] & 0xfff0) === 0x0010) return true;
    if (blocks[0] === 0x2001 && (blocks[1] & 0xfff0) === 0x0020) return true;

    // 10-13. Prefixes that carry an IPv4 address in the low 32 bits: they
    // inherit that address's verdict. See IPV4_EMBED_PREFIXES.
    if (IPV4_EMBED_PREFIXES.some((pre) => pre.every((w, i) => blocks[i] === w))) {
      return isPrivateIpv4Int(((blocks[6] << 16) | blocks[7]) >>> 0);
    }
    // 14. NAT64 Local 64:ff9b:1::/48
    if (blocks[0] === 0x0064 && blocks[1] === 0xff9b && blocks[2] === 0x0001) {
      return true;
    }
    // 15. 6to4 2002::/16
    if (blocks[0] === 0x2002) {
      const embedded = ((blocks[1] << 16) | blocks[2]) >>> 0;
      return isPrivateIpv4Int(embedded);
    }
    // 16. Teredo 2001:0000::/32
    if (blocks[0] === 0x2001 && blocks[1] === 0x0000) {
      const clientIp = ((~blocks[6] & 0xffff) << 16) | (~blocks[7] & 0xffff);
      return isPrivateIpv4Int(clientIp >>> 0);
    }
  }

  return false;
}

function isPrivateIpv4Int(ipv4Int) {
  // 0.0.0.0/8 (Current network)
  if ((ipv4Int >>> 24) === 0) return true;
  // 10.0.0.0/8 (Private network)
  if ((ipv4Int >>> 24) === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if ((ipv4Int >>> 22) === (100 << 2 | 1)) return true;
  // 127.0.0.0/8 (Loopback)
  if ((ipv4Int >>> 24) === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if ((ipv4Int >>> 16) === (169 << 8 | 254)) return true;
  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if ((ipv4Int >>> 20) === (172 << 4 | 1)) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if ((ipv4Int >>> 8) === (192 << 16 | 0 << 8 | 0)) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if ((ipv4Int >>> 8) === (192 << 16 | 0 << 8 | 2)) return true;
  // 192.168.0.0/16 (Private network)
  if ((ipv4Int >>> 16) === (192 << 8 | 168)) return true;
  // 198.18.0.0/15 (Benchmarking)
  if ((ipv4Int >>> 17) === (198 << 7 | 9)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if ((ipv4Int >>> 8) === (198 << 16 | 51 << 8 | 100)) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if ((ipv4Int >>> 8) === (203 << 16 | 113)) return true;
  // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
  if ((ipv4Int >>> 28) >= 14) return true;
  // 255.255.255.255/32 (Broadcast)
  if (ipv4Int === 0xffffffff) return true;
  return false;
}

function isUrlSafeForWebFetch(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (isPrivateOrLoopbackIp(u.hostname)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Asynchronous DNS Resolution Check & IP Pinning (Defense against DNS Rebinding)
async function resolveAndPinHost(hostname) {
  if (isPrivateOrLoopbackIp(hostname)) return null;
  try {
    const cleanHost = String(hostname || "").toLowerCase().trim().replace(/\.+$/, "");
    const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    if (!records || !records.length) return null;
    for (const rec of records) {
      if (isPrivateOrLoopbackIp(rec.address)) {
        return null;
      }
    }
    return { address: records[0].address, family: records[0].family || 4 };
  } catch (_) {
    return null;
  }
}

async function resolveAndCheckHost(hostname) {
  const res = await resolveAndPinHost(hostname);
  return res !== null;
}

async function isUrlSafeForFetchAsync(urlStr) {
  if (!isUrlSafeForWebFetch(urlStr)) return false;
  try {
    return await resolveAndCheckHost(new URL(urlStr).hostname);
  } catch (_) {
    return false;
  }
}

// Pinned Outbound Fetch: Resolves DNS, validates all addresses against SSRF,
// and pins the connection to the validated address to eliminate TOCTOU rebinding races.
async function safeFetch(urlStr, options = {}) {
  const maxRedirects = typeof options.redirects === "number" ? options.redirects : 5;
  let curUrl = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(curUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Unsupported protocol ${u.protocol}`);
    }
    const cleanHost = u.hostname.toLowerCase().trim().replace(/\.+$/, "");
    if (isPrivateOrLoopbackIp(cleanHost)) {
      throw new Error(`SSRF blocked: ${cleanHost} is private/loopback`);
    }
    const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    if (!records || !records.length) {
      throw new Error(`DNS lookup failed for ${cleanHost}`);
    }
    for (const rec of records) {
      if (isPrivateOrLoopbackIp(rec.address)) {
        throw new Error(`SSRF blocked: ${cleanHost} resolved to private address ${rec.address}`);
      }
    }
    const pinnedIp = records[0].address;
    const isHttps = u.protocol === "https:";
    const port = Number(u.port) || (isHttps ? 443 : 80);
    const lib = isHttps ? https : http;

    const res = await new Promise((resolve, reject) => {
      const reqOpts = {
        host: pinnedIp,
        port,
        path: u.pathname + u.search,
        method: options.method || "GET",
        headers: Object.assign({}, options.headers || {}, {
          Host: u.host,
        }),
        timeout: options.timeoutMs || 15000,
        servername: isHttps ? cleanHost : undefined,
      };
      const req = lib.request(reqOpts, (resp) => {
        const chunks = [];
        let totalLen = 0;
        const maxBytes = options.maxBytes || 8 * 1024 * 1024;
        resp.on("data", (chunk) => {
          totalLen += chunk.length;
          if (totalLen > maxBytes) {
            req.destroy();
            return reject(new Error("Response body exceeded maximum allowed size"));
          }
          chunks.push(chunk);
        });
        resp.on("end", () => {
          const body = Buffer.concat(chunks).toString(options.encoding || "utf8");
          resolve({
            status: resp.statusCode,
            headers: resp.headers,
            body,
            url: curUrl,
          });
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Request timed out")));
      if (options.body) req.write(options.body);
      req.end();
    });

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      curUrl = new URL(res.headers.location, curUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

// Approved Avatar Destinations
const APPROVED_AVATAR_HOSTS = new Set([
  "avatars.githubusercontent.com",
  "github.com",
  "pbs.twimg.com",
  "abs.twimg.com",
  "x.com",
  "twitter.com",
  "lh3.googleusercontent.com",
  "gravatar.com",
  "secure.gravatar.com",
  "cdn.discordapp.com",
  "media.licdn.com",
]);

function isApprovedAvatarUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    let host = u.hostname.toLowerCase().replace(/\.+$/, "");
    if (isPrivateOrLoopbackIp(host)) return false;
    if (APPROVED_AVATAR_HOSTS.has(host)) return true;
    if (
      host.endsWith(".githubusercontent.com") ||
      host.endsWith(".googleusercontent.com") ||
      host.endsWith(".gravatar.com") ||
      host.endsWith(".twimg.com")
    ) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function redactSensitiveText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\b(sk-[a-zA-Z0-9_-]{16,})\b/g, "sk-••••••••")
    .replace(/\b(xai-[a-zA-Z0-9_-]{16,})\b/g, "xai-••••••••")
    .replace(/\b(ghp_[a-zA-Z0-9]{36})\b/g, "ghp_••••••••")
    .replace(/\b(Bearer\s+)[a-zA-Z0-9_.-]{16,}/gi, "$1••••••••")
    .replace(/("?(?:apiKey|api_key|token|secret|password|authorization|access_token|refresh_token)"?\s*([:=])\s*"?[^",\s}]+"?)/gi, (m, p1, delim) => {
      const parts = m.split(delim);
      const keyPart = parts[0];
      return `${keyPart}${delim} "••••••••"`;
    });
}

const SENSITIVE_URL_PARAMS = ["key", "token", "secret", "password", "auth", "code", "state", "nonce"];

// Accepts absolute or request-relative URLs; relative input stays relative.
function redactUrlParams(urlStr) {
  try {
    const relative = urlStr.startsWith("/");
    const u = new URL(urlStr, relative ? "http://localhost" : undefined);
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAMS.some((s) => k.toLowerCase().includes(s))) {
        u.searchParams.set(k, "••••••••");
      }
    }
    return relative ? u.pathname + u.search + u.hash : u.toString();
  } catch (_) {
    return urlStr;
  }
}

// --- 6. Remote Descriptors (Finding 6) ---
const APPROVED_REMOTE_DOMAINS = [
  "cursor.sh", "cursor.com", "cursorvm.com", "grok.com", "x.ai",
  "openrouter.ai", "anthropic.com", "openai.com", "minimax.io",
  "deepseek.com", "googleapis.com", "groq.com",
];

const APPROVED_COMPUTER_DOMAINS = [
  "cursor.sh", "cursor.com", "cursorvm.com", "grok.com", "x.ai",
];

function isApprovedRemoteDescriptor(urlStr) {
  try {
    if (!urlStr || typeof urlStr !== "string") return false;
    if (urlStr.includes("\\") || urlStr.includes("@")) return false;
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.search || u.hash) return false;
    if (u.port && u.port !== "443") return false;
    const host = u.hostname.toLowerCase();
    if (isPrivateOrLoopbackIp(host) || parseIpv4Int(host) !== null) return false;
    return APPROVED_REMOTE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch (_) {
    return false;
  }
}

function isApprovedRemoteComputerDescriptor(urlStr) {
  try {
    if (!urlStr || typeof urlStr !== "string") return false;
    if (urlStr.includes("\\") || urlStr.includes("@")) return false;
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.search || u.hash) return false;
    if (u.port && u.port !== "443") return false;
    const host = u.hostname.toLowerCase();
    if (isPrivateOrLoopbackIp(host) || parseIpv4Int(host) !== null) return false;
    return APPROVED_COMPUTER_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch (_) {
    return false;
  }
}

function tokenizeCommandLine(cmdStr) {
  if (!cmdStr || typeof cmdStr !== "string") return [];
  const tokens = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const c = cmdStr[i];
    if (escape) {
      cur += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      if (inSingle) {
        cur += c;
      } else {
        escape = true;
      }
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

// --- 7. Non-Shell Operation Sandbox & Constrained Binary Allowlist (Finding 1) ---
// Interpreters, compilers, and script runners (node, python, npm, npx, cargo, swift, sqlite3, sed, awk, env)
// are strictly excluded to prevent arbitrary code execution, lifecycle hook injection, and extension loading.
const ALLOWED_EXEC_PROGRAMS = new Set([
  "ls", "cat", "mkdir", "cp", "mv", "rm", "find", "grep", "pwd", "echo",
  "diff", "stat", "head", "tail", "wc", "touch", "which", "tar", "gzip",
  "gunzip", "unzip", "date", "sleep", "true", "false", "basename", "dirname",
  "git"
]);

const FORBIDDEN_EXEC_PROGRAMS = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "bun", "deno",
  "python", "python3", "python2", "pytest", "pip", "pip3",
  "cargo", "rustc", "rustup", "swift", "swiftc", "clang", "gcc", "make",
  "sqlite3", "sqlite",
  "sed", "awk", "perl", "ruby", "php", "lua", "tcl",
  "sh", "bash", "zsh", "csh", "tcsh", "fish", "dash", "ksh",
  "env", "sudo", "su", "doas", "chroot", "pkexec",
  "nc", "netcat", "ncat", "socat", "curl", "wget", "fetch", "telnet", "ssh", "scp", "sftp"
]);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "status", "branch", "rev-parse", "describe", "version"
]);

const SYSTEM_BINARY_MAP = {
  ls: "/bin/ls",
  cat: "/bin/cat",
  mkdir: "/bin/mkdir",
  cp: "/bin/cp",
  mv: "/bin/mv",
  rm: "/bin/rm",
  find: "/usr/bin/find",
  grep: "/usr/bin/grep",
  pwd: "/bin/pwd",
  echo: "/bin/echo",
  diff: "/usr/bin/diff",
  stat: "/usr/bin/stat",
  head: "/usr/bin/head",
  tail: "/usr/bin/tail",
  wc: "/usr/bin/wc",
  touch: "/usr/bin/touch",
  which: "/usr/bin/which",
  tar: "/usr/bin/tar",
  gzip: "/usr/bin/gzip",
  gunzip: "/usr/bin/gunzip",
  unzip: "/usr/bin/unzip",
  date: "/bin/date",
  sleep: "/bin/sleep",
  true: "/usr/bin/true",
  false: "/usr/bin/false",
  basename: "/usr/bin/basename",
  dirname: "/usr/bin/dirname",
  git: "/usr/bin/git",
};

const MUTATING_COMMANDS = new Set(["rm", "mv", "cp", "mkdir", "touch", "rmdir", "chmod", "chown"]);
const FORBIDDEN_SHELL_META = /[|;&`$<>()\n\r]/;

function parseAndValidateCommand(cmd, cwd, options = {}) {
  if (!cmd || typeof cmd !== "string") return { ok: false, error: "Empty command" };
  const s = cmd.trim();
  if (!s) return { ok: false, error: "Empty command" };

  // Reject raw unquoted shell metacharacters that attempt command chaining, subshells, or pipes
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { if (!inSingle) escape = true; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble) {
      if (FORBIDDEN_SHELL_META.test(c)) {
        return { ok: false, error: `Shell metacharacter '${c}' is forbidden in constrained non-shell API` };
      }
    }
  }

  const tokens = tokenizeCommandLine(s);
  if (!tokens.length) return { ok: false, error: "No executable specified" };

  const rawBin = tokens[0];
  if (rawBin.includes("/") || rawBin.includes("\\")) {
    return { ok: false, error: `Executable '${rawBin}' contains path separators: only bare system command names are permitted` };
  }
  const binName = rawBin.toLowerCase();

  // Reject all known interpreters, script runners, and shells
  if (FORBIDDEN_EXEC_PROGRAMS.has(binName)) {
    return { ok: false, error: `Binary '${binName}' is an interpreter/code runner and forbidden from model execution sandbox` };
  }

  if (!ALLOWED_EXEC_PROGRAMS.has(binName)) {
    return { ok: false, error: `Binary '${binName}' is not in the approved sandbox allowlist` };
  }

  const systemBinary = SYSTEM_BINARY_MAP[binName] || (fs.existsSync(`/usr/bin/${binName}`) ? `/usr/bin/${binName}` : `/bin/${binName}`);
  if (!fs.existsSync(systemBinary)) {
    return { ok: false, error: `System binary '${systemBinary}' not found on host` };
  }

  // If cwd is provided, it must be inside workspace
  const workspaceCwd = cwd ? path.resolve(cwd) : path.join(paths.TMP_HACK, "box-data", "workspace");
  if (!isPathInWorkspace(workspaceCwd)) {
    return { ok: false, error: `Working directory '${workspaceCwd}' is outside the authorized workspace` };
  }

  const args = tokens.slice(1);

  let finalArgs = args;

  // Validate mutating commands: block recursive workspace root deletion and require authorization
  if (MUTATING_COMMANDS.has(binName) || binName === "gzip" || binName === "gunzip") {
    if (options && (options.allowMutation === false || options.readOnly === true)) {
      return { ok: false, error: `Command '${binName}' is forbidden in read-only sandbox mode` };
    }
    if (binName === "rm") {
      for (const a of args) {
        if (a === "." || a === ".." || a === "*" || a === "/" || a === "./" || a === "../" || a === "~" || a === "$HOME") {
          return { ok: false, error: `Refusing to run 'rm' against workspace root or wildcard '${a}'` };
        }
        const resolvedTarget = path.resolve(workspaceCwd, a);
        if (resolvedTarget === workspaceCwd || resolvedTarget === os.homedir() || resolvedTarget === "/") {
          return { ok: false, error: `Refusing to delete workspace or home root: ${resolvedTarget}` };
        }
      }
    }
  }

  // Reject symlink-following and recursion flags on utilities (including bundled short options)
  if (binName === "grep" || binName === "find" || binName === "cp" || binName === "ls" || binName === "diff") {
    for (const a of args) {
      const lower = a.toLowerCase();
      if (
        lower.startsWith("--dereference") ||
        lower.startsWith("--follow") ||
        lower.startsWith("--recursive") ||
        lower === "-follow"
      ) {
        return { ok: false, error: `Option '${a}' follows symlinks or recurses outside sandbox read confinement` };
      }
      if (a.startsWith("-") && !a.startsWith("--")) {
        const letters = a.slice(1);
        for (const ch of letters) {
          if (binName === "grep" && (ch === "r" || ch === "R" || ch === "d" || ch === "D")) {
            return { ok: false, error: `Option '${a}' contains recursive/symlink flag in grep` };
          }
          if (binName === "ls" && (ch === "R" || ch === "L" || ch === "H")) {
            return { ok: false, error: `Option '${a}' contains recursive/symlink flag in ls` };
          }
          if (binName === "find" && (ch === "L" || ch === "H" || ch === "l" || ch === "h")) {
            return { ok: false, error: `Option '${a}' follows symlinks in find` };
          }
          if (binName === "cp" && (ch === "r" || ch === "R" || ch === "a" || ch === "L" || ch === "H" || ch === "P")) {
            return { ok: false, error: `Option '${a}' recurses or follows symlinks in cp` };
          }
          if (binName === "diff" && (ch === "r" || ch === "R")) {
            return { ok: false, error: `Option '${a}' recurses in diff` };
          }
        }
      }
    }
  }

  // Validate Git-specific security controls: restrict to read-only inspection subcommands and neutralize repo-local helper execution
  if (binName === "git") {
    const isVersionCheck = args.some((a) => a === "--version" || a === "-v");
    if (!isVersionCheck) {
      const realCwd = fs.existsSync(workspaceCwd) ? fs.realpathSync(workspaceCwd) : workspaceCwd;
      if (!isPathInWorkspace(realCwd)) {
        return { ok: false, error: "Git execution working directory is outside the authorized workspace" };
      }
      const gitPath = path.join(realCwd, ".git");
      if (fs.existsSync(gitPath)) {
        const stGit = fs.lstatSync(gitPath);
        if (stGit.isSymbolicLink()) {
          return { ok: false, error: ".git is a symbolic link: potential repository boundary escape" };
        }
        const realGit = fs.realpathSync(gitPath);
        if (realGit !== gitPath && !realGit.startsWith(realCwd + path.sep)) {
          return { ok: false, error: ".git resolves outside authorized workspace" };
        }
      }
    }
    let subcommand = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const lower = a.toLowerCase();
      if (
        lower.startsWith("-c") ||
        lower.startsWith("--config") ||
        lower.startsWith("--exec-path") ||
        lower.startsWith("--upload-pack") ||
        lower.startsWith("--receive-pack") ||
        lower.startsWith("--git-dir") ||
        lower.startsWith("--work-tree") ||
        lower.startsWith("--ext-diff") ||
        lower.startsWith("--textconv") ||
        lower.startsWith("--edit-description") ||
        lower.startsWith("--editor") ||
        lower === "-p" ||
        lower === "--paginate" ||
        lower === "--no-pager" ||
        lower.startsWith("--output") ||
        lower.startsWith("alias.") ||
        lower.startsWith("credential.") ||
        lower.startsWith("core.")
      ) {
        return { ok: false, error: `Git argument '${a}' is forbidden: potential config/hook/pager/helper injection` };
      }
      if (!subcommand && !a.startsWith("-")) {
        subcommand = lower;
      }
    }
    if (!subcommand && !args.some((a) => a === "--version" || a === "-v")) {
      return { ok: false, error: "No git subcommand specified" };
    }
    if (subcommand && !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      return { ok: false, error: `Git subcommand '${subcommand}' is forbidden in model sandbox: only read-only inspection is permitted (status, diff, log, show, rev-parse, branch, describe, version)` };
    }
    if (subcommand === "branch") {
      const branchArgs = args.filter((a) => a.toLowerCase() !== "branch");
      for (const a of branchArgs) {
        const lower = a.toLowerCase();
        if (
          lower === "--delete" || lower === "--move" || lower === "--copy" || lower === "-u" ||
          lower.startsWith("-d") || lower.startsWith("-m") || lower.startsWith("-c") || lower.startsWith("--set-upstream")
        ) {
          return { ok: false, error: `Mutating git branch flag '${a}' is forbidden in read-only sandbox` };
        }
      }
      // If positional arguments exist that aren't options, git branch creates or modifies branches unless --list / -l / --show-current is passed
      const nonOptionArgs = branchArgs.filter((a) => !a.startsWith("-"));
      const isListMode = branchArgs.some((a) => a === "--list" || a === "-l" || a === "-a" || a === "-r" || a === "--all" || a === "--remotes" || a === "--show-current");
      if (nonOptionArgs.length > 0 && !isListMode) {
        return { ok: false, error: "Creating or modifying git branches is forbidden in read-only sandbox mode" };
      }
    }
    // Neutralize repository-local fsmonitor, diff.external, textconv, and hooks by injecting explicit safe overrides
    finalArgs = [
      "-c", "core.fsmonitor=false",
      "-c", "diff.external=",
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.pager=cat",
      "-c", "credential.helper=",
      "-c", "filter.*.clean=",
      "-c", "filter.*.smudge=",
      "-c", "filter.*.process=",
      "-c", "diff.*.textconv=",
      "-c", "diff.*.command=",
      ...args
    ];
  }

  // Validate Find-specific security controls: forbid nested execution and broad mutation
  if (binName === "find") {
    for (const a of args) {
      const lower = a.toLowerCase();
      if (
        lower === "-delete" || lower.startsWith("-exec") || lower.startsWith("-ok")
      ) {
        return { ok: false, error: `Find argument '${a}' is forbidden: nested command execution or broad mutation` };
      }
    }
  }

  // Validate Tar/Archive security controls: forbid extraction, mutation, helper invocation, and non-dash bundle syntax
  if (binName === "tar") {
    const hasListFlag = args.some((a) => a === "-t" || a === "-tf" || a === "--list" || a === "-tvf" || a === "-tv");
    if (!hasListFlag) {
      return { ok: false, error: "Tar requires explicit list flag (-t / -tf / --list) in model sandbox: archive creation/extraction is forbidden" };
    }
    const allowedTarOptionFlags = new Set(["-t", "-tf", "-tv", "-tvf", "--list", "-v", "--verbose", "-f"]);
    for (const a of args) {
      const lower = a.toLowerCase();
      // First reject all dangerous options, helpers, checkpoints, and mutations regardless of filename suffix
      if (
        lower.includes("--to-command") || lower.includes("--checkpoint") || lower.includes("--use-compress-program") ||
        lower.includes("-i") || lower.includes("-z") || lower.includes("-j") || lower.includes("-a") ||
        lower.includes("--extract") || lower.includes("--create") || lower.includes("--append") || lower.includes("--update") || lower.includes("--delete") ||
        lower.includes("--gzip") || lower.includes("--bzip2") || lower.includes("--xz") || lower.includes("--zstd") || lower.includes("--compress") ||
        lower.includes("--warning") || lower.includes("--files-from") || lower.includes("-t=") || lower.includes("-c=") || lower.includes("-x=") ||
        lower.startsWith("-c") || lower.startsWith("-x") || lower.startsWith("-r") || lower.startsWith("-u") || lower.startsWith("-d") ||
        lower.startsWith("-i") || lower.startsWith("-z") || lower.startsWith("-j") || lower.startsWith("-a") ||
        lower.startsWith("--directory") || lower === "-p"
      ) {
        return { ok: false, error: `Tar argument '${a}' is forbidden: archive creation/extraction or helper invocation is not permitted in model sandbox (only list mode permitted)` };
      }
      if (a.startsWith("-") && !allowedTarOptionFlags.has(a) && !a.startsWith("--file=") && !/^-[tfv]+$/.test(a) && !/^-f.+$/.test(a)) {
        return { ok: false, error: `Tar option '${a}' is not in approved list-mode options` };
      }
    }
  }

  if (binName === "unzip") {
    const hasListFlag = args.some((a) => a === "-l" || a === "-v" || a === "-lq" || a === "-lv");
    if (!hasListFlag) {
      return { ok: false, error: "Unzip requires explicit list flag (-l / -v) in model sandbox: archive extraction is forbidden" };
    }
    for (const a of args) {
      const lower = a.toLowerCase();
      if (lower === "-p" || lower === "-o" || lower === "-n" || lower === "-u" || lower.startsWith("-d") || lower.startsWith("-x")) {
        return { ok: false, error: `Unzip argument '${a}' is forbidden: extraction is not permitted in model sandbox` };
      }
    }
  }

  // Reject any argument naming a forbidden executable, interpreter, or shell
  for (const arg of args) {
    const rawArg = arg.trim();
    const tokens = rawArg.split(/[\s=,;:]+/);
    for (const tok of tokens) {
      if (!tok) continue;
      const tokBase = path.basename(tok).toLowerCase();
      if (FORBIDDEN_EXEC_PROGRAMS.has(tokBase) || FORBIDDEN_EXEC_PROGRAMS.has(tok.toLowerCase())) {
        return { ok: false, error: `Argument '${arg}' names a forbidden binary/interpreter (${tokBase})` };
      }
    }
  }

  // Validate all arguments for sensitive path references (including embedded substrings) and workspace confinement
  for (const arg of args) {
    if (binName === "git") {
      const colIdx = arg.indexOf(":");
      if (colIdx !== -1 && !arg.startsWith("-")) {
        const pathPart = arg.slice(colIdx + 1);
        if (pathPart) {
          if (isSensitivePath(pathPart) || isSensitivePath("/" + pathPart)) {
            return { ok: false, error: `Git object argument '${arg}' references a forbidden sensitive path (${pathPart})` };
          }
          const lowerPath = pathPart.toLowerCase();
          if (
            lowerPath.includes("sand-data") || lowerPath.includes("daemon-data") ||
            lowerPath.includes("secrets") || lowerPath.includes(".ssh") || lowerPath.includes(".aws") ||
            lowerPath.includes(".env") || lowerPath.includes("token") || lowerPath.includes("keychain")
          ) {
            return { ok: false, error: `Git object argument '${arg}' references sensitive path component (${pathPart})` };
          }
        }
      }
    }

    if (isSensitivePath(arg)) {
      return { ok: false, error: `Argument '${arg}' references a forbidden sensitive path` };
    }
    // Check embedded sensitive substrings
    const lowerArg = arg.toLowerCase();
    if (
      lowerArg.includes(".ssh/") || lowerArg.endsWith("/.ssh") || lowerArg === ".ssh" ||
      lowerArg.includes(".aws/") || lowerArg.endsWith("/.aws") || lowerArg === ".aws" ||
      lowerArg.includes(".gnupg/") || lowerArg.endsWith("/.gnupg") || lowerArg === ".gnupg" ||
      lowerArg.includes("keychains/") || lowerArg.endsWith("/keychains") ||
      lowerArg.includes("secrets.json") ||
      lowerArg.includes("/etc/passwd") || lowerArg.includes("/etc/shadow")
    ) {
      return { ok: false, error: `Argument '${arg}' contains an embedded sensitive path reference` };
    }

    let targetPathToCheck = null;
    if (arg.startsWith("/") || arg.startsWith("./") || arg.startsWith("../") || arg.startsWith("~")) {
      targetPathToCheck = arg;
    } else if (
      arg.startsWith("--file=") || arg.startsWith("--output=") || arg.startsWith("-f=") || arg.startsWith("-o=") ||
      arg.startsWith("--target-directory=") || arg.startsWith("--directory=") || arg.startsWith("-c=") ||
      arg.startsWith("--work-tree=") || arg.startsWith("--git-dir=") || arg.startsWith("-i=") || arg.startsWith("--include=") ||
      arg.startsWith("--from-file=") || arg.startsWith("--to-file=") || arg.startsWith("--label=")
    ) {
      targetPathToCheck = arg.split("=")[1];
    } else if (/^-[foICic](.+)$/.test(arg)) {
      targetPathToCheck = arg.slice(2);
    } else if (!arg.startsWith("-") && binName !== "echo" && binName !== "date" && binName !== "sleep" && binName !== "true" && binName !== "false" && binName !== "which") {
      targetPathToCheck = arg;
    }

    if (targetPathToCheck) {
      const resolved = targetPathToCheck.startsWith("~")
        ? path.resolve(os.homedir(), targetPathToCheck.slice(2))
        : path.resolve(workspaceCwd, targetPathToCheck);
      if (!isPathInWorkspace(resolved, [workspaceCwd])) {
        return { ok: false, error: `Path argument '${arg}' resolved outside workspace (${resolved})` };
      }
    }
  }

  return { ok: true, binary: systemBinary, args: finalArgs, cwd: workspaceCwd };
}

function isCommandSafe(cmd, cwd) {
  const res = parseAndValidateCommand(cmd, cwd);
  return res.ok;
}

// --- 8. HTML, Attribute & SVG Sanitization (Finding 6 & 8) ---
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Same entity set as escHtml, plus newlines so the value cannot break out of
// an unquoted or multi-line attribute.
function escAttr(s) {
  return escHtml(s).replace(/\n/g, "&#10;");
}

function sanitizeImageUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return null;
  const trimmed = urlStr.trim();
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol === "https:") {
      if (!isPrivateOrLoopbackIp(u.hostname)) return trimmed;
    }
  } catch (_) {}
  return null;
}

function isValidGalleryIconName(filename) {
  if (!filename || typeof filename !== "string") return false;
  const base = path.basename(filename);
  if (base !== filename) return false; // Must be pure basename (no path traversal)
  return /^[a-zA-Z0-9_-]+\.svg$/i.test(base);
}

const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "text", "tspan"
]);

const ALLOWED_SVG_ATTRS = new Set([
  "id", "viewbox", "xmlns", "version", "width", "height", "x", "y", "cx", "cy",
  "r", "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "fill", "fill-opacity",
  "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "transform", "opacity", "offset", "stop-color", "stop-opacity", "gradientunits",
  "gradienttransform", "font-family", "font-size", "text-anchor"
]);

function sanitizeSvg(svgStr) {
  if (!svgStr || typeof svgStr !== "string") return "";
  let clean = svgStr.trim();
  // Strip XML declarations and DOCTYPE with entity declarations
  clean = clean.replace(/<\?xml[\s\S]*?\?>/gi, "");
  clean = clean.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  clean = clean.replace(/<!--[\s\S]*?-->/g, "");
  clean = clean.trim();

  // Must strictly begin with <svg and end with </svg>
  if (!/^<svg[\s>]/i.test(clean) || !/<\/svg>$/i.test(clean)) {
    return "";
  }

  // Parse and validate all tags and attributes structurally
  const tagRegex = /<\/?([a-zA-Z0-9:-]+)([^>]*)>/g;
  const sanitized = clean.replace(tagRegex, (fullTag, tagName, rawAttrs) => {
    const lowerTag = tagName.toLowerCase().replace(/^svg:/, "");
    if (!ALLOWED_SVG_TAGS.has(lowerTag)) {
      return "";
    }
    if (fullTag.startsWith("</")) {
      return `</${lowerTag}>`;
    }
    const isSelfClosing = fullTag.endsWith("/>");

    // Parse attributes
    const cleanAttrs = [];
    const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase().replace(/^xlink:/, "");
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      if (attrName.startsWith("on")) continue;
      if (!ALLOWED_SVG_ATTRS.has(attrName)) continue;
      // Block url() schemes with script / data
      if (/(?:javascript|data|vbscript):/i.test(attrVal)) continue;
      cleanAttrs.push(`${attrName}="${escHtml(attrVal)}"`);
    }

    const attrStr = cleanAttrs.length > 0 ? " " + cleanAttrs.join(" ") : "";
    return `<${lowerTag}${attrStr}${isSelfClosing ? "/>" : ">"}`;
  });

  if (sanitized.indexOf("<svg") !== 0 || !sanitized.endsWith("</svg>")) {
    return "";
  }
  return sanitized;
}

module.exports = {
  // Permissions
  ensureDir0700,
  writeFile0600,
  writeJsonAtomic0600,
  appendFile0600,
  auditLog,
  copyFile0600,
  acquireFileLock,
  releaseFileLock,
  // Gateway
  getGatewayToken,
  verifyGatewayAuth,
  timingSafeEqualStr,
  isGatewayOrLoopbackMarker,
  // Session JWT
  mintSessionJwt,
  verifySessionJwt,
  verifyProxyBridgeAuth,
  verifyOAuthTriggerAuth,
  verifyAgentControlAuth,
  verifyBotCreateAuth,
  // Provider
  redactProviderSecrets,
  validateProviderConfigPatch,
  isApprovedProviderUrl,
  APPROVED_PROVIDER_DOMAINS,
  createOAuthState,
  consumeOAuthState,
  // Workspace / SSRF
  isSensitivePath,
  isPathInWorkspace,
  realpathBestEffort,
  realpathRoots,
  isUrlSafeForWebFetch,
  isUrlSafeForFetchAsync,
  safeFetch,
  isPrivateOrLoopbackIp,
  resolveAndCheckHost,
  resolveAndPinHost,
  parseIpv4Int,
  parseIpv6Blocks,
  isApprovedAvatarUrl,
  // Remote Descriptors
  isApprovedRemoteDescriptor,
  isApprovedRemoteComputerDescriptor,
  // Command execution & non-shell sandbox
  isCommandSafe,
  parseAndValidateCommand,
  tokenizeCommandLine,
  ALLOWED_EXEC_PROGRAMS,
  // Sanitization, Redaction & SVG
  escHtml,
  escAttr,
  sanitizeImageUrl,
  isValidGalleryIconName,
  sanitizeSvg,
  redactSensitiveText,
  redactUrlParams,
};
