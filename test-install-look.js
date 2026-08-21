#!/usr/bin/env node
// User installs clone git and run install.sh. The look (face-tat icon, space
// kernel, provider logos, light/dark) has to be in that tree — not in gitignored
// hack/, not only on the build machine.
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = __dirname;
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function tracked(rel) {
  const out = execFileSync("git", ["ls-files", "--", rel], {
    cwd: ROOT, encoding: "utf8",
  }).trim();
  return out.split("\n").filter(Boolean);
}

{
  const icns = path.join(ROOT, "assets", "grokd-icon.icns");
  assert(fs.existsSync(icns), "assets/grokd-icon.icns missing");
  assert(fs.statSync(icns).size > 100000, "icon too small to be the mascot");
  assert(tracked("assets/grokd-icon.icns").includes("assets/grokd-icon.icns"),
    "icon must be git-tracked so clones get it");
  assert(!tracked("hack/grokd_icon_color.icns").length,
    "hack/ is kitchen-only; do not make clones depend on it");
}
ok("tracked-face-tat-icon");

{
  for (const rel of [
    "space-kernel.js",
    "space-field-gl.js",
    "provider-logos.js",
    "glass-theme.js",
    "profile-ui-inject.js",
    "assets/lobe/openai.svg",
    "assets/lobe/anthropic.svg",
    "assets/lobe/xai.svg",
    "assets/burnbar-mark.svg",
  ]) {
    assert(fs.existsSync(path.join(ROOT, rel)), "missing " + rel);
    assert(tracked(rel).includes(rel), "untracked " + rel);
  }
  const inject = read("profile-ui-inject.js");
  assert(inject.includes("gd-scheme-toggle"), "light/dark toggle");
  assert(inject.includes("space-kernel.js"), "kernel start");
  assert(inject.includes("punchCoverSky"), "cover punch-through");
}
ok("tracked-kernel-and-logos");

{
  const sh = read("install.sh");
  assert(sh.includes('ICON_SRC="$HERE/assets/grokd-icon.icns"'), "install reads git icon");
  assert(sh.includes("missing face-tat icon"), "install dies if icon is missing");
  assert(sh.includes("missing space-kernel.js"), "install dies if kernel is missing");
  assert(sh.includes("dest icon.icns is not the face-tat mascot"), "install compares dest icon");
  assert(!/ICON_SRC=""/.test(sh), "no empty icon fallback");
  assert(sh.includes("Developer ID Application: Imagine That AI"), "Developer ID, not silent ad-hoc first");
  assert(/codesign --force --deep --sign "\$SIGN_ID"/.test(sh), "uses the Developer ID when present");
}
ok("install-sh-ships-look");

{
  const drop = read("pack-drop.sh");
  assert(drop.includes("Install Grok Bot first"), "drop requires official Grok Bot");
  assert(fs.existsSync(path.join(ROOT, "pack-drop.sh")), "pack-drop.sh");
  const kernel = read("space-kernel.js");
  const inject = read("profile-ui-inject.js");
  assert(kernel.includes("sand-onboarding__landing"), "kernel hosts the landing page");
  assert(kernel.includes('position = "fixed"'), "kernel fills the window");
  assert(kernel.includes("gd-grok-hero"), "kernel hosts the grok bot");
  assert(kernel.includes("scaleY"), "grok sits in the disk plane");
  assert(inject.includes("#gd-grok-hero"), "hero mark css");
  assert(inject.includes("gd-sky-actions"), "sky landing actions");
  assert(inject.includes("Set up with Cursor"), "cursor setup on the sky page");
  assert(inject.includes("This Mac only"), "local-only on the sky page");
  assert(inject.includes('grok<span class="gd-qd">"D"</span>'), "wordmark is grok\"D\" as one mark");
  assert(inject.includes("border-radius: 12px !important"), "seat menu is a card, not an oval");
  assert(inject.includes("function isLocalSeat"), "local seat helper");
  assert(inject.includes("no Cursor sign-in"), "local cover copy");
  assert(inject.includes('action: "local"'), "loginClean no-ops on local-d");
  const ident = read("account-identity.js");
  assert(ident.includes("Local bots on this Mac"), "chip does not ask local-d to sign in");
  const preload = read("profile-auth-preload.js");
  assert(preload.includes("local-login-noop"), "official Sign in is a no-op on local");
}
ok("drop-and-landing");

{
  const rt = read("install-runtime.sh");
  assert(rt.includes('rsync -a --update "$APP_SRC/assets/"'), "first launch copies assets");
  const pack = read("pack-dist.sh");
  assert(pack.includes('"$ROOT/assets/"'), "shareable .app includes assets");
  assert(pack.includes("grokd-icon.icns"), "shareable .app stamps the mascot");
  const dock = read("patch-open-external.js");
  assert(dock.includes('path.join(ROOT, "assets", "grokd-icon.icns")'), "Dock uses git icon");
}
ok("runtime-and-dist-copy-assets");

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-look-home-"));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-look-src-"));
  fs.mkdirSync(path.join(src, "assets", "lobe"), { recursive: true });
  fs.writeFileSync(path.join(src, "assets", "grokd-icon.icns"), "icns-fixture");
  fs.writeFileSync(path.join(src, "assets", "lobe", "xai.svg"), "<svg/>");
  fs.writeFileSync(path.join(src, "space-kernel.js"), "module.exports = {};\n");
  const r = spawnSync("bash", [path.join(ROOT, "install-runtime.sh"), src], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { GROK_PROFILE_ROOT: home }),
    timeout: 20000,
  });
  assert(r.status === 0, "install-runtime failed: " + (r.stderr || r.stdout || r.status));
  assert(fs.readFileSync(path.join(home, "assets", "grokd-icon.icns"), "utf8") === "icns-fixture",
    "runtime did not copy the mascot");
  assert(fs.existsSync(path.join(home, "assets", "lobe", "xai.svg")),
    "runtime did not copy provider logos");
  assert(fs.existsSync(path.join(home, "space-kernel.js")),
    "runtime did not copy the kernel");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
}
ok("install-runtime-copies-look");

console.log("\n" + n + "/6 install-look checks passed");
