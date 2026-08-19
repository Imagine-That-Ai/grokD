#!/usr/bin/env node
// Apply a Grok D profile: local box or a Cursor seat identity.
// Does not kill Grok Bot B. Use --no-relaunch in tests.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");
const store = require("./profile-store");
const paths = require("./paths");
const box = require("./box-state");

const SEAT4 = process.env.GROK_SEAT4 || paths.SEAT4;
const BOX_AGENTS = paths.agentsDir();
const LOCAL_SECRETS_BAK = path.join(store.ROOT, "local-d-secrets");

function copyTree(src, dst) {
  if (!src || !fs.existsSync(src)) return 0;
  let entries = [];
  try { entries = fs.readdirSync(src); } catch { return 0; }
  if (!entries.length) return 0;
  fs.mkdirSync(dst, { recursive: true });
  execFileSync("rsync", ["-a", "--delete", src.replace(/\/?$/, "/") , dst.replace(/\/?$/, "/")]);
  return 1;
}

function copyFile(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

function snapshotModel(dir) {
  copyFile(path.join(store.ROOT, "model-config.json"), path.join(dir, "model-config.json"));
}

function applyModel(dir) {
  const saved = path.join(dir, "model-config.json");
  if (fs.existsSync(saved)) copyFile(saved, path.join(store.ROOT, "model-config.json"));
}

function snapshot(profile) {
  const dir = store.profileDataDir(profile.id);
  const persistSrc = path.join(SEAT4, "sand-client-persistence");
  copyTree(persistSrc, path.join(dir, "persistence"));
  box.snapshotHost(SEAT4, dir);
  snapshotModel(dir);
  if (profile.kind === "local" && fs.existsSync(BOX_AGENTS)) {
    copyTree(BOX_AGENTS, path.join(dir, "box-data", "agents"));
    copyFile(path.join(SEAT4, "sand-secrets.json"), path.join(LOCAL_SECRETS_BAK, "sand-secrets.json"));
    copyFile(path.join(SEAT4, "gateway-descriptor.json"), path.join(LOCAL_SECRETS_BAK, "gateway-descriptor.json"));
  }
  return dir;
}

function ensureLocalSecretBackup() {
  fs.mkdirSync(LOCAL_SECRETS_BAK, { recursive: true });
  const dest = path.join(LOCAL_SECRETS_BAK, "sand-secrets.json");
  if (!fs.existsSync(dest) && fs.existsSync(path.join(SEAT4, "sand-secrets.json"))) {
    copyFile(path.join(SEAT4, "sand-secrets.json"), dest);
    copyFile(path.join(SEAT4, "gateway-descriptor.json"), path.join(LOCAL_SECRETS_BAK, "gateway-descriptor.json"));
  }
}

function applyLocal(profile) {
  const dir = store.profileDataDir(profile.id);
  const persist = path.join(dir, "persistence");
  const agents = path.join(dir, "box-data", "agents");
  if (fs.existsSync(persist) && fs.readdirSync(persist).length) {
    copyTree(persist, path.join(SEAT4, "sand-client-persistence"));
  }
  if (fs.existsSync(agents) && fs.readdirSync(agents).length) {
    copyTree(agents, BOX_AGENTS);
  }
  const sec = path.join(dir, "secrets", "sand-secrets.json");
  if (fs.existsSync(sec)) copyFile(sec, path.join(SEAT4, "sand-secrets.json"));
  else if (fs.existsSync(path.join(LOCAL_SECRETS_BAK, "sand-secrets.json"))) {
    copyFile(path.join(LOCAL_SECRETS_BAK, "sand-secrets.json"), path.join(SEAT4, "sand-secrets.json"));
    copyFile(path.join(LOCAL_SECRETS_BAK, "gateway-descriptor.json"), path.join(SEAT4, "gateway-descriptor.json"));
  }
  const gd = path.join(dir, "secrets", "gateway-descriptor.json");
  if (fs.existsSync(gd)) copyFile(gd, path.join(SEAT4, "gateway-descriptor.json"));
  box.writeLocalHost(SEAT4);
  applyModel(dir);
  store.writeActiveEnv(profile);
}

function applyCursor(profile) {
  const dir = store.profileDataDir(profile.id);
  const identity = profile.identitySource || profile.sourceUserData || null;
  const liveSec = identity && fs.existsSync(path.join(identity, "sand-secrets.json"))
    ? path.join(identity, "sand-secrets.json")
    : null;
  const savedSec = path.join(dir, "secrets", "sand-secrets.json");
  const hasSavedSec = fs.existsSync(savedSec);

  // Import profiles must have secrets. Sign-in profiles (no identity) may
  // start empty so this app can do the official Cursor login itself.
  if (identity && !liveSec && !hasSavedSec) {
    throw new Error(`cursor identity missing at ${identity}`);
  }

  // Never keep the previous profile's computer. A leftover local :1337
  // or another seat's VM is what showed "isn't available on this account".
  box.clearCursorHost(SEAT4);

  // D's last in-app login is newer than a sibling official app seed.
  // Prefer that, or the newer of the two files.
  const srcSec = box.newerFile(hasSavedSec ? savedSec : null, liveSec);
  if (srcSec) copyFile(srcSec, path.join(SEAT4, "sand-secrets.json"));

  const savedGd = path.join(dir, "secrets", "gateway-descriptor.json");
  const liveGd = identity ? path.join(identity, "gateway-descriptor.json") : null;
  const srcGd = box.newerFile(
    fs.existsSync(savedGd) ? savedGd : null,
    liveGd && fs.existsSync(liveGd) ? liveGd : null
  );
  if (srcGd) copyFile(srcGd, path.join(SEAT4, "gateway-descriptor.json"));

  box.resetForeignSettings(SEAT4, box.accountScopeFromSecrets(SEAT4));

  const remote = box.pickRemoteConnection([
    identity,
    path.join(dir),
  ]);
  if (remote) box.installConnection(remote, SEAT4);
  // Cursor send goes to that seat's computer, not the last local proxy.

  const persistDst = path.join(SEAT4, "sand-client-persistence");
  const livePersist = identity && path.join(identity, "sand-client-persistence");
  if (livePersist && fs.existsSync(livePersist) && fs.readdirSync(livePersist).length) {
    copyTree(livePersist, persistDst);
  } else {
    const persistSnap = path.join(dir, "persistence");
    if (fs.existsSync(persistSnap) && fs.readdirSync(persistSnap).length) {
      copyTree(persistSnap, persistDst);
    }
  }
  store.writeActiveEnv(profile);
}

function pgrepIds(pattern) {
  try {
    const out = execFileSync("pgrep", ["-f", pattern], { encoding: "utf8", timeout: 2000 });
    const self = process.pid;
    return out.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n !== self);
  } catch {
    return [];
  }
}

function dPids() {
  const mains = pgrepIds("Grok Bot D.app/Contents/MacOS/Grok Bot.real --user-data-dir");
  const wrap = pgrepIds("Grok Bot D.app/Contents/MacOS/Grok Bot$");
  return [...new Set([...wrap, ...mains])];
}

function noteSwitch(fromId, toId, kind) {
  try {
    const p = path.join(store.ROOT, "runtime", "last-switch.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      ts: Date.now(),
      from: fromId || null,
      to: toId,
      kind,
    }) + "\n");
  } catch {}
}

function writeRelaunchPlist(sh, delay) {
  const agents = path.join(os.homedir(), "Library/LaunchAgents");
  const label = "com.imaginethat.grokbot.d.relaunch";
  const plist = path.join(agents, `${label}.plist`);
  fs.mkdirSync(agents, { recursive: true });
  const log = path.join(store.ROOT, "runtime", "relaunch.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${sh}</string>
    <string>${delay}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plist, xml);
  return { label, plist };
}

function relaunchD() {
  // launchd runs in the Aqua session. A bash child of D dies with D,
  // which is why open never produced a second process.
  const sh = path.join(store.ROOT, "relaunch-d.sh");
  const delay = "0.6";
  try {
    const uid = typeof process.getuid === "function"
      ? process.getuid()
      : parseInt(execFileSync("id", ["-u"], { encoding: "utf8" }).trim(), 10);
    const { label, plist } = writeRelaunchPlist(sh, delay);
    const domain = `gui/${uid}`;
    try { execFileSync("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore", timeout: 3000 }); } catch {}
    execFileSync("launchctl", ["bootstrap", domain, plist], { stdio: "ignore", timeout: 5000 });
    return;
  } catch (e) {
    try {
      fs.appendFileSync(path.join(store.ROOT, "runtime", "relaunch.log"), `launchctl-fail ${e.message}\n`);
    } catch {}
  }
  spawn("bash", [sh, delay], { detached: true, stdio: "ignore" }).unref();
}

function markOrbActive(profile) {
  const orbId = profile.kind === "local"
    ? "grok-d"
    : ({ A: "grok-a", B: "grok-b", C: "grok-c" }[profile.seat] || "grok-d");
  try {
    fs.mkdirSync("/tmp/grokbot-hack", { recursive: true });
    fs.writeFileSync("/tmp/grokbot-hack/active-profile.json", JSON.stringify({ active: orbId }) + "\n");
  } catch {}
}

function fulfillDesiredBots(profile) {
  const want = Number(profile.desiredBots);
  if (!Number.isFinite(want) || want < 1 || want > 20) return;
  try {
    const raw = execFileSync("curl", [
      "-sS", "-X", "POST", "http://127.0.0.1:1337/api/listAgents",
      "-H", "content-type: application/json",
      "-H", "authorization: Bearer fake-gateway-token",
      "-d", "{}",
    ], { encoding: "utf8", timeout: 15000 });
    const agents = JSON.parse(raw);
    const have = Array.isArray(agents) ? agents.length : 0;
    for (let i = have; i < want; i++) {
      execFileSync("curl", [
        "-sS", "-X", "POST", "http://127.0.0.1:1337/api/createAgent",
        "-H", "content-type: application/json",
        "-H", "authorization: Bearer fake-gateway-token",
        "-d", JSON.stringify({ name: `Bot ${i + 1}`, description: "profile desired bot", origin: "user" }),
      ], { encoding: "utf8", timeout: 15000 });
    }
  } catch (e) {
    console.error("desiredBots:", e.message);
  }
}

function ensureLocalBox() {
  const sh = path.join(store.ROOT, "ensure-local-box.sh");
  const fallback = "/tmp/grokbot-hack/ensure-local-box.sh";
  const script = fs.existsSync(sh) ? sh : fallback;
  if (fs.existsSync(script)) {
    execFileSync("bash", [script], { stdio: "ignore" });
  }
}

const ALIASES = {
  "grok-original": "local-d",
  "grok-bot": "local-d",
  "grok-a": "cursor-a",
  "grok-b": "cursor-b",
  "grok-c": "cursor-c",
  "grok-d": "local-d",
};

function resolveId(id) {
  return ALIASES[id] || id;
}

function switchTo(id, { relaunch = true } = {}) {
  const next = store.get(resolveId(id));
  if (!next) throw new Error(`unknown profile ${id}`);
  const prev = store.getActive();
  if (prev && prev.id === next.id) {
    store.writeActiveEnv(next);
    markOrbActive(next);
    return { ok: true, from: next.id, to: next.id, kind: next.kind, noop: true };
  }
  ensureLocalSecretBackup();
  if (prev) snapshot(prev);
  if (next.kind === "local") {
    applyLocal(next);
    ensureLocalBox();
    fulfillDesiredBots(next);
  } else {
    applyCursor(next);
  }
  store.setActive(next.id);
  markOrbActive(next);
  noteSwitch(prev && prev.id, next.id, next.kind);
  try { require("./repair-active-box").repair(); } catch {}
  if (relaunch) relaunchD();
  return { ok: true, from: prev && prev.id, to: next.id, kind: next.kind };
}

function parseArgs(argv) {
  const out = { cmd: argv[2] || "list", flags: {}, rest: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-relaunch") out.flags.relaunch = false;
    else if (a === "--relaunch") out.flags.relaunch = true;
    else if (a.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out.flags[a.slice(2)] = argv[++i];
    } else out.rest.push(a);
  }
  return out;
}

if (require.main === module) {
  const { cmd, flags, rest } = parseArgs(process.argv);
  try {
    if (cmd === "list") {
      const s = store.load();
      for (const p of s.profiles) {
        console.log(`${p.id === s.activeId ? "*" : " "} ${p.id}\t${p.kind}\t${p.name}`);
      }
    } else if (cmd === "add") {
      const rosterSources = flags.family
        ? [store.SEATS.A, store.SEATS.B, store.SEATS.C]
        : undefined;
      const p = store.add({
        name: flags.name,
        kind: flags.kind,
        fromSeat: flags.from,
        identitySeat: flags.identity,
        sourceUserData: flags.path,
        rosterSources,
        desiredBots: flags.bots ? Number(flags.bots) : null,
      });
      console.log(JSON.stringify({ ok: true, id: p.id, kind: p.kind, name: p.name }));
    } else if (cmd === "remove") {
      store.remove(resolveId(rest[0] || flags.id));
      console.log(JSON.stringify({ ok: true }));
    } else if (cmd === "switch" || cmd === "apply") {
      const id = rest[0] || flags.id;
      const r = switchTo(id, { relaunch: flags.relaunch !== false });
      console.log(JSON.stringify(r));
    } else if (cmd === "active") {
      console.log(JSON.stringify(store.getActive()));
    } else {
      console.error("usage: switch-profile.js list|add|remove|switch|active");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { snapshot, applyLocal, applyCursor, switchTo, dPids, relaunchD, resolveId, SEAT4, BOX_AGENTS, box, writeRelaunchPlist };
