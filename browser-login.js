// Open Cursor login in a per-seat Chrome, never the already-signed-in default browser.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const secGuard = require("./security-guard");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const PROFILES = path.join(ROOT, "browser-profiles");

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function sanitizeLogText(txt) {
  let s = String(txt || "");
  try {
    s = s.replace(/https?:\/\/[^\s'"`<>]+/gi, (matched) => {
      try {
        const u = new URL(matched);
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return matched.split("?")[0];
      }
    });
  } catch {}
  return secGuard.redactSensitiveText(s);
}

function log(msg) {
  secGuard.auditLog("browser", sanitizeLogText(msg));
}

const ident = require("./account-identity");
const accountAvatarDataUrl = ident.accountAvatarDataUrl;
const formatCursorAccount = ident.formatCursorAccount;

const ALLOWED_REDIRECT_HOSTS = new Set([
  "authenticator.cursor.sh", "cursor.com", "www.cursor.com", "cursor.sh", "www.cursor.sh",
  "api2.cursor.sh", "auth.cursor.com", "cursor.auth0.com", "auth.workos.com"
]);

function isLoginUrl(url) {
  const s = String(url || "");
  if (!/^https:\/\//i.test(s)) return false;
  if (s.includes("\\") || s.includes("@")) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    const host = u.hostname.toLowerCase();
    const isTrusted = host === "authenticator.cursor.sh" ||
                      host === "cursor.com" || host === "www.cursor.com" ||
                      host === "cursor.sh" || host === "www.cursor.sh" ||
                      host === "api2.cursor.sh" ||
                      host === "auth.cursor.com" ||
                      host === "cursor.auth0.com" ||
                      host === "auth.workos.com";
    if (!isTrusted) return false;
    const isApprovedPath = u.pathname.startsWith("/login") || u.pathname.startsWith("/auth") ||
                           u.pathname.includes("loginDeepControl") || u.pathname.startsWith("/oauth") ||
                           (host.startsWith("authenticator.") && u.pathname === "/");
    if (!isApprovedPath) return false;

    // Validate redirect parameters if present
    const redirectParams = ["redirect_uri", "redirect_url", "return_to", "returnTo", "continue", "callback", "next", "state_url"];
    for (const p of redirectParams) {
      const vals = u.searchParams.getAll(p);
      if (vals.length > 1) return false;
      const val = vals[0];
      if (val) {
        try {
          if (val.startsWith("cursor://") || val.startsWith("vscode://")) {
            if (!/^(cursor|vscode):\/\/(anysphere\.cursor-retrieval|vscode\.cursor-retrieval|anysphere\.cursor)\/auth-callback(\?.*)?$/i.test(val)) {
              return false;
            }
            continue;
          }
          const parsed = new URL(val);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
          const rHost = parsed.hostname.toLowerCase();
          if (rHost === "127.0.0.1" || rHost === "localhost") {
            const port = parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
            const ALLOWED_LOOPBACK_PORTS = new Set([80, 443, 1337, 3000, 8320, 8322, 8325, 54321]);
            const isAllowedPort = ALLOWED_LOOPBACK_PORTS.has(port);
            const isAllowedPath = /^\/(auth|oauth|api)?(\/)?(callback|auth-callback|login)?$/i.test(parsed.pathname) || parsed.pathname === "/";
            if (!isAllowedPort || !isAllowedPath) return false;
          } else if (parsed.protocol === "https:") {
            if (!ALLOWED_REDIRECT_HOSTS.has(rHost) && !rHost.endsWith(".cursor.sh") && !rHost.endsWith(".cursor.com")) return false;
          } else {
            return false;
          }
        } catch (_) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
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

function profileDir(id) {
  let cleanId = String(id || "cursor").trim();
  if (!cleanId || cleanId === "." || cleanId === ".." || cleanId.includes("/") || cleanId.includes("\\")) {
    cleanId = "cursor";
  }
  const safe = cleanId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 64) || "cursor";
  secGuard.ensureDir0700(PROFILES);
  const stProfiles = fs.lstatSync(PROFILES);
  if (stProfiles.isSymbolicLink() || !stProfiles.isDirectory()) {
    throw new Error("PROFILES root must be a directory and not a symlink");
  }
  const realProfiles = fs.realpathSync(PROFILES);
  const target = path.resolve(PROFILES, safe);
  if (!target.startsWith(realProfiles + path.sep)) {
    return path.join(realProfiles, "cursor");
  }
  if (fs.existsSync(target)) {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(`Profile path is a symlink or not a directory: ${target}`);
    }
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(realProfiles + path.sep)) {
      throw new Error(`Profile path escaped root: ${target}`);
    }
  }
  return target;
}

function findChrome() {
  for (const p of CHROMES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resetProfile(id) {
  const dir = profileDir(id);
  try {
    if (fs.existsSync(dir)) {
      const st = fs.lstatSync(dir);
      if (!st.isSymbolicLink()) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } catch {}
  return dir;
}

function prepareProfile(id) {
  const dir = profileDir(id);
  secGuard.ensureDir0700(dir);
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error(`prepareProfile: target is a symlink ${dir}`);
  try { secGuard.writeFile0600(path.join(dir, "First Run"), ""); } catch {}
  return dir;
}

function openCleanBrowser(url, id, opts) {
  const profileId = id || activeProfileId();
  if (!isLoginUrl(url)) {
    log("invalid-login-url " + secGuard.redactUrlParams(String(url)));
    return { ok: false, error: "invalid-login-url", url, profileId };
  }
  if (opts && opts.reset) resetProfile(profileId);
  const dir = prepareProfile(profileId);
  const chrome = findChrome();
  if (!chrome) {
    log("no-chrome " + secGuard.redactUrlParams(url));
    return { ok: false, error: "no-chrome", url, profileId };
  }
  try {
    const child = spawn(chrome, [
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--new-window",
      String(url),
    ], { detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      log("spawn-error " + err.message);
    });
    child.unref();
    log("open " + profileId + " " + secGuard.redactUrlParams(String(url)).slice(0, 160));
    return { ok: true, profileId, dir, chrome, pid: child.pid };
  } catch (err) {
    log("spawn-failed " + err.message);
    return { ok: false, error: err.message, url, profileId };
  }
}

module.exports = {
  ROOT,
  PROFILES,
  CHROMES,
  accountAvatarDataUrl,
  formatCursorAccount,
  isLoginUrl,
  activeProfileId,
  profileDir,
  findChrome,
  resetProfile,
  prepareProfile,
  openCleanBrowser,
};
