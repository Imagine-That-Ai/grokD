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
const paths = require("./paths");
const SEAT4 = paths.SEAT4;

const secGuard = require("./security-guard");

function seed(seat) {
  const sw = require("./switch-profile");
  return sw.withSwitchLock(() => {
    const s = String(seat || "A").toUpperCase();
    if (!["A", "B", "C"].includes(s)) {
      throw new Error(`Invalid seat: '${seat}'. Must be one of 'A', 'B', or 'C'.`);
    }
    const identity = SEATS[s];
    if (!identity || !fs.existsSync(identity)) {
      throw new Error(`Seat ${s} identity root does not exist: ${identity}`);
    }
    const out = { identity, seat: s, copied: [] };
    const pairs = [
      ["sand-secrets.json", "sand-secrets.json"],
      ["gateway-descriptor.json", "gateway-descriptor.json"],
      ["sand-data/local-exec-daemon-connection.json", "sand-data/local-exec-daemon-connection.json"],
      ["sand-data/local-exec-daemon-credential.json", "sand-data/local-exec-daemon-credential.json"],
      ["sand-data/settings.json", "sand-data/settings.json"],
    ];
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-seed-"));
    secGuard.ensureDir0700(stageDir);
    const stStage = fs.lstatSync(stageDir);
    if (stStage.isSymbolicLink() || !stStage.isDirectory() || (typeof process.getuid === "function" && stStage.uid !== process.getuid())) {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch (_) {}
      throw new Error(`Insecure staging directory created: ${stageDir}`);
    }
    try {
      for (const [rel, dest] of pairs) {
        const src = path.join(identity, rel);
        if (fs.existsSync(src)) {
          const stageDest = path.join(stageDir, dest);
          secGuard.ensureDir0700(path.dirname(stageDest));
          secGuard.copyFile0600(src, stageDest);
          out.copied.push(rel);
        }
      }
      if (out.copied.length === 0) {
        throw new Error(`No usable identity files found in seat ${s} (${identity})`);
      }
      // Purge any sensitive files from previous seat that are absent in current source
      const allSensitiveFiles = [
        "sand-secrets.json",
        "gateway-descriptor.json",
        "sand-data/local-exec-daemon-connection.json",
        "sand-data/local-exec-daemon-credential.json",
        "daemon-data/local-exec-daemon-connection.json",
        "daemon-data/local-exec-daemon-credential.json",
        ".env-descriptor-account-bindings.json",
      ];
      for (const rel of allSensitiveFiles) {
        if (!out.copied.includes(rel)) {
          try { fs.rmSync(path.join(SEAT4, rel), { force: true }); } catch (_) {}
        }
      }
      // Copy staged files atomically to final destinations via rename
      for (const rel of out.copied) {
        const stageSrc = path.join(stageDir, rel);
        const finalDest = path.join(SEAT4, rel);
        secGuard.ensureDir0700(path.dirname(finalDest));
        const tmpDest = `${finalDest}.tmp.${process.pid}.${Date.now()}`;
        secGuard.copyFile0600(stageSrc, tmpDest);
        fs.renameSync(tmpDest, finalDest);
      }
      try { fs.rmSync(path.join(SEAT4, ".env-descriptor-account-bindings.json"), { force: true }); } catch {}
    } finally {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
    }
    const conn = path.join(SEAT4, "sand-data", "local-exec-daemon-connection.json");
    if (fs.existsSync(conn)) {
      try {
        const j = JSON.parse(fs.readFileSync(conn, "utf8"));
        out.baseUrl = j.baseUrl || null;
      } catch {}
    }
    return out;
  });
}

if (require.main === module) {
  const r = seed(process.argv[2] || "A");
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { seed, SEAT4, SEATS };
