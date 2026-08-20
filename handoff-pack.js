#!/usr/bin/env node
// Resume pack for a Local D chief after quota fall-over.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");

function pickChief(agents, preferredId) {
  const list = Array.isArray(agents) ? agents : [];
  if (preferredId) {
    const hit = list.find((a) => a && a.id === preferredId);
    if (hit) return hit;
  }
  const scored = list.map((a) => {
    const n = String(a && a.name || "").toLowerCase();
    let score = 0;
    if (/chief/.test(n)) score += 50;
    if (/grok/.test(n) && /d/.test(n)) score += 20;
    return { a, score };
  }).filter((x) => x.a && x.a.id).sort((x, y) => y.score - x.score);
  return (scored[0] && scored[0].score > 0 ? scored[0].a : list[0]) || null;
}

function buildPack(opts) {
  opts = opts || {};
  const when = opts.when || new Date().toISOString();
  const lines = [
    "# Fall-over handoff",
    "",
    "From: " + (opts.from || "unknown"),
    "To: " + (opts.to || "local-d"),
    "When: " + when,
    "Why: " + (opts.why || "included quota spent"),
    "",
    "You are the chief on Local D. Disperse this work. Do not wait for a recap.",
    "",
    "## Last user request",
    opts.lastUser || "(none captured)",
    "",
    "## Open work",
    opts.openWork || "(none listed)",
    "",
    "## Roster",
  ];
  const roster = Array.isArray(opts.agents) ? opts.agents : [];
  if (!roster.length) lines.push("(empty)");
  for (const a of roster) {
    lines.push("- " + (a.name || a.id) + (a.id ? " (" + a.id + ")" : ""));
  }
  lines.push("");
  return lines.join("\n");
}

function writePack(text) {
  const dir = path.join(ROOT, "runtime", "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "handoff-" + Date.now() + ".md");
  fs.writeFileSync(file, String(text || ""));
  return file;
}

function packBody(pack) {
  const s = String(pack || "");
  if (/\.md$/.test(s) && fs.existsSync(s)) {
    try { return fs.readFileSync(s, "utf8"); } catch { return s; }
  }
  return s;
}

module.exports = { pickChief, buildPack, writePack, packBody, ROOT };
