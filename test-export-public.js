#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const assert = (c, m) => { if (!c) throw new Error(m); };

const SRC = __dirname;
const dest = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-public-test-"));
fs.mkdirSync(path.join(dest, ".git"));
fs.writeFileSync(path.join(dest, ".git", "HEAD"), "ref: refs/heads/main\n");
fs.writeFileSync(path.join(dest, "stale-should-go.txt"), "x");

const r = spawnSync("bash", [path.join(SRC, "export-public.sh"), dest], {
  encoding: "utf8",
  timeout: 120000,
});
assert(r.status === 0, r.stderr || r.stdout || String(r.status));
assert(fs.existsSync(path.join(dest, ".git", "HEAD")), "must not wipe dest .git");
assert(!fs.existsSync(path.join(dest, "stale-should-go.txt")), "rsync --delete");
assert(!fs.existsSync(path.join(dest, "export-public.sh")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "PROMPT-npm-openburnbar-proxy.md")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "live-cursor-chat.js")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "welcome_guide_source.html")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "sync-to-tmp.sh")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "test-export-public.js")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "profiles.json")), "no seats");
assert(!fs.existsSync(path.join(dest, "host", "host-main.cjs")), "no xAI host");
assert(fs.existsSync(path.join(dest, "install.sh")), "installer");
assert(fs.existsSync(path.join(dest, "LICENSE")), "license");
assert(fs.existsSync(path.join(dest, "SECURITY.md")), "security");
assert(fs.existsSync(path.join(dest, "README.md")), "readme");

const readme = fs.readFileSync(path.join(dest, "README.md"), "utf8");
assert(readme.includes('grok"D"'), "display name");
assert(readme.includes("Grok Bot D.app"), "folder name");
assert(readme.includes("will not click Recover"), "cursor limit");
assert(!readme.includes("/tmp/grokbot-hack"), "no kitchen story");
assert(!readme.includes("albertonunez"), "no home path");

const installSh = fs.readFileSync(path.join(dest, "install.sh"), "utf8");
assert(installSh.includes('DEST="$HOME/Applications/Grok Bot D.app"'), "safe dest");
assert(!installSh.includes('DEST="$HOME/Applications/grok\\"D\\".app"'), "no quoted dest");

const pack = fs.readFileSync(path.join(dest, "pack-asar.sh"), "utf8");
assert(!pack.includes("/Users/albertonunez"), pack);

const preload = fs.readFileSync(path.join(dest, "profile-auth-preload.js"), "utf8");
assert(preload.includes("os.userInfo"), preload);
assert(!preload.includes("alberto@local"), preload);
assert(!preload.includes("google-oauth2|user_01KX4ZNEM0JA0VXBG7EEG5FBQ7"), preload);

const mcp = fs.readFileSync(path.join(dest, "local-mcp.js"), "utf8");
assert(mcp.includes('KEYCHAIN_ACCOUNT = "grokbot-local"'), mcp);
assert(!mcp.includes("alberto-local"), mcp);

const needles = [
  "albertonunez",
  "alberto@local",
  "alberto-local",
  "Nunez-Garcia",
  "Alberto's Mac",
  "google-oauth2|user_01KX4ZNEM0JA0VXBG7EEG5FBQ7",
];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|sh|md|yml|html|css|json)$/.test(name)) {
      const text = fs.readFileSync(p, "utf8");
      for (const n of needles) {
        assert(!text.includes(n), `${path.relative(dest, p)}: ${n}`);
      }
    }
  }
}
walk(dest);

console.log("PASS export-public");
