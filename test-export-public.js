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
assert(!fs.existsSync(path.join(dest, "sync-to-tmp.sh")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "test-export-public.js")), "kitchen-only");
assert(!fs.existsSync(path.join(dest, "profiles.json")), "no seats");
assert(!fs.existsSync(path.join(dest, "host", "host-main.cjs")), "no xAI host");
assert(fs.existsSync(path.join(dest, "install.sh")), "installer");
assert(fs.existsSync(path.join(dest, "LICENSE")), "license");
assert(fs.existsSync(path.join(dest, "SECURITY.md")), "security");
assert(fs.existsSync(path.join(dest, "README.md")), "readme");
assert(!fs.existsSync(path.join(dest, "grokD_Welcome_Guide.pdf")), "no stale brochure pdf");
assert(fs.existsSync(path.join(dest, "splash", "onboarding-apple.html")), "onboarding html");
assert(fs.existsSync(path.join(dest, "welcome_guide_source.html")), "print template");
assert(!fs.readFileSync(path.join(dest, "PROFILES.md"), "utf8").includes("live-cursor-chat.js"), "no kitchen chat script");

const readme = fs.readFileSync(path.join(dest, "README.md"), "utf8");
assert(readme.includes('grok"D"'), "display name");
assert(readme.includes("Grok Bot D.app"), "folder name");
assert(readme.includes("will not click Recover"), "cursor limit");
assert(!readme.includes("grokD_Welcome_Guide.pdf"), "no brochure pdf linked");
assert(readme.includes("onboarding-apple.html"), "onboarding linked");
assert(readme.includes("welcome_guide_source.html"), "print template linked");
assert(!readme.includes("/tmp/grokbot-hack"), "no kitchen story");
assert(!readme.includes("albertonunez"), "no home path");
assert(!readme.includes("There is no notarized installer yet"), "stale no-drop docs");
assert(!readme.includes("same files as the public repo"), "no kitchen self-talk");
assert(readme.includes("./install.sh"), "clone install");
assert(readme.includes("pack-drop.sh"), "drop path named");
assert(readme.includes("does not host that"), "repo does not attach the .app");
assert(readme.includes("Prepare to get grok"), "punch line");
assert(readme.includes("assets/grokd-icon.png"), "logo");
assert(readme.includes("alberto@imagine-that.ai"), "testflight email");
assert(!readme.includes("Liquid Metal"), "no liquid-metal hub");
assert(!fs.readFileSync(path.join(dest, "welcome_guide_source.html"), "utf8").includes("Liquid Metal Hub"), "guide copy");

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
assert(!mcp.includes("alberto8793"), mcp);
assert(!mcp.includes("cubelove.ai"), mcp);

const dropSh = fs.readFileSync(path.join(dest, "pack-drop.sh"), "utf8");
assert(dropSh.includes("host-main.cjs"), "drop excludes extracted host");
assert(dropSh.includes("export-public.sh"), "drop packs from export when present");
assert(dropSh.includes("Grok Bot D.app"), "public drop dest has no quotes");

const ci = fs.readFileSync(path.join(dest, ".github", "workflows", "check.yml"), "utf8");
assert(ci.includes("node test-unit.js"), "public CI door");
assert(ci.includes("no kitchen leftovers"), "public CI leftover door");
assert(!ci.includes("albertonunez"), "public CI must not spell the home path");
assert(!ci.includes("Imagine-That-Ai/grok-D"), "public CI must not spell kitchen repo");

const onboard = fs.readFileSync(path.join(dest, "splash", "onboarding-apple.html"), "utf8");
assert(!onboard.includes("Alberto · Personal"), "named seat chip");
assert(onboard.includes("You · Personal"), "generic seat chip");
assert(!onboard.includes("Imagine-That-Ai/grok-D"), "no kitchen repo url");
assert(!onboard.includes("Pending Elon"), "no pending-elon joke");
assert(!onboard.includes("funding frontier"), "no elon/spacex credit");
assert(!onboard.includes("BUILT WITH"), "no built-with spacex chip");
assert(!onboard.includes("Elon Musk"), "no elon credit");
const guide = fs.readFileSync(path.join(dest, "welcome_guide_source.html"), "utf8");
assert(!guide.includes("funding frontier"), "guide has no elon/spacex credit");
assert(!guide.includes("Elon Musk"), "guide has no elon credit");
assert(guide.includes("Imagine That overlay for Grok Bot"), "guide overlay chip");

const needles = [
  "albertonunez",
  "alberto@local",
  "alberto-local",
  "Nunez-Garcia",
  "Alberto's Mac",
  "Alberto · Personal",
  "alberto@example.com",
  "alberto8793",
  "Pending Elon",
  "Elon Musk",
  "funding frontier",
  "Imagine-That-Ai/grok-D",
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
