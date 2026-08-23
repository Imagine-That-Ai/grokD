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
const secGuard = require("./security-guard");

let _switchLocked = false;
function isSwitchLocked() { return _switchLocked; }
function withSwitchLock(fn) {
  if (_switchLocked) return fn();
  const lockFile = path.join(store.ROOT, ".switch-profile.lock");
  const fd = secGuard.acquireFileLock(lockFile, { waitMs: 15000, staleMs: 30000 });
  if (fd === null) {
    throw new Error("Failed to acquire profile switch lock: another profile switch is in progress");
  }
  _switchLocked = true;
  try {
    return fn();
  } finally {
    _switchLocked = false;
    secGuard.releaseFileLock(lockFile, fd);
  }
}
function getSeat4() {
  return process.env.GROK_SEAT4 || paths.SEAT4;
}

function getBoxAgents() {
  return paths.agentsDir();
}

function copyTree(src, dst) {
  if (!src || !fs.existsSync(src)) return 0;
  const stSrc = fs.lstatSync(src);
  if (stSrc.isSymbolicLink() || !stSrc.isDirectory()) {
    throw new Error(`copyTree: source is not a regular directory or is a symlink: ${src}`);
  }
  secGuard.ensureDir0700(dst);
  const stDst = fs.lstatSync(dst);
  if (stDst.isSymbolicLink() || !stDst.isDirectory()) {
    throw new Error(`copyTree: destination is not a regular directory or is a symlink: ${dst}`);
  }
  const realSrc = fs.realpathSync(src);
  const realDst = fs.realpathSync(dst);

  function copyRec(curSrc, curDst) {
    secGuard.ensureDir0700(curDst);
    const stCurDst = fs.lstatSync(curDst);
    if (stCurDst.isSymbolicLink() || !stCurDst.isDirectory()) {
      throw new Error(`copyTree: destination component is not a directory or is a symlink: ${curDst}`);
    }
    const rCurDst = fs.realpathSync(curDst);
    if (rCurDst !== realDst && !rCurDst.startsWith(realDst + path.sep)) {
      throw new Error(`copyTree: destination escape detected: ${curDst}`);
    }

    const srcEntries = fs.readdirSync(curSrc, { withFileTypes: true });
    const srcNames = new Set(srcEntries.map((e) => e.name));

    const dstEntries = fs.readdirSync(curDst, { withFileTypes: true });
    for (const dEnt of dstEntries) {
      if (!srcNames.has(dEnt.name)) {
        const dPath = path.join(curDst, dEnt.name);
        fs.rmSync(dPath, { recursive: true, force: true });
      }
    }

    for (const ent of srcEntries) {
      const sPath = path.join(curSrc, ent.name);
      const dPath = path.join(curDst, ent.name);
      const st = fs.lstatSync(sPath);
      if (st.isSymbolicLink()) {
        throw new Error(`copyTree: symlink rejected at ${sPath}`);
      }
      if (fs.existsSync(dPath)) {
        const dSt = fs.lstatSync(dPath);
        if (dSt.isSymbolicLink()) {
          fs.rmSync(dPath, { force: true, recursive: true });
        }
      }
      if (st.isDirectory()) {
        const rSub = fs.realpathSync(sPath);
        if (!rSub.startsWith(realSrc + path.sep)) {
          throw new Error(`copyTree: directory escape detected: ${sPath}`);
        }
        copyRec(sPath, dPath);
      } else if (st.isFile()) {
        secGuard.copyFile0600(sPath, dPath);
      }
    }
  }
  copyRec(realSrc, realDst);
  return 1;
}

function copyFile(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  return secGuard.copyFile0600(src, dst);
}

function snapshotModel(dir) {
  copyFile(path.join(store.ROOT, "model-config.json"), path.join(dir, "model-config.json"));
}

function applyModel(dir) {
  const saved = path.join(dir, "model-config.json");
  const target = path.join(store.ROOT, "model-config.json");
  if (fs.existsSync(saved)) {
    copyFile(saved, target);
  } else {
    // Reset to clean default config for empty profile to eliminate cross-profile model leak
    const cleanDefault = Object.assign(require("./model-lib").defaultConfig(), {
      apiKey: "",
      savedAt: Date.now(),
    });
    try { secGuard.writeFile0600(target, JSON.stringify(cleanDefault, null, 2) + "\n"); } catch {}
  }
}

// A seat carries its own MCP tokens and tool cache; drop the previous seat's.
function rebindLocalMcp(profileId) {
  try {
    const localMcp = require("./local-mcp");
    localMcp.clearCaches();
    localMcp.bindProfile(profileId);
  } catch {}
}

function snapshot(profile) {
  const seat4 = getSeat4();
  const boxAgents = getBoxAgents();
  const dir = store.profileDataDir(profile.id);
  const persistSrc = path.join(seat4, "sand-client-persistence");
  copyTree(persistSrc, path.join(dir, "persistence"));
  box.snapshotHost(seat4, dir, { allowSwitchLock: true });
  snapshotModel(dir);
  if (profile.kind === "local" && fs.existsSync(boxAgents)) {
    copyTree(boxAgents, path.join(dir, "box-data", "agents"));
  }
  return dir;
}

function applyContinueModel(dir) {
  let live = {};
  try { live = JSON.parse(fs.readFileSync(path.join(store.ROOT, "model-config.json"), "utf8")); }
  catch { live = {}; }
  const saved = path.join(dir, "model-config.json");
  let local = {};
  try { if (fs.existsSync(saved)) local = JSON.parse(fs.readFileSync(saved, "utf8")); } catch {}
  const next = {
    proxyTarget: local.proxyTarget || "openburnbar",
    apiKey: (typeof local.apiKey === "string" && !secGuard.isGatewayOrLoopbackMarker(local.apiKey)) ? local.apiKey : "",
    model: live.model || local.model || "grok-4.6",
    cursorAccount: local.cursorAccount || live.cursorAccount || "Primary Cursor Account",
  };
  const text = JSON.stringify(next, null, 2) + "\n";
  try { secGuard.writeFile0600(path.join(store.ROOT, "model-config.json"), text); } catch {}
  if (!isolatedRoot()) {
    try { require("./model-lib").writeConfig(next); } catch {}
  }
}

function applyLocal(profile, opts) {
  opts = opts || {};
  const takeover = !!opts.takeover;
  const seat4 = getSeat4();
  const boxAgents = getBoxAgents();
  const dir = store.profileDataDir(profile.id);
  const persist = path.join(dir, "persistence");
  const agents = path.join(dir, "box-data", "agents");

  // Drop the previous Cursor VM or leftover gateway. Otherwise the official
  // app keeps that computer and the sidebar never becomes the local box.
  box.clearCursorHost(seat4);

  // clearCursorHost already dropped the descriptor; the tokens file is the
  // piece it leaves behind, so Local D never inherits foreign Cursor tokens.
  try { fs.rmSync(path.join(seat4, "sand-secrets.json"), { force: true }); } catch {}

  const localSecFile = path.join(dir, "secrets", "sand-secrets.json");
  if (fs.existsSync(localSecFile)) {
    let localSec = {};
    try { localSec = JSON.parse(fs.readFileSync(localSecFile, "utf8")); } catch { localSec = {}; }
    // Strictly sanitize: Local D must never have cursor access/refresh tokens
    delete localSec["cursor-access-token"];
    delete localSec["cursor-refresh-token"];
    delete localSec["cursor-dev-token"];
    delete localSec["cursor_access_token"];
    delete localSec["cursor_refresh_token"];
    delete localSec["cursorAuthToken"];
    delete localSec["accessToken"];
    delete localSec["refreshToken"];
    delete localSec["token"];
    delete localSec["sand-token"];
    secGuard.writeFile0600(path.join(seat4, "sand-secrets.json"), JSON.stringify(localSec, null, 2) + "\n");
  }

  const sand = path.join(dir, "sand-data");
  if (fs.existsSync(sand)) {
    copyFile(path.join(sand, "local-exec-daemon-credential.json"), path.join(seat4, "sand-data", "local-exec-daemon-credential.json"));
    copyFile(path.join(sand, "settings.json"), path.join(seat4, "sand-data", "settings.json"));
  }
  box.installLocalCredential(seat4, [dir, path.join(store.ROOT, "profile-data", "local-d")]);
  box.writeLocalHost(seat4);

  const persistDst = path.join(seat4, "sand-client-persistence");
  if (!takeover && fs.existsSync(persist) && fs.readdirSync(persist).length) {
    copyTree(persist, persistDst);
  } else if (!takeover) {
    try { fs.rmSync(persistDst, { recursive: true, force: true }); } catch {}
    secGuard.ensureDir0700(persistDst);
  }

  if (fs.existsSync(agents) && fs.readdirSync(agents).length) {
    copyTree(agents, boxAgents);
  } else {
    try {
      if (fs.existsSync(boxAgents)) {
        for (const f of fs.readdirSync(boxAgents)) {
          fs.rmSync(path.join(boxAgents, f), { recursive: true, force: true });
        }
      }
    } catch {}
    secGuard.ensureDir0700(boxAgents);
  }

  rebindLocalMcp(profile.id);

  store.writeActiveEnv(profile);
  if (takeover) applyContinueModel(dir);
  else applyModel(dir);
}

function applyCursor(profile) {
  const seat4 = getSeat4();
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
  box.clearCursorHost(seat4);

  // D's last in-app login is newer than a sibling official app seed.
  // Prefer that, or the newer of the two files.
  const srcSec = box.newerFile(hasSavedSec ? savedSec : null, liveSec);
  if (srcSec) copyFile(srcSec, path.join(seat4, "sand-secrets.json"));
  else if (!identity && !hasSavedSec) {
    // Fresh in-app sign-in: drop the previous seat's tokens or Cursor
    // will skip login and the new profile inherits the old account.
    try { fs.rmSync(path.join(seat4, "sand-secrets.json"), { force: true }); } catch {}
    try { fs.rmSync(path.join(seat4, "gateway-descriptor.json"), { force: true }); } catch {}
  }

  const savedGd = path.join(dir, "secrets", "gateway-descriptor.json");
  const liveGd = identity ? path.join(identity, "gateway-descriptor.json") : null;
  const srcGd = box.newerFile(
    fs.existsSync(savedGd) ? savedGd : null,
    liveGd && fs.existsSync(liveGd) ? liveGd : null
  );
  // Encrypted official descriptors for this-Mac seats often still hold a
  // dead cursorvm.com pod. Copying that file makes D decrypt it on boot and
  // the Mac looks offline again. A healthy plaintext VM is installed below.
  if (srcGd && !box.officialUsesThisMac(identity)) {
    copyFile(srcGd, path.join(seat4, "gateway-descriptor.json"));
  }

  box.resetForeignSettings(seat4, box.accountScopeFromSecrets(seat4));

  const remote = box.chooseCursorConnection(identity, dir);
  if (remote) box.installConnection(remote, seat4);
  // No reachable VM: leave Seat4 empty so official reconnect can mint one.
  // Do not fall back to this-Mac local-exec — D's local box already owns that
  // lease and the daemon dies with "desktop ownership lost".

  const persistDst = path.join(seat4, "sand-client-persistence");
  const livePersist = identity && path.join(identity, "sand-client-persistence");
  if (livePersist && fs.existsSync(livePersist) && fs.readdirSync(livePersist).length) {
    copyTree(livePersist, persistDst);
  } else {
    const persistSnap = path.join(dir, "persistence");
    if (fs.existsSync(persistSnap) && fs.readdirSync(persistSnap).length) {
      copyTree(persistSnap, persistDst);
    } else {
      try { fs.rmSync(persistDst, { recursive: true, force: true }); } catch {}
      secGuard.ensureDir0700(persistDst);
    }
  }

  rebindLocalMcp(profile.id);

  applyModel(dir);
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
  const mains = pgrepIds("Grok Bot.real --user-data-dir");
  const wrap = pgrepIds("Grok Bot$");
  const seat = "GrokBotSeat4";
  const out = [];
  for (const pid of [...wrap, ...mains]) {
    try {
      const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 2000 });
      if (cmd.includes(seat)) out.push(pid);
    } catch {}
  }
  return [...new Set(out)];
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
    const runtimeP = path.join(store.ROOT, "runtime", "active-profile.json");
    secGuard.ensureDir0700(path.dirname(runtimeP));
    secGuard.writeFile0600(runtimeP, JSON.stringify({ active: orbId }) + "\n");
    const hackDir = paths.existingHack();
    if (hackDir && fs.existsSync(hackDir)) {
      secGuard.ensureDir0700(hackDir);
      secGuard.writeFile0600(path.join(hackDir, "active-profile.json"), JSON.stringify({ active: orbId }) + "\n");
    }
  } catch {}
}

let _switchSequence = 0;

function fulfillDesiredBots(profile, switchSeq) {
  if (isolatedRoot()) return;
  const want = Number(profile.desiredBots);
  if (!Number.isFinite(want) || want < 1 || want > 20) return;
  const http = require("http");
  const callApi = (endpoint, payload, aud = "grokbot-proxy") => new Promise((resolve) => {
    const data = JSON.stringify(payload || {});
    const token = secGuard.mintSessionJwt({ audience: aud, expiresInSeconds: 60 });
    const req = http.request({
      hostname: "127.0.0.1",
      port: 1337,
      path: endpoint,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "content-length": Buffer.byteLength(data),
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });

  (async () => {
    try {
      if (switchSeq !== _switchSequence || store.getActive().id !== profile.id) return;
      const listRes = await callApi("/api/listAgents", {});
      if (!Array.isArray(listRes)) {
        return;
      }
      let currentAgents = listRes;
      while (currentAgents.length < want) {
        if (switchSeq !== _switchSequence || store.getActive().id !== profile.id) break;
        const i = currentAgents.length;
        const created = await callApi("/api/createAgent", { name: `Bot ${i + 1}`, description: "profile desired bot", origin: "user" }, "bot-create");
        if (!created || !created.id) break;
        if (switchSeq !== _switchSequence || store.getActive().id !== profile.id) {
          try {
            await callApi("/api/deleteLocalAgents", { ids: [created.id] }, "agent-control");
          } catch (_) {}
          break;
        }
        const reList = await callApi("/api/listAgents", {});
        if (!Array.isArray(reList)) break;
        currentAgents = reList;
      }
    } catch (e) {
      console.error("desiredBots:", e.message);
    }
  })();
}

function isolatedRoot() {
  return store.ROOT !== path.join(os.homedir(), ".grok", "grokbot-d");
}

function ensureLocalBox() {
  if (isolatedRoot()) return;
  const sh = path.join(store.ROOT, "ensure-local-box.sh");
  if (fs.existsSync(sh)) {
    try {
      const real = fs.realpathSync(sh);
      const st = fs.lstatSync(real);
      if (st.isFile() && (typeof process.getuid !== "function" || st.uid === process.getuid())) {
        execFileSync("bash", [real], { stdio: "ignore" });
      }
    } catch (_) {}
  }
}

const ALIASES = {
  "grok-original": "local-d",
  "grok-bot": "local-d",
  "grok-a": "cursor-a",
  "grok-d": "local-d",
};

function resolveId(id) {
  return ALIASES[id] || id;
}

function switchTo(id, opts) {
  return withSwitchLock(() => {
    opts = opts || {};
    const relaunch = opts.relaunch !== false;
    const next = store.get(resolveId(id));
    if (!next) throw new Error(`unknown profile ${id}`);
    const prev = store.getActive();
    if (opts.expectedFrom && prev && prev.id !== opts.expectedFrom) {
      return { ok: false, skipped: true, reason: "profile-changed-before-switch", active: prev.id, expected: opts.expectedFrom };
    }
    const takeover = !!(opts.takeover && prev && prev.kind === "cursor" && next.kind === "local");
    if (prev && prev.id === next.id && !takeover) {
      store.writeActiveEnv(next);
      markOrbActive(next);
      rebindLocalMcp(next.id);
      return { ok: true, from: next.id, to: next.id, kind: next.kind, noop: true };
    }
    const currentSeq = ++_switchSequence;
    if (prev && prev.id !== next.id) snapshot(prev);
    let continuation = null;
    try {
      if (next.kind === "local") {
        applyLocal(next, { takeover });
        ensureLocalBox();
        if (takeover) {
          const seedContinuation = opts.seedContinuation
            || ((payload) => require("./takeover-local").seed(payload));
          continuation = seedContinuation({
            from: prev && prev.id,
            fromName: prev && prev.name,
          });
          if (!continuation || continuation.ok !== true || !continuation.id) {
            throw new Error("continuation seed returned no local agent");
          }
        }
      } else {
        applyCursor(next);
      }
      store.setActive(next.id);
      markOrbActive(next);
      rebindLocalMcp(next.id);
      if (next.kind === "local" && !takeover) {
        fulfillDesiredBots(next, currentSeq);
      }
      noteSwitch(prev && prev.id, next.id, next.kind);
      try {
        const p = path.join(store.ROOT, "runtime", "last-switch.json");
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        j.takeover = takeover;
        fs.writeFileSync(p, JSON.stringify(j) + "\n");
      } catch {}
      try { require("./repair-active-box").repair(); } catch {}
      if (relaunch && !isolatedRoot()) {
        relaunchD();
      }
      return {
        ok: true,
        from: prev && prev.id,
        to: next.id,
        kind: next.kind,
        takeover,
        continuation: continuation && {
          id: continuation.id,
          reused: continuation.reused,
          status: continuation.status,
          continueJob: continuation.continueJob || null,
        },
      };
    } catch (error) {
      if (prev) {
        try {
          if (prev.kind === "local") applyLocal(prev);
          else applyCursor(prev);
          store.setActive(prev.id);
          store.writeActiveEnv(prev);
          markOrbActive(prev);
          rebindLocalMcp(prev.id);
          try { require("./repair-active-box").repair(); } catch {}
        } catch (rollbackError) {
          throw new Error(
            `profile switch failed: ${error.message}; previous-seat restore failed: ${rollbackError.message}`
          );
        }
      }
      throw error;
    }
  });
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
      if (flags.family) throw new Error("family import of B/C is retired");
      store.assertSeatAllowed(flags.from);
      store.assertSeatAllowed(flags.identity);
      const p = store.add({
        name: flags.name,
        kind: flags.kind,
        fromSeat: flags.from,
        identitySeat: flags.identity,
        sourceUserData: flags.path,
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

module.exports = {
  snapshot,
  applyLocal,
  applyCursor,
  applyModel,
  switchTo,
  dPids,
  relaunchD,
  resolveId,
  isolatedRoot,
  getSeat4,
  getBoxAgents,
  get SEAT4() { return getSeat4(); },
  get BOX_AGENTS() { return getBoxAgents(); },
  box,
  writeRelaunchPlist,
  withSwitchLock,
  isSwitchLocked,
};
