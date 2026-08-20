#!/usr/bin/env node
// Copy a live Cursor seat's box connection into Seat4 (read-only source).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const SEATS = {
  A: path.join(os.homedir(), "Library/Application Support/Grok Bot"),
  B: path.join(os.homedir(), "Library/Application Support/GrokBotB"),
  C: path.join(os.homedir(), "Library/Application Support/GrokBotC"),
};
const SEAT4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");

function copyFile(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

function seed(seat) {
  const identity = SEATS[String(seat || "B").toUpperCase()] || SEATS.B;
  const out = { identity, copied: [] };
  const pairs = [
    ["sand-secrets.json", "sand-secrets.json"],
    ["gateway-descriptor.json", "gateway-descriptor.json"],
    ["sand-data/local-exec-daemon-connection.json", "sand-data/local-exec-daemon-connection.json"],
    ["sand-data/local-exec-daemon-credential.json", "sand-data/local-exec-daemon-credential.json"],
    ["sand-data/settings.json", "sand-data/settings.json"],
  ];
  for (const [rel, dest] of pairs) {
    if (copyFile(path.join(identity, rel), path.join(SEAT4, dest))) out.copied.push(rel);
  }
  try { fs.rmSync(path.join(SEAT4, ".env-descriptor-account-bindings.json"), { force: true }); } catch {}
  const conn = path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json");
  if (fs.existsSync(conn)) {
    const j = JSON.parse(fs.readFileSync(conn, "utf8"));
    out.baseUrl = j.baseUrl || null;
  }
  return out;
}

if (require.main === module) {
  const r = seed(process.argv[2] || "A");
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { seed, SEAT4, SEATS };
