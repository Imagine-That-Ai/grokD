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

function applyContinueModel(dir) {
  let live = {};
  try { live = JSON.parse(fs.readFileSync(path.join(store.ROOT, "model-config.json"), "utf8")); }
  catch { live = {}; }
  const saved = path.join(dir, "model-config.json");
  let local = {};
  try { if (fs.existsSync(saved)) local = JSON.parse(fs.readFileSync(saved, "utf8")); } catch {}
  const next = {
    proxyTarget: "cliproxy",
    apiKey: "local-cliproxy",
    model: live.model || local.model || "grok-4.6",
    cursorAccount: local.cursorAccount || live.cursorAccount || "Primary Cursor Account",
  };
  const text = JSON.stringify(next, null, 2) + "\n";
  try { fs.writeFileSync(path.join(store.ROOT, "model-config.json"), text); } catch {}
  if (!isolatedRoot()) {
    try { require("./model-lib").writeConfig(next); } catch {}
  }
}

function applyLocal(profile, opts) {
  opts = opts || {};
  const takeover = !!opts.takeover;
  const dir = store.profileDataDir(profile.id);
  const persist = path.join(dir, "persistence");
  const agents = path.join(dir, "box-data", "agents");

  // Drop the previous Cursor VM or leftover gateway. Otherwise the official
  // app keeps that computer and the sidebar never becomes the local box.
  box.clearCursorHost(SEAT4);

  const sand = path.join(dir, "sand-data");
  if (fs.existsSync(sand)) {
    copyFile(path.join(sand, "local-exec-daemon-credential.json"), path.join(SEAT4, "sand-data", "local-exec-daemon-credential.json"));
    copyFile(path.join(sand, "settings.json"), path.join(SEAT4, "sand-data", "settings.json"));
  }
  box.installLocalCredential(SEAT4, [dir, path.join(store.ROOT, "profile-data", "local-d")]);
  box.writeLocalHost(SEAT4);

  if (!takeover && fs.existsSync(persist) && fs.readdirSync(persist).length) {
    copyTree(persist, path.join(SEAT4, "sand-client-persistence"));
  }
  if (fs.existsSync(agents) && fs.readdirSync(agents).length) {
    copyTree(agents, BOX_AGENTS);
  }
  const sec = path.join(dir, "secrets", "sand-secrets.json");
  if (fs.existsSync(sec)) copyFile(sec, path.join(SEAT4, "sand-secrets.json"));
  else if (fs.existsSync(path.join(LOCAL_SECRETS_BAK, "sand-secrets.json"))) {
    copyFile(path.join(LOCAL_SECRETS_BAK, "sand-secrets.json"), path.join(SEAT4, "sand-secrets.json"));
  }
  store.writeActiveEnv(profile);
  if (takeover) applyContinueModel(dir);
  else applyModel(dir);
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
  if (isolatedRoot()) return;
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

function isolatedRoot() {
  return store.ROOT !== path.join(os.homedir(), ".grok", "grokbot-d");
}

function ensureLocalBox() {
  if (isolatedRoot()) return;
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

function switchTo(id, opts) {
  opts = opts || {};
  const relaunch = opts.relaunch !== false;
  const next = store.get(resolveId(id));
  if (!next) throw new Error(`unknown profile ${id}`);
  const prev = store.getActive();
  const takeover = !!(opts.takeover && prev && prev.kind === "cursor" && next.kind === "local");
  if (prev && prev.id === next.id && !takeover) {
    store.writeActiveEnv(next);
    markOrbActive(next);
    return { ok: true, from: next.id, to: next.id, kind: next.kind, noop: true };
  }
  ensureLocalSecretBackup();
  if (prev && prev.id !== next.id) snapshot(prev);
  if (next.kind === "local") {
    applyLocal(next, { takeover });
    ensureLocalBox();
    if (takeover) {
      try {
        require("./takeover-local").seed({
          from: prev && prev.id,
          fromName: prev && prev.name,
        });
      } catch (e) {
        console.error("takeover:", e.message);
      }
    } else {
      fulfillDesiredBots(next);
    }
  } else {
    applyCursor(next);
  }
  store.setActive(next.id);
  markOrbActive(next);
  noteSwitch(prev && prev.id, next.id, next.kind);
  try {
    const p = path.join(store.ROOT, "runtime", "last-switch.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.takeover = takeover;
    fs.writeFileSync(p, JSON.stringify(j) + "\n");
  } catch {}
  try { require("./repair-active-box").repair(); } catch {}
  if (relaunch) relaunchD();
  return { ok: true, from: prev && prev.id, to: next.id, kind: next.kind, takeover };
}

function parseArgs(argv) {
  const out = { cmd: argv[2] || "list", flags: {}, rest: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-relaunch") out.flags.relaunch = false;
    else if (a === "--relaunch") out.flags.relaunch = true;
    else if (a === "--takeover" || a === "--continue") out.flags.takeover = true;
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
      const r = switchTo(id, { relaunch: flags.relaunch !== false, takeover: !!flags.takeover });
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
