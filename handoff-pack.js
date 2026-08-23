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
  function sanitizeTranscript(text, maxLen) {
    if (text == null) return "(none captured)";
    let s = String(text).slice(0, maxLen);
    s = s.replace(/`{3,}/g, "'''").replace(/~{3,}/g, "---");
    s = s.replace(/<!--/g, "&lt;!--").replace(/-->/g, "--&gt;");
    return s;
  }
  function sanitizeField(text, maxLen = 120) {
    if (text == null) return "";
    let s = String(text).split(/[\r\n]/)[0].slice(0, maxLen);
    return s.replace(/[:`#*_[\]<>~]/g, " ").replace(/\s+/g, " ").trim();
  }

  const lines = [
    "# Fall-over handoff",
    "",
    "From: " + sanitizeField(opts.from || "unknown", 64),
    "To: " + sanitizeField(opts.to || "local-d", 64),
    "When: " + sanitizeField(when, 64),
    "Why: " + sanitizeField(opts.why || "included quota spent", 128),
    "",
    "You are the chief on Local D. Disperse this work. Do not wait for a recap.",
    "",
    "## Last user request",
    "<!-- UNTRUSTED_EXTERNAL_TRANSCRIPT_START -->",
    "```text",
    sanitizeTranscript(opts.lastUser, 4000),
    "```",
    "<!-- UNTRUSTED_EXTERNAL_TRANSCRIPT_END -->",
    "",
    "## Open work",
    "```text",
    sanitizeTranscript(opts.openWork, 2000),
    "```",
    "",
    "## Roster",
  ];
  const roster = Array.isArray(opts.agents) ? opts.agents : [];
  if (!roster.length) lines.push("(empty)");
  for (const a of roster) {
    const name = sanitizeField(a.name || a.id, 64);
    const id = sanitizeField(a.id, 64);
    lines.push("- " + name + (id ? " (" + id + ")" : ""));
  }
  lines.push("");
  return lines.join("\n");
}

function writePack(text) {
  const dir = path.join(ROOT, "runtime", "handoffs");
  const secGuard = require("./security-guard");
  secGuard.ensureDir0700(dir);
  const file = path.join(dir, "handoff-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".md");
  secGuard.writeFile0600(file, String(text || ""));
  return file;
}

function packBody(pack) {
  const s = String(pack || "");
  if (/\.md$/.test(s) && fs.existsSync(s)) {
    try { return fs.readFileSync(s, "utf8"); } catch { return ""; }
  }
  if (s.indexOf(path.sep) >= 0 && /\.md$/.test(s)) return "";
  return s;
}

module.exports = { pickChief, buildPack, writePack, packBody, ROOT };
