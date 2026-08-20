// Open Cursor login in a per-seat Chrome, never the already-signed-in default browser.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const PROFILES = path.join(ROOT, "browser-profiles");

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function log(msg) {
  try { fs.appendFileSync("/tmp/grokbot-hack/auth-policy.log", "[browser] " + msg + "\n"); } catch {}
}

const ident = require("./account-identity");
const accountAvatarDataUrl = ident.accountAvatarDataUrl;
const formatCursorAccount = ident.formatCursorAccount;

function isLoginUrl(url) {
  const s = String(url || "");
  if (!/^https?:\/\//i.test(s)) return false;
  return /loginDeepControl|authenticator\.cursor|cursor\.(com|sh)\/login/i.test(s);
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
  const safe = String(id || "cursor").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64);
  return path.join(PROFILES, safe || "cursor");
}

function findChrome() {
  for (const p of CHROMES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resetProfile(id) {
  const dir = profileDir(id);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return dir;
}

function prepareProfile(id) {
  const dir = profileDir(id);
  fs.mkdirSync(dir, { recursive: true });
  try { fs.writeFileSync(path.join(dir, "First Run"), ""); } catch {}
  return dir;
}

function openCleanBrowser(url, id, opts) {
  const profileId = id || activeProfileId();
  if (opts && opts.reset) resetProfile(profileId);
  const dir = prepareProfile(profileId);
  const chrome = findChrome();
  if (!chrome) {
    log("no-chrome " + url);
    return { ok: false, error: "no-chrome", url, profileId };
  }
  // Spawn the binary. `open -na` would hand the URL to the already-logged-in Chrome.
  const child = spawn(chrome, [
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--new-window",
    String(url),
  ], { detached: true, stdio: "ignore" });
  child.unref();
  log("open " + profileId + " " + String(url).slice(0, 160));
  return { ok: true, profileId, dir, chrome, pid: child.pid };
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
