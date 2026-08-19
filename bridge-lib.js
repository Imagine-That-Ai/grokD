#!/usr/bin/env node
// Pure helpers for the local Grok Bot D bridge. No I/O, no network.
// Used by proxy2.js and by test-unit.js so parser behavior is pinned.

const path = require("path");

const HACK_ROOT = "/tmp/grokbot-hack";

function allowedHackPath(p) {
  try {
    const abs = path.resolve(String(p || ""));
    return abs === HACK_ROOT || abs.startsWith(`${HACK_ROOT}/`);
  } catch {
    return false;
  }
}

function safeRunCmd(cmd) {
  const paths = String(cmd).match(/\/(?:tmp|Users)[^\s'"]+/g) || [];
  if (!paths.length) return false;
  return paths.every(allowedHackPath);
}

function resolveTeammate(agents, raw) {
  const q = String(raw || "").trim();
  if (!q) return null;
  const list = Array.isArray(agents) ? agents : [];
  const byId = list.find((a) => a && a.id === q);
  if (byId) return byId;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = (s) => norm(s).split(/\s+/).filter((w) => w && w !== "bot" && w !== "the" && w !== "a");
  const want = norm(q);
  const wantTok = tokens(q);
  const exact = list.find((a) => norm(a.name) === want);
  if (exact) return exact;
  const scored = list.map((a) => {
    const name = norm(a.name);
    const have = tokens(a.name);
    let score = 0;
    if (name === want) score = 100;
    else if (name.includes(want) || want.includes(name)) score = 80;
    else if (wantTok.length && wantTok.every((t) => have.includes(t) || name.includes(t))) score = 70;
    else if (wantTok.some((t) => t.length >= 3 && (have.includes(t) || name.includes(t)))) score = 40;
    return { a, score };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  if (!scored.length) return null;
  if (scored.length === 1 || scored[0].score >= 70) return scored[0].a;
  if (scored[0].score >= scored[1].score + 20) return scored[0].a;
  return null;
}

function parseHandoffs(text) {
  const src = String(text || "");
  const found = [];
  const re = /\b(?:tell|ask|message|ping)\s+(?!me\b|you\b|him\b|her\b|them\b|us\b|alberto\b)([^,\n]{1,48}?)\s+to\s+(.+?)(?=\s+(?:and\s+(?:tell|ask|message|ping)\b)|[.!?;]|$)/gi;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1].replace(/^["']|["']$/g, "").trim();
    const message = m[2].replace(/^["']|["']$/g, "").trim();
    if (target && message) found.push({ target, message });
  }
  const token = src.match(/\b(?:exact\s+)?token\s+([A-Z0-9][A-Z0-9_-]{4,})\b/i);
  const explicitTarget = src.match(/target_id\s+must\s+be\s+"([^"]+)"/i) || src.match(/target_id["\s:=]+([0-9a-f-]{8,})/i);
  if (token && explicitTarget) {
    found.push({ target: explicitTarget[1], message: `Deliver this exact token to your chat: ${token[1]}` });
  } else if (/SendToAgent/i.test(src) && token) {
    const named = src.match(/\bor\s+"([^"]+)"/);
    found.push({ target: named?.[1] || "lol", message: `Deliver this exact token to your chat: ${token[1]}` });
  }
  const uniq = [];
  const seen = new Set();
  for (const h of found) {
    const key = `${h.target.toLowerCase()}|${h.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(h);
  }
  return uniq;
}

function parseFileOps(text) {
  const src = String(text || "");
  const writes = [];
  const runs = [];
  const pushWrite = (rawPath, rawContent) => {
    const pth = String(rawPath || "").replace(/[.,;]+$/, "");
    if (!allowedHackPath(pth)) return;
    writes.push({ path: path.resolve(pth), content: String(rawContent || "").replace(/^`+|`+$/g, "").trimEnd() });
  };
  const wRes = [
    /write a file at\s+(\S+)\s+containing exactly:\s*(.+?)(?:\n|$)/gi,
    /(?:create|save|write)(?:\s+a)?\s+file(?:\s+at)?\s+(\S+)\s+(?:with(?:\s+contents?)?|containing)\s*:?\s*(.+?)(?:\n|$)/gi,
  ];
  for (const wRe of wRes) {
    let m;
    while ((m = wRe.exec(src))) pushWrite(m[1], m[2]);
  }
  const rRe = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:Run|Execute|exec):\s*(.+?)(?:\n|$)/gi;
  let m;
  while ((m = rRe.exec(src))) {
    const cmd = m[1].trim().replace(/[.,;]+$/, "");
    if (cmd) runs.push(cmd);
  }
  const outM = src.match(/write the stdout to\s+(\S+)/i);
  const rawOut = outM ? outM[1].replace(/[.,;]+$/, "") : "";
  const stdoutPath = rawOut && allowedHackPath(rawOut) ? path.resolve(rawOut) : null;
  const seen = new Set();
  const uniqWrites = [];
  for (const w of writes) {
    if (seen.has(w.path)) continue;
    seen.add(w.path);
    uniqWrites.push(w);
  }
  return { writes: uniqWrites, runs, stdoutPath };
}

module.exports = {
  HACK_ROOT,
  allowedHackPath,
  safeRunCmd,
  resolveTeammate,
  parseHandoffs,
  parseFileOps,
};
