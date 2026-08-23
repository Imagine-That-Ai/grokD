#!/usr/bin/env node
// User installs clone git and run install.sh. The look (face-tat icon, space
// kernel, provider logos, light/dark) has to be in that tree — not in gitignored
// hack/, not only on the build machine.
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = __dirname;
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };
const throws = (fn, pattern, message) => {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  if (!caught || (pattern && !pattern.test(String(caught && caught.message || caught)))) {
    throw new Error(message + (caught ? `: ${caught.message || caught}` : ": no error thrown"));
  }
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function tracked(rel) {
  const out = execFileSync("git", ["ls-files", "--", rel], {
    cwd: ROOT, encoding: "utf8",
  }).trim();
  return out.split("\n").filter(Boolean);
}

const HOST_FILES = [
  "host-main.cjs",
  "agent-isolation/agent-store-worker.cjs",
  "agent-isolation/transcript-mirror-worker.cjs",
  "extensions/box-store-sync/box-store-vacuum-worker.cjs",
  "extensions/content-search/search-index-worker.cjs",
];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function integrity(buffer, blockSize = 8) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(sha256(buffer.subarray(offset, Math.min(buffer.length, offset + blockSize))));
  }
  return { algorithm: "SHA256", hash: sha256(buffer), blockSize, blocks };
}

function setAsarEntry(files, rel, entry) {
  const parts = rel.split("/");
  let cursor = files;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor[parts[i]] = cursor[parts[i]] || { files: {} };
    cursor = cursor[parts[i]].files;
  }
  cursor[parts[parts.length - 1]] = entry;
}

function writeAsarFixture(root, packed, unpacked = {}, name = "app.asar") {
  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(root, name);
  const header = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [rel, value] of Object.entries(packed)) {
    const buffer = Buffer.from(value);
    setAsarEntry(header.files, rel, {
      size: buffer.length,
      offset: String(offset),
      integrity: integrity(buffer),
    });
    chunks.push(buffer);
    offset += buffer.length;
  }
  for (const [rel, value] of Object.entries(unpacked)) {
    const buffer = Buffer.from(value);
    setAsarEntry(header.files, rel, {
      size: buffer.length,
      unpacked: true,
      integrity: integrity(buffer),
    });
    const destination = path.join(`${archive}.unpacked`, ...rel.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
  }
  const json = Buffer.from(JSON.stringify(header));
  const paddedJsonSize = Math.ceil(json.length / 4) * 4;
  const headerSize = 8 + paddedJsonSize;
  const pickle = Buffer.alloc(16 + paddedJsonSize);
  pickle.writeUInt32LE(4, 0);
  pickle.writeUInt32LE(headerSize, 4);
  pickle.writeUInt32LE(4 + paddedJsonSize, 8);
  pickle.writeUInt32LE(json.length, 12);
  json.copy(pickle, 16);
  fs.writeFileSync(archive, Buffer.concat([pickle, ...chunks]));
  return archive;
}

function hostFixture(prefix = "host") {
  const files = {};
  for (const rel of HOST_FILES) files[`dist/host/${rel}`] = `${prefix}:${rel}\n`;
  return files;
}

function writeHostTree(root, prefix = "bundled") {
  for (const rel of HOST_FILES) {
    const destination = path.join(root, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${prefix}:${rel}\n`);
  }
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
    "liquid-glass-btn.js",
    "enter-chat.js",
    "agent-store-db.js",
    "continuation.js",
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
  assert(inject.includes("gd-chip-continue-local"), "one-click local copy button");
  assert(inject.includes("sand.client.slice.client-meta.account-slot"), "exact official account selection");
  assert(inject.includes("selection.last-agent"), "exact official bot selection");
  assert(inject.includes("transcript.replicas."), "persisted official transcript capture");
  assert(inject.includes("processContinuationJobs"), "retryable continuation delivery");
  assert(inject.includes("processReturnJob"), "official return delivery");
  assert(inject.includes("Local work is ready to return"), "return review panel");
  assert(inject.includes("Context added. Review it, then send."), "return never claims auto-send");
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
  assert(inject.includes("skyCleared"), "sky actions last only until you pick");
  assert(inject.includes("liquid-glass-btn.js"), "sky buttons use the glass renderer");
  assert(inject.includes("enter-chat.js"), "Continue opens chat");
  assert(inject.includes("continue-sky"), "overlay command leaves the sky");
  assert(inject.includes("gd-lg-btn"), "three separate glass buttons");
  const lg = read("liquid-glass-btn.js");
  assert(lg.includes("sdRoundBox"), "volume sdf");
  assert(lg.includes("dFdx"), "volumetric normals");
  assert(lg.includes("1.14") && lg.includes("0.86"), "chromatic IOR split");
  assert(lg.includes("cau"), "caustics");
  assert(!read("glass-theme.js").includes("#gd-sky-actions"), "no blur-panel override on sky buttons");
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
  assert(rt.includes("GROK_D_APP_ASAR"), "first launch supports an exact ASAR source");
  assert(rt.includes("host_tree_complete"), "first launch verifies the whole host tree");
  assert(!rt.includes("npx"), "first launch must not need npm or the network");
  const pack = read("pack-dist.sh");
  assert(pack.includes('/assets/"'), "shareable .app includes assets");
  assert(pack.includes("grokd-icon.icns"), "shareable .app stamps the mascot");
  assert(pack.includes("asar-file.js"), "shareable .app includes offline ASAR recovery");
  assert(pack.includes("agent-store-db.js"), "shareable .app includes canonical local bot stores");
  assert(pack.includes("continuation.js"), "shareable .app includes official-to-local continuations");
  assert(
    /for required in[\s\S]*agent-store-db\.js continuation\.js takeover-local\.js[\s\S]*do/.test(pack),
    "packaging does not fail closed when continuation runtime files are absent"
  );
  assert(pack.includes("verified packaged ASAR host recovery"), "packaging verifies recoverable host entries");
  assert(pack.includes('cp "$RT/launch-d.sh" "$BIN"'), "shareable .app installs the fail-closed launcher");
  const dock = read("patch-open-external.js");
  assert(dock.includes('path.join(ROOT, "assets", "grokd-icon.icns")'), "Dock uses git icon");
}
ok("runtime-and-dist-copy-assets");

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-asar-file-"));
  try {
    const archive = writeAsarFixture(work, hostFixture("packed"), {
      "unpacked/example.txt": "outside archive\n",
    });
    const helper = require("./asar-file");
    const destination = path.join(work, "out", "host-main.cjs");
    const cli = spawnSync(process.execPath, [
      path.join(ROOT, "asar-file.js"),
      "extract-file",
      archive,
      "dist/host/host-main.cjs",
      destination,
    ], { encoding: "utf8", timeout: 10000 });
    assert(cli.status === 0, "asar-file CLI failed: " + (cli.stderr || cli.stdout || cli.status));
    assert(fs.readFileSync(destination, "utf8") === "packed:host-main.cjs\n", "packed ASAR bytes changed");
    assert((fs.statSync(destination).mode & 0o777) === 0o600, "extracted host file must be private");
    assert(helper.readFile(archive, "unpacked/example.txt").toString() === "outside archive\n",
      "unpacked ASAR entry failed");
    throws(() => helper.readFile(archive, "../outside"), /unsafe entry path/,
      "ASAR traversal was accepted");

    const corrupt = path.join(work, "corrupt.asar");
    const corruptBytes = fs.readFileSync(archive);
    const meta = helper.readHeader(archive);
    corruptBytes[meta.dataOffset] ^= 0xff;
    fs.writeFileSync(corrupt, corruptBytes);
    throws(() => helper.readFile(corrupt, "dist/host/host-main.cjs"), /SHA-256/,
      "corrupt ASAR entry passed integrity verification");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
ok("offline-asar-extraction-is-safe-and-verified");

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-look-home-"));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-look-src-"));
  fs.mkdirSync(path.join(src, "assets", "lobe"), { recursive: true });
  fs.writeFileSync(path.join(src, "assets", "grokd-icon.icns"), "icns-fixture");
  fs.writeFileSync(path.join(src, "assets", "lobe", "xai.svg"), "<svg/>");
  fs.writeFileSync(path.join(src, "space-kernel.js"), "module.exports = {};\n");
  writeHostTree(path.join(src, "host"));
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

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-first-run-"));
  const home = path.join(work, "home");
  const src = path.join(work, "empty-app-runtime");
  const fakeBin = path.join(work, "bin");
  const npxMarker = path.join(work, "npx-was-called");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "npx"), `#!/bin/sh\nprintf called > "${npxMarker}"\nexit 91\n`);
  fs.chmodSync(path.join(fakeBin, "npx"), 0o755);
  const archive = writeAsarFixture(work, hostFixture("fresh"));
  const r = spawnSync("bash", [path.join(ROOT, "install-runtime.sh"), src], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      GROK_D_APP_ASAR: archive,
      GROK_PROFILE_ROOT: home,
      NODE: process.execPath,
      PATH: `${fakeBin}:${process.env.PATH}`,
    }),
    timeout: 20000,
  });
  assert(r.status === 0, "fresh install-runtime failed: " + (r.stderr || r.stdout || r.status));
  assert(/runtime ready/.test(r.stdout), "fresh install did not report readiness");
  for (const rel of HOST_FILES) {
    const got = fs.readFileSync(path.join(home, "host", rel), "utf8");
    assert(got === `fresh:${rel}\n`, `fresh host mismatch: ${rel}`);
  }
  assert(!fs.existsSync(npxMarker), "first-run extraction called npx");
  fs.rmSync(work, { recursive: true, force: true });
}
ok("fresh-first-run-recovers-host-offline");

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-incomplete-run-"));
  const src = path.join(work, "empty-app-runtime");
  fs.mkdirSync(src, { recursive: true });
  const missing = path.join(work, "missing.asar");
  const r = spawnSync("bash", [path.join(ROOT, "install-runtime.sh"), src], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      GROK_D_APP_ASAR: missing,
      GROK_PROFILE_ROOT: path.join(work, "home"),
      NODE: process.execPath,
    }),
    timeout: 20000,
  });
  assert(r.status !== 0, "incomplete first run reported success");
  assert(!/runtime ready/.test(r.stdout), "incomplete first run printed runtime ready");
  assert(/NOT ready|does not exist/.test(r.stderr), "incomplete first run lacked a useful error");
  fs.rmSync(work, { recursive: true, force: true });
}
ok("incomplete-first-run-fails-closed");

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-untrusted-asar-"));
  const home = path.join(work, "home");
  const src = path.join(work, "empty-app-runtime");
  fs.mkdirSync(src, { recursive: true });
  const unsafeArchive = writeAsarFixture(work, hostFixture("unsafe"), {}, "arbitrary-name.asar");
  const r = spawnSync("bash", [path.join(ROOT, "install-runtime.sh"), src], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      GROK_D_APP_ASAR: unsafeArchive,
      GROK_PROFILE_ROOT: home,
      NODE: process.execPath,
    }),
    timeout: 20000,
  });
  assert(r.status !== 0, "untrusted GROK_D_APP_ASAR path was accepted");
  assert(/untrusted GROK_D_APP_ASAR path rejected/.test(r.stderr), "expected rejection error in stderr");
  fs.rmSync(work, { recursive: true, force: true });
}
ok("untrusted-app-asar-path-rejected");

{
  const launch = read("launch-d.sh");
  const ensure = read("ensure-local-box.sh");
  const shim = read("gateway-shim.js");
  const continuation = read("continuation.js");
  const inject = read("profile-ui-inject.js");
  assert(launch.includes("startup_fail"), "launcher has no actionable startup failure");
  assert(!/install-runtime\.sh[^\n]*\|\| true/.test(launch), "launcher swallows runtime install failure");
  assert(!/ensure-local-box\.sh[^\n]*\|\| true/.test(launch), "launcher swallows local-box failure");
  assert(ensure.includes('limit="${2:-120}"'), "readiness wait is not bounded/configurable");
  assert(ensure.includes("local host :1338 did not become API-ready"), "host API readiness is not enforced");
  assert(ensure.includes("gateway shim :1337 did not become healthy"), "shim health is not enforced");
  assert(ensure.includes("grok-d-gateway-shim"), "shim readiness cannot reject stale gateway code");
  assert(shim.includes('u.pathname === "/health"'), "gateway has no health endpoint");
  assert(shim.includes("contract: 2"), "gateway health contract is not versioned");
  assert(ensure.includes("agent-store-db.js"), "gateway store helper is not synced to the local runtime");
  assert(
    ensure.includes('--agents-root "$HACK/box-data/agents"'),
    "startup does not repair every existing local agent store"
  );
  assert(
    ensure.includes("a local bot database could not be repaired safely"),
    "startup store repair does not fail closed with diagnostics"
  );
  assert(shim.includes("ensureAgentStoreDb"), "new local bots bypass the canonical store helper");
  assert(
    inject.includes("if (!persisted || !persisted.agentId)"),
    "official clone can fall back to an approximate bot identity"
  );
  assert(
    !inject.includes('fs.writeFileSync(path.join(ROOT, "runtime", "takeover.json")'),
    "renderer still has a parallel unsafe takeover writer"
  );
  assert(
    inject.includes("if (landed) {") && inject.includes("Local copy is starting…"),
    "continuation delivery is acknowledged before its transcript marker lands"
  );
  assert(
    inject.includes("const editedText = existing && existing.dataset.jobId === job.id"),
    "return review loses user edits while reopening the source bot"
  );
  assert(
    inject.includes("composerText().includes(marker)")
      && !inject.includes("trim().slice(0, 160)"),
    "repeat return packets can be falsely acknowledged by a shared text prefix"
  );
  assert(
    inject.includes('const { clipboard } = require("electron")'),
    "return packet has no Electron clipboard fallback"
  );
  assert(
    continuation.includes('audience: "agent-control"')
      && continuation.includes("/api/deleteLocalAgents"),
    "managed-copy discard does not use the scoped agent-control API"
  );
  assert(!continuation.includes("fake-gateway-token"), "managed-copy discard uses a rejected static token");
  const queueAt = continuation.indexOf("job = queueContinue(record, snapshot, opts)");
  const registryAt = continuation.indexOf("saveRegistry(registry, opts)", queueAt);
  const activeAt = continuation.indexOf("setActiveAgent(record.localAgentId, opts)", registryAt);
  assert(
    queueAt >= 0 && registryAt > queueAt && activeAt > registryAt,
    "active agent changes before continuation job and registry are durable"
  );
}
ok("startup-contract-fails-closed");

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-launch-fail-"));
  const macos = path.join(work, "Test D.app", "Contents", "MacOS");
  const runtime = path.join(work, "Test D.app", "Contents", "Resources", "grokbot-d");
  const marker = path.join(work, "real-app-launched");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "launch-d.sh"), path.join(macos, "Grok Bot"));
  fs.writeFileSync(path.join(macos, "Grok Bot.real"), `#!/bin/sh\nprintf launched > "${marker}"\n`);
  fs.writeFileSync(path.join(runtime, "install-runtime.sh"), "#!/bin/sh\nexit 23\n");
  fs.chmodSync(path.join(macos, "Grok Bot"), 0o755);
  fs.chmodSync(path.join(macos, "Grok Bot.real"), 0o755);
  fs.chmodSync(path.join(runtime, "install-runtime.sh"), 0o755);
  const home = path.join(work, "runtime-home");
  const r = spawnSync("bash", [path.join(macos, "Grok Bot")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      GROK_D_NO_ALERT: "1",
      GROK_PROFILE_ROOT: home,
      GROK_SEAT4: path.join(work, "user-data"),
    }),
    timeout: 10000,
  });
  assert(r.status !== 0, "launcher continued after installer failure");
  assert(!fs.existsSync(marker), "real app launched after installer failure");
  const startupLog = path.join(home, "runtime", "startup.log");
  assert(fs.existsSync(startupLog), "launcher did not write startup diagnostics");
  assert(/STARTUP FAILED/.test(fs.readFileSync(startupLog, "utf8")), "startup diagnostics omitted the failure");
  fs.rmSync(work, { recursive: true, force: true });
}
ok("launcher-never-opens-an-infinite-spinner-after-bootstrap-failure");

{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "grokD-launch-normal-"));
  const macos = path.join(work, "Test D.app", "Contents", "MacOS");
  const runtime = path.join(work, "Test D.app", "Contents", "Resources", "grokbot-d");
  const marker = path.join(work, "real-app-args");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "launch-d.sh"), path.join(macos, "Grok Bot"));
  fs.writeFileSync(path.join(macos, "Grok Bot.real"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${marker}"\n`);
  fs.writeFileSync(path.join(runtime, "install-runtime.sh"), `#!/bin/sh\nmkdir -p "$GROK_PROFILE_ROOT"\nprintf '%s\\n' '{ "mode": "cursor" }' > "$GROK_PROFILE_ROOT/active-env.json"\n`);
  fs.chmodSync(path.join(macos, "Grok Bot"), 0o755);
  fs.chmodSync(path.join(macos, "Grok Bot.real"), 0o755);
  fs.chmodSync(path.join(runtime, "install-runtime.sh"), 0o755);
  const userData = path.join(work, "user-data");
  const r = spawnSync("bash", [path.join(macos, "Grok Bot")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      GROK_D_NO_ALERT: "1",
      GROK_PROFILE_ROOT: path.join(work, "runtime-home"),
      GROK_SEAT4: userData,
      GROK_D_CDP: "",
    }),
    timeout: 10000,
  });
  assert(r.status === 0, "normal no-CDP launch failed: " + (r.stderr || r.stdout || r.status));
  const args = fs.readFileSync(marker, "utf8");
  assert(args.includes(`--user-data-dir=${userData}`), "normal launch omitted its user-data directory");
  assert(!args.includes("--remote-debugging-port"), "normal launch unexpectedly enabled CDP");
  fs.rmSync(work, { recursive: true, force: true });
}
ok("launcher-works-with-cdp-disabled-on-macos-bash");

console.log("\n" + n + " install-look checks passed");
