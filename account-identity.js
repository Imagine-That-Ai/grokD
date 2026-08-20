// Who is signed into this Cursor seat: email + photo.
// Official getAvatar only maps github|<digits>; WorkOS ids are github|user_01…
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const CACHE = path.join(ROOT, "runtime", "account-identity.json");
const SEAT4 = process.env.GROK_SEAT4
  || path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");

const PROVIDERS = { github: "GitHub", auth0: "Auth0", "google-oauth2": "Google" };

function log(msg) {
  try { fs.appendFileSync("/tmp/grokbot-hack/auth-policy.log", "[ident] " + msg + "\n"); } catch {}
}

function parseAuthId(authId) {
  const raw = String(authId || "");
  const pipe = raw.indexOf("|");
  if (pipe <= 0 || pipe >= raw.length - 1) {
    return { raw, provider: "", subject: raw };
  }
  return { raw, provider: raw.slice(0, pipe), subject: raw.slice(pipe + 1) };
}

function providerLabel(provider) {
  return PROVIDERS[provider] || provider || "Cursor";
}

function githubAvatarUrlForAuthId(authId) {
  const { provider, subject } = parseAuthId(authId);
  if (provider !== "github" || !/^[0-9]+$/.test(subject)) return null;
  return "https://avatars.githubusercontent.com/u/" + subject + "?v=4&s=192";
}

function githubPngFromUsername(name) {
  const u = String(name || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(u)) return null;
  return "https://github.com/" + u + ".png?size=192";
}

function gravatarFromEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@") || e.includes(" ")) return null;
  const hash = crypto.createHash("sha256").update(e).digest("hex");
  return "https://www.gravatar.com/avatar/" + hash + "?d=404&s=192";
}

function letterFor(status) {
  const raw = String((status && (status.authId || status.email || status.name)) || "");
  const { provider } = parseAuthId(raw);
  if (provider === "github") return "G";
  if (provider === "auth0") return "0";
  if (provider === "google-oauth2") return "G";
  if (status && status.kind === "logging-in") return "…";
  if (status && status.kind === "logged-in") return (raw[0] || "?").toUpperCase();
  return "?";
}

function accountAvatarDataUrl(status) {
  const raw = String((status && (status.authId || status.email || status.name)) || "cursor");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  const hue = Math.abs(h) % 360;
  const letter = letterFor(status);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="16" fill="hsl(${hue} 42% 28%)"/>
    <circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
    <text x="16" y="21" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="14" font-weight="700" fill="#fff">${letter}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function formatCursorAccount(status, seat) {
  const letter = String(seat || "").replace(/^cursor-/i, "").toUpperCase() || "Cursor";
  if (!status || status.kind === "logged-out" || status.kind === "unknown") {
    return {
      title: letter + " · signed out",
      detail: "Sign in with a clean browser",
      signedIn: false,
      email: "",
      hover: "Not signed in",
      letter: "?",
    };
  }
  if (status.kind === "logging-in" && !status.authId && !status.email) {
    return {
      title: letter + " · signing in",
      detail: "Finish in the clean browser",
      signedIn: false,
      email: "",
      hover: "Signing in",
      letter: "…",
    };
  }
  const email = typeof status.email === "string" ? status.email.trim() : "";
  const name = typeof status.name === "string" ? status.name.trim()
    : (typeof status.displayName === "string" ? status.displayName.trim() : "");
  const parsed = parseAuthId(status.authId || "");
  const provider = providerLabel(parsed.provider || status.provider);
  const long = email || name || parsed.subject || "signed in";
  const short = long.length > 22 ? long.slice(0, 12) + "…" + long.slice(-4) : long;
  return {
    title: letter + " · " + provider,
    detail: short,
    signedIn: status.kind === "logged-in" || !!(email || status.authId),
    email,
    name,
    provider,
    full: email || name || parsed.raw,
    hover: email || "No email on this login",
    letter: letterFor(status),
  };
}

function readAllCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); }
  catch { return {}; }
}

function readCache(profileId) {
  const all = readAllCache();
  if (profileId && all[profileId]) return all[profileId];
  return null;
}

function writeCache(profileId, row) {
  if (!profileId || !row) return row;
  const all = readAllCache();
  const prev = all[profileId] || {};
  const next = Object.assign({}, prev, row, { profileId, updatedAt: Date.now() });
  if (!next.pictureDataUrl && prev.pictureDataUrl && prev.authId === next.authId) {
    next.pictureDataUrl = prev.pictureDataUrl;
  }
  all[profileId] = next;
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(all, null, 2) + "\n");
  return next;
}

function cacheForAuthId(authId) {
  if (!authId) return null;
  const all = readAllCache();
  let best = null;
  for (const row of Object.values(all)) {
    if (row && row.authId === authId) {
      if (!best || Number(row.updatedAt || 0) > Number(best.updatedAt || 0)) best = row;
    }
  }
  return best;
}

function rememberStatus(status, profileId) {
  if (!status || !profileId) return null;
  if (status.kind !== "logged-in" && !status.authId && !status.email) return readCache(profileId);
  return writeCache(profileId, {
    kind: status.kind || "logged-in",
    authId: status.authId || undefined,
    email: status.email || undefined,
    name: status.name || status.displayName || undefined,
    pictureUrl: status.profilePictureUrl || status.pictureUrl || undefined,
    provider: parseAuthId(status.authId || "").provider || undefined,
  });
}

function enrichStatus(status, opts) {
  const profileId = opts && opts.profileId;
  const st = status && typeof status === "object" ? Object.assign({}, status) : { kind: "unknown" };
  const cached = (st.authId && cacheForAuthId(st.authId)) || (profileId && readCache(profileId)) || null;
  if (cached && !(st.authId && cached.authId && st.authId !== cached.authId)) {
    if (!st.email && cached.email) st.email = cached.email;
    if (!st.name && !st.displayName && cached.name) st.name = cached.name;
    if (!st.profilePictureUrl && cached.pictureUrl) st.profilePictureUrl = cached.pictureUrl;
    if (!st.authId && cached.authId) st.authId = cached.authId;
    if (!st.username && cached.username) st.username = cached.username;
    if (!st.provider && cached.provider) st.provider = cached.provider;
    if (st.kind !== "logged-in" && cached.authId) st.fromCache = true;
  }
  if (!st.email && profileId) {
    try {
      const fromBrowser = identityFromBrowserProfile(profileId, { includePhoto: false });
      if (fromBrowser.email) {
        st.email = fromBrowser.email;
        if (!st.username) st.username = fromBrowser.username;
        if (!st.name && fromBrowser.name) st.name = fromBrowser.name;
        if (!st.profilePictureUrl && fromBrowser.pictureUrl) st.profilePictureUrl = fromBrowser.pictureUrl;
        st.fromBrowser = true;
      }
    } catch {}
  }
  return st;
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(parts[1] + pad, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function identityFromClaims(claims) {
  if (!claims || typeof claims !== "object") return {};
  const out = {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = claims[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  out.authId = pick("sub", "authId");
  out.email = pick("email", "https://auth.workos.com/email", "preferred_email");
  out.name = pick("name", "preferred_username", "nickname", "given_name");
  out.pictureUrl = pick("picture", "profilePictureUrl", "profile_picture_url");
  out.username = pick("preferred_username", "nickname", "github_username");
  if (!out.email) {
    for (const [k, v] of Object.entries(claims)) {
      if (/email/i.test(k) && typeof v === "string" && v.includes("@")) {
        out.email = v.trim();
        break;
      }
    }
  }
  return out;
}

function decryptScopedToken(safeStorage, scoped) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
  const tok = String(scoped || "");
  if (!tok.startsWith("scoped:v1:")) return null;
  const rest = tok.slice("scoped:v1:".length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  try {
    return safeStorage.decryptString(Buffer.from(rest.slice(i + 1), "base64"));
  } catch (e) {
    log("decrypt-err " + (e && e.message || e));
    return null;
  }
}

function decryptBlob(safeStorage, b64) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable() || !b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(String(b64), "base64"));
  } catch {
    return null;
  }
}

function fetchHttpsToDataUrl(url, opts) {
  const want = String(url || "");
  if (!/^https:\/\//i.test(want)) return Promise.resolve(null);
  const timeoutMs = (opts && opts.timeoutMs) || 8000;
  const acceptMissing = !!(opts && opts.acceptMissing);
  const maxRedirects = opts && typeof opts.redirects === "number" ? opts.redirects : 5;
  return new Promise((resolve) => {
    const req = https.get(want, {
      headers: { Accept: "image/*", "User-Agent": "grok-d-identity" },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) return resolve(null);
        fetchHttpsToDataUrl(res.headers.location, Object.assign({}, opts, { redirects: maxRedirects - 1 })).then(resolve);
        return;
      }
      if (res.statusCode === 404 && acceptMissing) {
        res.resume();
        resolve(null);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const ctype = String(res.headers["content-type"] || "image/png").split(";")[0].trim();
      if (!/^image\//i.test(ctype) && ctype !== "application/octet-stream") {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      let n = 0;
      res.on("data", (c) => {
        n += c.length;
        if (n > 1024 * 1024) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (!chunks.length) return resolve(null);
        const mime = /^image\//i.test(ctype) ? ctype : "image/png";
        resolve("data:" + mime + ";base64," + Buffer.concat(chunks).toString("base64"));
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

function pictureCandidates(ident) {
  const urls = [];
  const add = (u) => {
    if (u && /^https:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  };
  add(ident && (ident.profilePictureUrl || ident.pictureUrl));
  add(githubAvatarUrlForAuthId(ident && ident.authId));
  add(githubPngFromUsername(ident && ident.username));
  add(githubPngFromUsername(ident && ident.name));
  if (ident && ident.email) add(githubPngFromUsername(String(ident.email).split("@")[0]));
  add(gravatarFromEmail(ident && ident.email));
  return urls;
}

async function resolveAvatarDataUrl(ident) {
  if (ident && typeof ident.pictureDataUrl === "string" && ident.pictureDataUrl.indexOf("data:image") === 0) {
    return ident.pictureDataUrl;
  }
  for (const url of pictureCandidates(ident || {})) {
    const data = await fetchHttpsToDataUrl(url, { acceptMissing: /gravatar/.test(url) });
    if (data) return data;
  }
  return null;
}

function postJson(url, body, headers) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ ok: false, error: "bad-url" }); return; }
    const payload = Buffer.from(JSON.stringify(body || {}));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: Object.assign({
        "content-type": "application/json",
        "content-length": payload.length,
        "connect-protocol-version": "1",
      }, headers || {}),
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode === 200, status: res.statusCode, json, text: text.slice(0, 400) });
      });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (e) => resolve({ ok: false, error: String(e && e.message || e) }));
    req.write(payload);
    req.end();
  });
}

async function fetchCursorMe(accessToken) {
  if (!accessToken) return null;
  const headers = {
    authorization: "Bearer " + accessToken,
    "x-request-id": crypto.randomUUID(),
    "x-ghost-mode": "true",
    "x-cursor-client-type": "generic",
  };
  const urls = [
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetMe",
    "https://api2.cursor.sh/auth/full_stripe_profile",
  ];
  for (const url of urls) {
    const r = await postJson(url, {}, headers);
    if (!r.ok || !r.json) continue;
    const j = r.json;
    const email = j.email || j.Email || (j.user && j.user.email);
    const first = j.firstName || j.first_name || "";
    const last = j.lastName || j.last_name || "";
    const name = [first, last].filter(Boolean).join(" ") || j.name || j.displayName;
    const pictureUrl = j.profilePictureUrl || j.profile_picture_url || j.picture;
    if (email || pictureUrl || name) {
      return { email, name, pictureUrl, source: url };
    }
  }
  return null;
}

function readSecrets(root) {
  const p = path.join(root || SEAT4, "sand-secrets.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function copyForRead(src) {
  if (!src || !fs.existsSync(src)) return null;
  const dest = path.join(os.tmpdir(), "grok-ident-" + path.basename(src) + "-" + process.pid);
  try {
    fs.copyFileSync(src, dest);
    const wal = src + "-wal";
    const journal = src + "-journal";
    if (fs.existsSync(wal)) fs.copyFileSync(wal, dest + "-wal");
    if (fs.existsSync(journal)) fs.copyFileSync(journal, dest + "-journal");
    return dest;
  } catch {
    return null;
  }
}

function sqliteQuery(db, sql) {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("sqlite3", ["-separator", "\t", db, sql], {
      encoding: "utf8",
      timeout: 3000,
    });
    return String(out || "").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function fileToDataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    if (!buf.length || buf.length > 1024 * 1024) return null;
    let mime = "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
    else if (buf.slice(0, 4).toString("ascii") === "RIFF") mime = "image/webp";
    return "data:" + mime + ";base64," + buf.toString("base64");
  } catch {
    return null;
  }
}

const _browserMemo = { id: "", at: 0, val: null };

function identityFromBrowserProfile(profileId, opts) {
  const includePhoto = !!(opts && opts.includePhoto);
  const id = String(profileId || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const out = { email: "", username: "" };
  if (!id) return out;
  if (_browserMemo.id === id && Date.now() - _browserMemo.at < 20000 && _browserMemo.val) {
    const copy = Object.assign({}, _browserMemo.val);
    if (!includePhoto) delete copy.pictureDataUrl;
    return copy;
  }
  const def = path.join(ROOT, "browser-profiles", id, "Default");
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(def, "Preferences"), "utf8"));
    const info = Array.isArray(prefs.account_info) ? prefs.account_info[0] : null;
    if (info) {
      if (isEmail(info.email)) out.email = String(info.email).trim();
      if (typeof info.full_name === "string" && info.full_name.trim()) out.name = info.full_name.trim();
      if (typeof info.given_name === "string" && info.given_name.trim() && !out.name) out.name = info.given_name.trim();
      if (typeof info.picture_url === "string" && /^https:\/\//i.test(info.picture_url)) {
        out.pictureUrl = info.picture_url.replace(/=s\d+-c/, "=s192-c");
      }
      if (info.account_id || info.gaia) {
        out.googleId = String(info.account_id || info.gaia);
        out.provider = "google-oauth2";
      }
    }
  } catch {}
  if (!out.email) {
    const web = copyForRead(path.join(def, "Web Data"));
    if (web) {
      try {
        for (const row of sqliteQuery(web, "SELECT value FROM autofill WHERE name='email' ORDER BY date_last_used DESC;")) {
          const v = row.split("\t")[0];
          if (isEmail(v)) { out.email = v; break; }
        }
      } finally {
        try { fs.rmSync(web, { force: true }); } catch {}
        try { fs.rmSync(web + "-wal", { force: true }); } catch {}
        try { fs.rmSync(web + "-journal", { force: true }); } catch {}
      }
    }
  }
  if (out.email && !out.username) out.username = out.email.split("@")[0];
  if (includePhoto && out.googleId) {
    const localPic = path.join(def, "Accounts", "Avatar Images", out.googleId);
    const data = fileToDataUrl(localPic);
    if (data) out.pictureDataUrl = data;
  }
  _browserMemo.id = id;
  _browserMemo.at = Date.now();
  _browserMemo.val = Object.assign({}, out);
  return out;
}

function emailsFromBrowserProfile(profileId) {
  const ident = identityFromBrowserProfile(profileId);
  return ident.email ? [ident.email] : [];
}

function activeProfileId() {
  try {
    const env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8"));
    if (env && env.profileId) return String(env.profileId);
  } catch {}
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, "profiles.json"), "utf8"));
    if (s && s.activeId) return String(s.activeId);
  } catch {}
  return "cursor";
}

async function harvestWithSafeStorage(safeStorage, opts) {
  const profileId = (opts && opts.profileId) || activeProfileId();
  const root = (opts && opts.seat4) || SEAT4;
  const secrets = readSecrets(root);
  const out = { profileId, ok: false };
  const fromBrowser = identityFromBrowserProfile(profileId, { includePhoto: true });
  if (!secrets) {
    if (fromBrowser.email) {
      const ident = Object.assign({}, fromBrowser, { source: "browser" });
      try {
        const pic = await resolveAvatarDataUrl(ident);
        if (pic) ident.pictureDataUrl = pic;
      } catch {}
      writeCache(profileId, ident);
      out.ok = true;
      out.email = ident.email;
      out.hasPhoto = !!ident.pictureDataUrl;
      out.source = "browser";
      return out;
    }
    out.error = "no-secrets";
    return out;
  }
  const plain = decryptScopedToken(safeStorage, secrets["cursor-access-token"]);
  if (!plain) {
    if (fromBrowser.email) {
      const ident = Object.assign({}, fromBrowser, { source: "browser" });
      try {
        const pic = await resolveAvatarDataUrl(ident);
        if (pic) ident.pictureDataUrl = pic;
      } catch {}
      writeCache(profileId, ident);
      out.ok = true;
      out.email = ident.email;
      out.hasPhoto = !!ident.pictureDataUrl;
      out.source = "browser";
      out.error = "no-decrypt";
      log("harvest-browser " + profileId + " email=yes photo=" + out.hasPhoto);
      return out;
    }
    out.error = "no-decrypt";
    return out;
  }
  const claims = decodeJwtPayload(plain) || {};
  const fromJwt = identityFromClaims(claims);
  out.claimKeys = Object.keys(claims);
  let fromMe = null;
  try { fromMe = await fetchCursorMe(plain); }
  catch (e) { out.meErr = String(e && e.message || e); }
  const ident = {
    authId: fromJwt.authId,
    email: (fromMe && fromMe.email) || fromJwt.email || fromBrowser.email,
    name: (fromMe && fromMe.name) || fromJwt.name,
    pictureUrl: (fromMe && fromMe.pictureUrl) || fromJwt.pictureUrl || fromBrowser.pictureUrl,
    username: fromJwt.username || fromBrowser.username,
    provider: parseAuthId(fromJwt.authId).provider,
    source: (fromMe && fromMe.source) || (fromJwt.email ? "jwt" : (fromBrowser.email ? "browser" : "jwt")),
  };
  try {
    const pic = await resolveAvatarDataUrl(ident);
    if (pic) ident.pictureDataUrl = pic;
  } catch (e) {
    out.picErr = String(e && e.message || e);
  }
  writeCache(profileId, ident);
  out.ok = !!(ident.email || ident.pictureDataUrl || ident.authId);
  out.email = ident.email || "";
  out.hasPhoto = !!ident.pictureDataUrl;
  out.authId = ident.authId ? String(ident.authId).slice(0, 28) : "";
  log("harvest " + profileId + " email=" + (ident.email ? "yes" : "no") + " photo=" + out.hasPhoto + " src=" + ident.source);
  return out;
}

module.exports = {
  ROOT,
  CACHE,
  parseAuthId,
  providerLabel,
  githubAvatarUrlForAuthId,
  githubPngFromUsername,
  gravatarFromEmail,
  letterFor,
  accountAvatarDataUrl,
  formatCursorAccount,
  readCache,
  writeCache,
  cacheForAuthId,
  rememberStatus,
  enrichStatus,
  decodeJwtPayload,
  identityFromClaims,
  decryptScopedToken,
  decryptBlob,
  fetchHttpsToDataUrl,
  pictureCandidates,
  resolveAvatarDataUrl,
  fetchCursorMe,
  harvestWithSafeStorage,
  activeProfileId,
  emailsFromBrowserProfile,
  identityFromBrowserProfile,
};
