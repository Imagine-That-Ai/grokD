#!/usr/bin/env node
// Copy a local-box agent onto a new UUID. Disables automations on the clone.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const paths = require("./paths");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function disableAutos(agentDir) {
  const root = path.join(agentDir, "automations");
  let n = 0;
  let folders = [];
  try { folders = fs.readdirSync(root, { withFileTypes: true }); } catch { return 0; }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const file = path.join(root, folder.name, "automation.json");
    try {
      const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!cfg || typeof cfg !== "object") continue;
      cfg.enabled = false;
      cfg.isEnabled = false;
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      n += 1;
    } catch {}
  }
  return n;
}

function findSourceDir(srcId, opts) {
  opts = opts || {};
  const id = String(srcId || "");
  if (!UUID_RE.test(id)) return null;
  const roots = [];
  if (opts.agentsDir) roots.push(opts.agentsDir);
  roots.push(paths.agentsDir());
  if (opts.profileId) {
    roots.push(path.join(paths.ROOT, "profile-data", opts.profileId, "box-data", "agents"));
  }
  const seen = new Set();
  for (const root of roots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const from = path.join(root, id);
    if (fs.existsSync(from)) return from;
  }
  return null;
}

function reconstructAgent(opts) {
  opts = opts || {};
  const root = opts.agentsDir || paths.agentsDir();
  const destId = opts.destId && UUID_RE.test(opts.destId) ? opts.destId : newId();
  const dest = path.join(root, destId);
  if (fs.existsSync(dest)) throw new Error("clone dest exists: " + destId);
  fs.mkdirSync(path.join(dest, "memory", "log"), { recursive: true });
  const name = String(opts.name || "Continued bot").replace(/\s*\(clone\)\s*$/i, "") + " (clone)";
  const prof = {
    name,
    origin: "failover-reconstruct",
    clonedFrom: {
      agentId: opts.srcId || null,
      profileId: opts.profileId || null,
      at: Date.now(),
      reconstructed: true,
    },
  };
  fs.writeFileSync(path.join(dest, "profile.json"), JSON.stringify(prof, null, 2) + "\n");
  fs.writeFileSync(path.join(dest, "settings.json"), "{}\n");
  const lines = [
    "# Failover clone",
    "",
    "Official Cursor bots often have no portable store.db.",
    "This local agent continues the work from the last captured turn.",
    "",
    "From: " + (opts.profileId || "?"),
    "When: " + new Date().toISOString(),
    "",
    "## Last user",
    opts.lastUser || "(none captured)",
    "",
    "## Recent turns",
  ];
  const excerpts = Array.isArray(opts.excerpts) ? opts.excerpts : [];
  if (!excerpts.length) lines.push("(none captured)");
  for (const line of excerpts) {
    lines.push("");
    lines.push(String(line).slice(0, 4000));
  }
  lines.push("");
  fs.writeFileSync(path.join(dest, "memory", "log", "failover.md"), lines.join("\n"));
  return { ok: true, srcId: opts.srcId || null, destId, dest, name, parked: 0, reconstructed: true };
}

function cloneAgent(srcId, opts) {
  opts = opts || {};
  const id = String(srcId || "");
  if (id && !UUID_RE.test(id)) throw new Error("clone source missing: " + srcId);
  const from = findSourceDir(id, opts);
  if (!from) {
    return reconstructAgent(Object.assign({}, opts, { srcId: id || null }));
  }
  const root = opts.agentsDir || paths.agentsDir();
  const destId = opts.destId && UUID_RE.test(opts.destId) ? opts.destId : newId();
  const dest = path.join(root, destId);
  if (fs.existsSync(dest)) throw new Error("clone dest exists: " + destId);
  copyDir(from, dest);
  let prof = {};
  try { prof = JSON.parse(fs.readFileSync(path.join(dest, "profile.json"), "utf8")); } catch {}
  const name = String(prof.name || "Bot").replace(/\s*\(clone\)\s*$/i, "");
  prof.name = name + " (clone)";
  prof.origin = "failover-clone";
  prof.clonedFrom = { agentId: srcId, at: Date.now(), profileId: opts.profileId || null };
  fs.writeFileSync(path.join(dest, "profile.json"), JSON.stringify(prof, null, 2) + "\n");
  const parked = disableAutos(dest);
  return { ok: true, srcId, destId, dest, name: prof.name, parked };
}

module.exports = { cloneAgent, reconstructAgent, findSourceDir, newId, disableAutos, UUID_RE };

if (require.main === module) {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: clone-bot.js <agent-uuid>");
    process.exit(2);
  }
  console.log(JSON.stringify(cloneAgent(src), null, 2));
}
