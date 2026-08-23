#!/usr/bin/env node
// Parsing/policy helpers for the local Grok Bot D bridge. No network; reads the
// filesystem only to resolve symlinks when checking whether a path is in bounds.
// Used by proxy2.js and by test-unit.js so parser behavior is pinned.

const os = require("os");
const path = require("path");
const secGuard = require("./security-guard");

const HACK_ROOT = "/tmp/grokbot-hack";
const WORK_ROOTS = [
  HACK_ROOT,
  path.join(HACK_ROOT, "box-data", "workspace"),
  path.join(os.homedir(), ".grok", "grokbot-d", "hack"),
  path.join(os.homedir(), ".grok", "grokbot-d", "box-data", "workspace"),
  path.join(os.homedir(), "Documents", "Developer"),
];
const DENY_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".netrc", "Keychains", ".git", "runtime", "secrets", "agents", "profile-data", "sand-secrets.json", "gateway.token", "session.key", "active-env.json", "profiles.json", "Library"]);

function expandUser(p) {
  const s = String(p || "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/")) return path.join(os.homedir(), s.slice(2));
  return s;
}

function deniedPath(abs) {
  if (abs === "/etc" || abs.startsWith("/etc/")) return true;
  if (abs === "/private/etc" || abs.startsWith("/private/etc/")) return true;
  return abs.split(path.sep).some((seg) => DENY_SEGMENTS.has(seg));
}

function underRoot(abs, root) {
  const r = path.resolve(root);
  return abs === r || abs.startsWith(`${r}${path.sep}`);
}

function allowedHackPath(p) {
  try {
    const abs = path.resolve(expandUser(p));
    if (deniedPath(abs)) return false;
    const real = secGuard.realpathBestEffort(abs);
    if (deniedPath(real)) return false;
    return secGuard.realpathRoots(WORK_ROOTS).some((root) => underRoot(real, root));
  } catch {
    return false;
  }
}

function cmdLooksDenied(cmd) {
  const s = String(cmd || "");
  if (/(?:^|[\/\s'"`~])(?:\.ssh|\.aws|\.gnupg|\.netrc|Keychains|\.git)(?:\/|$|[\s'"`])/.test(s)) return true;
  if (/(?:^|[\s'"`])\/(?:private\/)?etc(?:\/|$|[\s'"`])/.test(s)) return true;
  if (/(?:^|[\s'"`])(?:sudo|su|doas|mkfifo|mknod|nc|netcat|telnet|socat)\b/i.test(s)) return true;
  if (/\/dev\/(?:tcp|udp)\//i.test(s)) return true;
  return false;
}

function extractPaths(cmd) {
  return String(cmd || "").match(/(?:~|\/)[^\s'"`;|&]+/g) || [];
}

function safeRunCmd(cmd, cwd) {
  const s = String(cmd || "");
  if (!s.trim()) return false;
  if (cmdLooksDenied(s)) return false;
  const paths = extractPaths(s);
  if (paths.some((p) => deniedPath(path.resolve(expandUser(p))))) return false;
  try {
    if (!secGuard.isCommandSafe(cmd, cwd)) return false;
  } catch {}
  if (!paths.length) return true;
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
  if (!want) return null;
  const exactMatches = list.filter((a) => a && (norm(a.name) === want || a.name === q));
  if (exactMatches.length > 1) {
    // Ambiguous multiple matches with the same normalized name: fail closed!
    return null;
  }
  if (exactMatches.length === 1) return exactMatches[0];
  const scored = list.map((a) => {
    const name = norm(a.name);
    const have = tokens(a.name);
    let score = 0;
    if (name === want) score = 100;
    else if (name && (name === wantTok.join(" "))) score = 95;
    else if (name.length >= 3 && want.includes(name)) score = 85;
    else if (want.length >= 3 && name.includes(want)) score = 80;
    else if (wantTok.length && wantTok.every((t) => t.length >= 2 && (have.includes(t) || (name.length >= t.length && name.includes(t))))) score = 70;
    return { a, score };
  }).filter((x) => x.score >= 70).sort((x, y) => y.score - x.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].a.id !== scored[1].a.id) {
    // Reject ambiguous equal-scoring matches
    return null;
  }
  if (scored[0].score >= 70) return scored[0].a;
  return null;
}

const MAX_HANDOFFS = 5;
const MAX_PROMPT_LEN = 16384;
const MAX_MESSAGE_LEN = 1024;

function parseHandoffs(text) {
  let src = String(text || "").slice(0, MAX_PROMPT_LEN);
  src = src.replace(/```[\s\S]*?```/g, ""); // Ignore code fences
  const found = [];
  const re = /\b(?:tell|ask|message|ping)\s+(?!me\b|you\b|him\b|her\b|them\b|us\b)([^,\n]{1,48}?)\s+to\s+(.+?)(?=\s+(?:and\s+(?:tell|ask|message|ping)\b)|[.!?;]|$)/gi;
  let m;
  while ((m = re.exec(src)) && found.length < MAX_HANDOFFS) {
    const matchStart = m.index;
    const prefix = src.slice(0, matchStart).toLowerCase();
    if (/\b(?:don'?t|do\s+not|never|avoid|refrain\s+from|stop|without|ignore|refuse|prevent|not)\b[^\n]*$/i.test(prefix)) {
      continue;
    }
    const beforeChar = src[matchStart - 1];
    const afterChar = src[m.index + m[0].length];
    if ((beforeChar === '"' || beforeChar === "'") && (afterChar === '"' || afterChar === "'")) {
      continue;
    }
    const target = m[1].replace(/^["']|["']$/g, "").trim();
    const message = m[2].replace(/^["']|["']$/g, "").trim().slice(0, MAX_MESSAGE_LEN);
    if (target && message) found.push({ target, message });
  }
  const token = src.match(/\b(?:exact\s+)?token\s+([A-Z0-9][A-Z0-9_-]{4,})\b/i);
  const explicitTarget = src.match(/target_id\s+(?:must\s+be\s+|["\s:=]+)"?([0-9a-f-]{8,}|[a-zA-Z0-9_-]+)"?/i);
  if (token && explicitTarget && /SendToAgent/i.test(src) && found.length < MAX_HANDOFFS) {
    found.push({ target: explicitTarget[1], message: `Deliver this exact token to your chat: ${token[1]}` });
  }
  const uniq = [];
  const seen = new Set();
  for (const h of found) {
    const key = `${h.target.toLowerCase()}|${h.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(h);
    if (uniq.length >= MAX_HANDOFFS) break;
  }
  return uniq;
}

function parseFileOps(text) {
  const src = String(text || "");
  const writes = [];
  const pushWrite = (rawPath, rawContent) => {
    const pth = String(rawPath || "").replace(/[.,;]+$/, "");
    if (!allowedHackPath(pth)) return;
    const resolved = path.resolve(expandUser(pth));
    try {
      if (!secGuard.isPathInWorkspace(resolved)) return;
    } catch {}
    writes.push({ path: resolved, content: String(rawContent || "").replace(/^`+|`+$/g, "").trimEnd() });
  };
  const wRes = [
    /write a file at\s+(\S+)\s+containing exactly:\s*(.+?)(?:\n|$)/gi,
    /(?:create|save|write)(?:\s+a)?\s+file(?:\s+at)?\s+(\S+)\s+(?:with(?:\s+contents?)?|containing)\s*:?\s*(.+?)(?:\n|$)/gi,
  ];
  for (const wRe of wRes) {
    let m;
    while ((m = wRe.exec(src))) pushWrite(m[1], m[2]);
  }
  const seen = new Set();
  const uniqWrites = [];
  for (const w of writes) {
    if (seen.has(w.path)) continue;
    seen.add(w.path);
    uniqWrites.push(w);
  }
  // runs/stdoutPath stay empty: prompt-marker Run execution is disabled for security.
  return { writes: uniqWrites, runs: [], stdoutPath: null };
}

module.exports = {
  HACK_ROOT,
  allowedHackPath,
  safeRunCmd,
  resolveTeammate,
  parseHandoffs,
  parseFileOps,
};
