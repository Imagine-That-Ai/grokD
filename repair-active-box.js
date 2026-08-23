#!/usr/bin/env node
// After a seat switch, Seat4 must have the computer that seat actually uses.
// Cursor: remote VM URL. Local: 127.0.0.1:1337. Never leave the last seat's box.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const store = require("./profile-store");
const box = require("./box-state");

const SEAT4 = process.env.GROK_SEAT4 || path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");

function repairInternal() {
  const profile = store.getActive();
  const all = store.list();
  if (!profile || !all.some((p) => p.id === profile.id)) {
    return { id: null, kind: null, action: "invalid-profile" };
  }
  const report = { id: profile.id, kind: profile.kind, action: "none" };
  if (profile.kind === "local") {
    box.clearCursorHost(SEAT4);
    try { fs.rmSync(path.join(SEAT4, "sand-secrets.json"), { force: true }); } catch (_) {}
    const dir = store.profileDataDir(profile.id);
    box.installLocalCredential(SEAT4, [dir, store.profileDataDir("local-d")]);
    box.writeLocalHost(SEAT4);
    report.action = "local-host";
    report.baseUrl = "http://127.0.0.1:1337";
    report.credential = fs.existsSync(box.credentialPath(SEAT4));
    return report;
  }
  box.clearLocalLeftovers(SEAT4);
  const dir = store.profileDataDir(profile.id);
  const identity = profile.identitySource || profile.sourceUserData;
  const remote = box.chooseCursorConnection(identity, dir);
  if (remote) {
    const installed = box.installConnection(remote, SEAT4);
    if (installed) {
      report.action = "installed-remote";
      const j = box.readJson(box.connectionPath(SEAT4));
      report.baseUrl = j && j.baseUrl;
      return report;
    }
  }
  box.clearCursorHost(SEAT4);
  report.action = "needs-reconnect";
  report.reason = "no Cursor VM on disk";
  return report;
}

function repair() {
  // withSwitchLock is reentrant, so a switch already in progress just runs inline.
  return require("./switch-profile").withSwitchLock(repairInternal);
}

if (require.main === module) {
  const r = repair();
  console.log(JSON.stringify(r));
}

module.exports = { repair, SEAT4 };
