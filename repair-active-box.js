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

function repair() {
  const profile = store.getActive();
  const report = { id: profile && profile.id, kind: profile && profile.kind, action: "none" };
  if (!profile) return report;
  if (profile.kind === "local") {
    box.clearCursorHost(SEAT4);
    const dir = store.profileDataDir(profile.id);
    box.installLocalCredential(SEAT4, [dir, store.profileDataDir("local-d")]);
    box.writeLocalHost(SEAT4);
    report.action = "local-host";
    report.baseUrl = "http://127.0.0.1:1337";
    report.credential = fs.existsSync(box.credentialPath(SEAT4));
    return report;
  }
  const dir = store.profileDataDir(profile.id);
  const identity = profile.identitySource || profile.sourceUserData;
  const remote = box.pickRemoteConnection([identity, dir, SEAT4]);
  if (remote) {
    if (!box.isRemoteConnection(box.connectionPath(SEAT4))) {
      box.installConnection(remote, SEAT4);
      report.action = "installed-remote";
    } else {
      report.action = "already-remote";
    }
    const j = box.readJson(box.connectionPath(SEAT4));
    report.baseUrl = j && j.baseUrl;
    return report;
  }
  if (box.isRemoteConnection(box.connectionPath(SEAT4))) {
    report.action = "kept-remote";
    report.baseUrl = box.readJson(box.connectionPath(SEAT4)).baseUrl;
    return report;
  }
  report.action = "no-remote-available";
  return report;
}

if (require.main === module) {
  const r = repair();
  console.log(JSON.stringify(r));
}

module.exports = { repair, SEAT4 };
