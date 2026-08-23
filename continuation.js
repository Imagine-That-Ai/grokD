#!/usr/bin/env node
// Durable official-to-local continuations.
//
// A continuation is a bounded snapshot of an official Cursor-backed bot. It is
// intentionally not a silent merge of cloud history: the source stays
// untouched, the local agent gets explicit provenance, and returning to the
// official bot produces a reviewable context packet in its composer.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const paths = require("./paths");
const secGuard = require("./security-guard");
const { sqliteRead } = require("./sqlite-ro");
const { ensureAgentStoreDb } = require("./agent-store-db");
const { createAgentAtomically } = require("./clone-bot");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = 1;
const MAX_TURNS = 32;
const MAX_TURN_CHARS = 4000;
const MAX_CONTEXT_CHARS = 48000;
const MAX_TRANSCRIPT_CHARS = 28000;
const MAX_PROFILE_CHARS = 12000;
const MAX_AVATAR_DATA_CHARS = 512 * 1024;
const LOCK_STALE_MS = 60 * 1000;
const LOCK_HARD_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 5000;
const SNAPSHOT_MARKER = "CONTINUATION_SNAPSHOT_ID:";
const RETURN_PACKET_MARKER = "GROKD_RETURN_PACKET_ID:";

function rootDir(opts) {
  return (opts && opts.root)
    || process.env.GROK_PROFILE_ROOT
    || path.join(os.homedir(), ".grok", "grokbot-d");
}

function agentsDir(opts) {
  if (opts && opts.agentsDir) return opts.agentsDir;
  if (opts && opts.root) return path.join(rootDir(opts), "hack", "box-data", "agents");
  return paths.agentsDir();
}

function runtimeDir(opts) {
  return path.join(rootDir(opts), "runtime");
}

function registryFile(opts) {
  return path.join(runtimeDir(opts), "continuations.json");
}

function continueJobsDir(opts) {
  return path.join(runtimeDir(opts), "continuation-jobs");
}

function returnJobsDir(opts) {
  return path.join(runtimeDir(opts), "return-jobs");
}

function sleepSync(ms) {
  if (typeof Atomics === "object" && typeof SharedArrayBuffer === "function") {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(wait, 0, 0, ms);
    return;
  }
  const until = Date.now() + ms;
  while (Date.now() < until) {}
}

function writeFileAtomic(file, value, mode) {
  const parent = path.dirname(file);
  const fileMode = mode || 0o600;
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(parent, 0o700); } catch {}
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "wx", fileMode);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, fileMode); } catch {}
    return file;
  } catch (error) {
    try { if (fd != null) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  return writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return !!(error && error.code === "EPERM");
  }
}

function lockIsStale(lock) {
  try {
    const stat = fs.statSync(lock);
    const age = Date.now() - stat.mtimeMs;
    if (age > LOCK_HARD_STALE_MS) return true;
    if (age <= LOCK_STALE_MS) return false;
    const owner = readJson(lock, null);
    return !owner || !processIsAlive(owner.pid);
  } catch {
    return false;
  }
}

function withRegistryLock(opts, work) {
  const lock = path.join(runtimeDir(opts), "continuations.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(lock), 0o700); } catch {}
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = crypto.randomBytes(16).toString("hex");
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: Date.now() }) + "\n");
      fs.fsyncSync(fd);
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        try { if (fd != null) fs.closeSync(fd); } catch {}
        fd = null;
        try {
          const current = readJson(lock, null);
          if (current && current.token === token) fs.unlinkSync(lock);
        } catch {}
        throw error;
      }
      if (lockIsStale(lock)) {
        try {
          fs.unlinkSync(lock);
          continue;
        } catch {}
      }
      if (Date.now() >= deadline) throw new Error("continuation is busy; retry");
      sleepSync(25);
    }
  }
  try {
    return work();
  } finally {
    try { if (fd != null) fs.closeSync(fd); } catch {}
    try {
      const current = readJson(lock, null);
      if (current && current.token === token) fs.unlinkSync(lock);
    } catch {}
  }
}

function cleanText(value, limit) {
  const max = Number(limit) || MAX_TURN_CHARS;
  return String(value == null ? "" : value)
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

function cleanAvatarData(value) {
  const text = String(value || "");
  if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(text)) return null;
  return text.length <= MAX_AVATAR_DATA_CHARS ? text : null;
}

function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "message";
}

function normalizeTurns(input) {
  const raw = Array.isArray(input && input.turns)
    ? input.turns
    : (Array.isArray(input && input.excerpts) ? input.excerpts : []);
  const rows = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    let role = "message";
    let text = "";
    let id = "";
    if (item && typeof item === "object") {
      role = normalizeRole(item.role);
      text = cleanText(item.text != null ? item.text : item.content);
      id = cleanText(item.id || item.key || "", 240);
    } else {
      text = cleanText(item);
      const prefixed = /^(user|assistant|system|tool)\s*:\s*([\s\S]*)$/i.exec(text);
      if (prefixed) {
        role = normalizeRole(prefixed[1]);
        text = cleanText(prefixed[2]);
      }
    }
    if (!text) continue;
    const previous = rows[rows.length - 1];
    if (previous && previous.role === role && previous.text === text) continue;
    rows.push({ id: id || `turn-${i + 1}`, role, text });
  }

  const recent = rows.slice(-MAX_TURNS);
  const bounded = [];
  let remaining = MAX_TRANSCRIPT_CHARS;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const row = recent[i];
    const text = row.text.slice(0, Math.min(MAX_TURN_CHARS, remaining));
    remaining -= text.length;
    bounded.unshift({ id: row.id, role: row.role, text });
  }
  return bounded;
}

function turnsFromTranscriptEntries(entries) {
  const turns = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    let role = "message";
    let text = "";
    if (entry.kind === "message") {
      role = normalizeRole(entry.role);
      text = cleanText(entry.content);
    } else if (entry.kind === "send-message" && entry.message && entry.message.type === "text") {
      role = "assistant";
      text = cleanText(entry.message.content);
    }
    if (!text) continue;
    turns.push({
      id: cleanText(entry.id, 240) || `entry-${turns.length + 1}`,
      role,
      text,
    });
  }
  return normalizeTurns({ turns });
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sourceKeyOf(input) {
  const profileId = cleanText(input && (input.sourceProfileId || input.from), 160) || "cursor";
  const accountSlot = cleanText(input && input.sourceAccountSlot, 320);
  const agentId = cleanText(input && input.sourceAgentId, 240);
  if (!agentId) {
    throw new Error("exact official bot identity is unavailable; reopen the bot and retry");
  }
  return `official-v1:${sha256(`${profileId}\0${accountSlot}\0agent:${agentId}`)}`;
}

function deterministicAgentId(sourceKey) {
  const bytes = Buffer.from(sha256(`grokd-continuation\0${sourceKey}`).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomAgentId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeSnapshot(input) {
  input = input || {};
  const turns = normalizeTurns(input);
  const lastTurn = [...turns].reverse().find((turn) => turn.role === "user");
  const snapshot = {
    version: VERSION,
    sourceProfileId: cleanText(input.sourceProfileId || input.from, 160) || "cursor",
    sourceProfileName: cleanText(input.sourceProfileName || input.fromName, 240),
    sourceAccountSlot: cleanText(input.sourceAccountSlot, 320) || null,
    sourceAgentId: cleanText(input.sourceAgentId, 240) || null,
    sourceAgentName: cleanText(input.sourceAgentName || input.sourceName, 240),
    sourceAgentDescription: cleanText(input.sourceAgentDescription, MAX_PROFILE_CHARS),
    sourceAgentTitle: cleanText(input.sourceAgentTitle, 240),
    sourceAgentAvatarDataUrl: cleanAvatarData(input.sourceAgentAvatarDataUrl),
    sourceAgentAvatarVersion: cleanText(input.sourceAgentAvatarVersion, 240) || null,
    sourceAgentAvatarShape: cleanText(input.sourceAgentAvatarShape, 80) || null,
    sourceAgentAvatarColor: cleanText(input.sourceAgentAvatarColor, 80) || null,
    sourceThreadId: cleanText(input.sourceThreadId, 240) || null,
    sourceHref: cleanText(input.sourceHref, 1200) || null,
    model: cleanText(input.model, 240) || null,
    lastUser: cleanText(input.lastUser, MAX_TURN_CHARS) || (lastTurn && lastTurn.text) || "",
    turns,
    capturedAt: Number(input.capturedAt || input.at) || Date.now(),
  };
  snapshot.sourceKey = sourceKeyOf(snapshot);
  snapshot.snapshotHash = sha256(JSON.stringify({
    sourceProfileId: snapshot.sourceProfileId,
    sourceAccountSlot: snapshot.sourceAccountSlot,
    sourceAgentId: snapshot.sourceAgentId,
    sourceAgentName: snapshot.sourceAgentName,
    sourceAgentDescription: snapshot.sourceAgentDescription,
    sourceAgentTitle: snapshot.sourceAgentTitle,
    sourceThreadId: snapshot.sourceThreadId,
    model: snapshot.model,
    lastUser: snapshot.lastUser,
    turns: snapshot.turns,
  }));
  return snapshot;
}

function defaultRegistry() {
  return { version: VERSION, records: [] };
}

function loadRegistry(opts) {
  const file = registryFile(opts);
  if (!fs.existsSync(file)) return defaultRegistry();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`continuation registry is unreadable: ${error && error.message || error}`);
  }
  if (!raw || !Array.isArray(raw.records)) {
    throw new Error("continuation registry has an incompatible shape");
  }
  const invalid = raw.records.find((record) =>
    !record || !UUID_RE.test(String(record.localAgentId || ""))
  );
  if (invalid) throw new Error("continuation registry contains an invalid agent record");
  return {
    version: VERSION,
    records: raw.records,
  };
}

function saveRegistry(registry, opts) {
  registry.version = VERSION;
  registry.records = Array.isArray(registry.records) ? registry.records : [];
  writeJsonAtomic(registryFile(opts), registry);
  return registry;
}

function agentDir(agentId, opts) {
  return path.join(agentsDir(opts), String(agentId || ""));
}

function continuationMeta(agentId, opts) {
  return readJson(path.join(agentDir(agentId, opts), "continuation.json"), null);
}

function isLiveRecord(record, opts) {
  if (!record || record.status === "discarded") return false;
  const meta = continuationMeta(record.localAgentId, opts);
  return !!(meta && meta.sourceKey === record.sourceKey);
}

function findRecord(registry, sourceKey, opts) {
  const records = registry.records
    .filter((record) => record && record.sourceKey === sourceKey && isLiveRecord(record, opts))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  return records[0] || null;
}

function localName(snapshot) {
  const base = cleanText(
    snapshot.sourceAgentName || snapshot.sourceProfileName || "Official bot",
    52
  ).replace(/\s*[·-]\s*Local$/i, "");
  return `${base || "Official bot"} · Local`.slice(0, 64);
}

function snapshotMarkdown(snapshot) {
  const lines = [
    "# Official bot snapshot",
    "",
    "This is a local continuation snapshot. The official cloud bot and its history were not changed.",
    "",
    `Source seat: ${snapshot.sourceProfileName || snapshot.sourceProfileId}`,
    `Source bot: ${snapshot.sourceAgentName || snapshot.sourceAgentId || "Current bot"}`,
    `Source bot ID: ${snapshot.sourceAgentId || "unavailable"}`,
    `Model at capture: ${snapshot.model || "unknown"}`,
    `Captured: ${new Date(snapshot.capturedAt).toISOString()}`,
    "",
    "## Official bot instructions",
    snapshot.sourceAgentDescription || "(No description was available.)",
    "",
    "## Last user request",
    snapshot.lastUser || "(none captured)",
    "",
    "## Recent transcript",
  ];
  if (!snapshot.turns.length) lines.push("(No mounted transcript rows were available.)");
  for (const turn of snapshot.turns) {
    lines.push("");
    lines.push(`### ${turn.role}`);
    lines.push(turn.text);
  }
  lines.push("");
  return lines.join("\n");
}

function buildInitialPrompt(snapshot) {
  const lines = [
    "# Local continuation snapshot",
    "",
    `${SNAPSHOT_MARKER}${snapshot.snapshotHash}`,
    "",
    `You are continuing ${snapshot.sourceAgentName || "the current official Grok Bot"} locally.`,
    "This is a bounded snapshot, not the original cloud thread. Keep the same goal, be honest about missing history, and continue from the newest context below.",
    "",
    `Source seat: ${snapshot.sourceProfileName || snapshot.sourceProfileId}`,
    `Source model: ${snapshot.model || "unknown"}`,
    "",
    "## Official bot instructions",
    snapshot.sourceAgentDescription || "(No description was available.)",
    "",
    "## Latest user request",
    snapshot.lastUser || "(none captured)",
    "",
    "## Recent turns",
  ];
  if (!snapshot.turns.length) lines.push("(none captured)");
  for (const turn of snapshot.turns) {
    lines.push("");
    lines.push(`${turn.role.toUpperCase()}: ${turn.text}`);
  }
  lines.push("");
  lines.push("Continue the work now. Do not ask for a recap unless a missing fact blocks you.");
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

function writeAgentFiles(record, snapshot, opts) {
  const finalDir = agentDir(record.localAgentId, opts);
  const writeInto = (dir) => {
    fs.mkdirSync(path.join(dir, "memory", "log"), { recursive: true, mode: 0o700 });
    const existingProfile = readJson(path.join(dir, "profile.json"), {});
    const profile = Object.assign({}, existingProfile, {
      name: localName(snapshot),
      description: snapshot.sourceAgentDescription
        || `Local continuation of ${snapshot.sourceAgentName || snapshot.sourceProfileName || "an official Grok Bot"}.`,
      title: snapshot.sourceAgentTitle || "Local continuation",
      origin: "official-continuation",
      createdAt: Number(existingProfile.createdAt) || record.createdAt,
      continuedFrom: {
        profileId: snapshot.sourceProfileId,
        agentId: snapshot.sourceAgentId,
        agentName: snapshot.sourceAgentName,
        sourceKey: snapshot.sourceKey,
        capturedAt: snapshot.capturedAt,
      },
    });
    for (const [key, value] of Object.entries({
      avatarDataUrl: snapshot.sourceAgentAvatarDataUrl,
      avatarVersion: snapshot.sourceAgentAvatarVersion,
      avatarShape: snapshot.sourceAgentAvatarShape,
      avatarColor: snapshot.sourceAgentAvatarColor,
    })) {
      if (value != null) profile[key] = value;
    }
    const existingSettings = readJson(path.join(dir, "settings.json"), {});
    const settings = Object.assign({}, existingSettings, {
      notifyOnAgentUpdates: existingSettings.notifyOnAgentUpdates !== false,
    });
    if (snapshot.model) settings.model = snapshot.model;

    ensureAgentStoreDb(path.join(dir, "store.db"));
    writeJsonAtomic(path.join(dir, "profile.json"), profile);
    writeJsonAtomic(path.join(dir, "settings.json"), settings);
    writeJsonAtomic(path.join(dir, "continuation.json"), {
      version: VERSION,
      continuationId: record.id,
      localAgentId: record.localAgentId,
      sourceKey: snapshot.sourceKey,
      status: record.status,
      source: {
        profileId: snapshot.sourceProfileId,
        profileName: snapshot.sourceProfileName,
        accountSlot: snapshot.sourceAccountSlot,
        agentId: snapshot.sourceAgentId,
        agentName: snapshot.sourceAgentName,
        agentDescription: snapshot.sourceAgentDescription,
        agentTitle: snapshot.sourceAgentTitle,
        threadId: snapshot.sourceThreadId,
        model: snapshot.model,
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      snapshotHash: snapshot.snapshotHash,
    });
    writeFileAtomic(
      path.join(dir, "memory", "log", "official-snapshot.md"),
      snapshotMarkdown(snapshot)
    );
  };
  if (fs.existsSync(finalDir)) {
    writeInto(finalDir);
    return finalDir;
  }
  return createAgentAtomically(
    agentsDir(opts),
    record.localAgentId,
    (staging) => writeInto(staging)
  ).dest;
}

function setActiveAgent(agentId, opts) {
  const file = path.join(agentsDir(opts), "active-agent.json");
  writeJsonAtomic(file, { activeAgentId: agentId });
  return file;
}

function continueJobFile(agentId, opts) {
  return path.join(continueJobsDir(opts), `${agentId}.json`);
}

function queueContinue(record, snapshot, opts) {
  const file = continueJobFile(record.localAgentId, opts);
  writeJsonAtomic(file, {
    version: VERSION,
    id: `${record.localAgentId}:${snapshot.snapshotHash}`,
    agentId: record.localAgentId,
    continuationId: record.id,
    snapshotHash: snapshot.snapshotHash,
    marker: `${SNAPSHOT_MARKER}${snapshot.snapshotHash}`,
    text: buildInitialPrompt(snapshot),
    at: Date.now(),
    attempts: 0,
  });
  return file;
}

function chooseAgentId(sourceKey, opts) {
  let id = deterministicAgentId(sourceKey);
  const dir = agentDir(id, opts);
  if (!fs.existsSync(dir)) return id;
  const meta = continuationMeta(id, opts);
  if (meta && meta.sourceKey === sourceKey) return id;
  do { id = randomAgentId(); } while (fs.existsSync(agentDir(id, opts)));
  return id;
}

function createOrUpdate(input, opts) {
  opts = opts || {};
  const snapshot = normalizeSnapshot(input);
  return withRegistryLock(opts, () => {
    const registry = loadRegistry(opts);
    let record = findRecord(registry, snapshot.sourceKey, opts);
    const now = Date.now();
    const reused = !!record;
    let agentWasPresent = true;
    const previousSnapshotHash = record && record.snapshotHash;
    if (!record) {
      const localAgentId = chooseAgentId(snapshot.sourceKey, opts);
      agentWasPresent = fs.existsSync(agentDir(localAgentId, opts));
      const meta = continuationMeta(localAgentId, opts);
      record = {
        id: (meta && meta.continuationId) || randomAgentId(),
        sourceKey: snapshot.sourceKey,
        localAgentId,
        status: (meta && meta.status === "kept") ? "kept" : "disposable",
        createdAt: Number(meta && meta.createdAt) || now,
      };
      registry.records.push(record);
    }
    record.updatedAt = now;
    record.lastSnapshotAt = snapshot.capturedAt;
    record.snapshotHash = snapshot.snapshotHash;
    record.source = {
      profileId: snapshot.sourceProfileId,
      profileName: snapshot.sourceProfileName,
      accountSlot: snapshot.sourceAccountSlot,
      agentId: snapshot.sourceAgentId,
      agentName: snapshot.sourceAgentName,
      agentDescription: snapshot.sourceAgentDescription,
      agentTitle: snapshot.sourceAgentTitle,
      threadId: snapshot.sourceThreadId,
      href: snapshot.sourceHref,
      model: snapshot.model,
    };
    record.snapshot = Object.assign({}, snapshot);
    delete record.snapshot.sourceAgentAvatarDataUrl;
    writeAgentFiles(record, snapshot, opts);
    const jobFile = continueJobFile(record.localAgentId, opts);
    const jobWasPresent = fs.existsSync(jobFile);
    let snapshotChanged;
    let job;
    try {
      const currentJob = readJson(jobFile, null);
      snapshotChanged = previousSnapshotHash !== snapshot.snapshotHash;
      job = null;
      if (snapshotChanged || (currentJob && currentJob.snapshotHash !== snapshot.snapshotHash)) {
        job = queueContinue(record, snapshot, opts);
      } else if (currentJob && currentJob.snapshotHash === snapshot.snapshotHash) {
        job = jobFile;
      }
      saveRegistry(registry, opts);
    } catch (error) {
      const durable = loadRegistry(opts).records.some((item) =>
        item.localAgentId === record.localAgentId && item.sourceKey === record.sourceKey
      );
      if (!durable && !agentWasPresent) {
        try { fs.rmSync(agentDir(record.localAgentId, opts), { recursive: true, force: true }); } catch {}
      }
      if (!durable && !jobWasPresent) {
        try { fs.unlinkSync(jobFile); } catch {}
      }
      throw error;
    }
    setActiveAgent(record.localAgentId, opts);
    return {
      ok: true,
      reused,
      destId: record.localAgentId,
      localAgentId: record.localAgentId,
      continuationId: record.id,
      status: record.status,
      name: localName(snapshot),
      snapshotHash: snapshot.snapshotHash,
      snapshotChanged,
      continueJob: job,
    };
  });
}

function list(opts) {
  return loadRegistry(opts).records.filter((record) => isLiveRecord(record, opts));
}

function getByAgent(agentId, opts) {
  return list(opts).find((record) => record.localAgentId === agentId) || null;
}

function findBySnapshot(input, opts) {
  const key = sourceKeyOf(input || {});
  return list(opts).find((record) => record.sourceKey === key) || null;
}

function setKept(agentId, kept, opts) {
  opts = opts || {};
  return withRegistryLock(opts, () => {
    const registry = loadRegistry(opts);
    const record = registry.records.find((item) => item.localAgentId === agentId && item.status !== "discarded");
    if (!record || !isLiveRecord(record, opts)) throw new Error("continuation not found");
    record.status = kept === false ? "disposable" : "kept";
    record.updatedAt = Date.now();
    const meta = continuationMeta(agentId, opts) || {};
    meta.status = record.status;
    meta.updatedAt = record.updatedAt;
    writeJsonAtomic(path.join(agentDir(agentId, opts), "continuation.json"), meta);
    saveRegistry(registry, opts);
    return record;
  });
}

function parseStoredEntry(raw, index) {
  let entry = null;
  try { entry = JSON.parse(raw); } catch { return null; }
  if (!entry || entry.kind === "tool-call") return null;
  let role = "message";
  let value = "";
  if (entry.kind === "message") {
    role = normalizeRole(entry.role);
    value = entry.content;
  } else if (entry.kind === "send-message"
      && entry.message
      && entry.message.type === "text") {
    role = "assistant";
    value = entry.message.content;
  } else {
    return null;
  }
  const text = cleanText(value, MAX_TURN_CHARS);
  if (!text || /^# Local continuation snapshot\b/.test(text)) return null;
  return {
    id: cleanText(entry && entry.id, 240) || `local-${index + 1}`,
    role,
    text,
  };
}

function readLocalTurns(agentId, opts) {
  const db = path.join(agentDir(agentId, opts), "store.db");
  if (!fs.existsSync(db)) return [];
  let raw = "";
  try {
    raw = sqliteRead(
      db,
      `SELECT entry FROM (SELECT entry, rowid AS ord FROM transcript_entries ORDER BY rowid DESC LIMIT ${MAX_TURNS}) ORDER BY ord`,
      { timeout: 6000, maxBuffer: 16 * 1024 * 1024 }
    );
  } catch {}
  return normalizeTurns({
    turns: String(raw || "").split("\n").map(parseStoredEntry).filter(Boolean),
  });
}

function returnPacketMarker(jobId) {
  const id = cleanText(jobId, 240);
  return id ? `${RETURN_PACKET_MARKER}${sha256(id).slice(0, 24)}` : "";
}

function buildReturnPacket(record, opts, jobId) {
  if (!record) throw new Error("continuation not found");
  const localTurns = readLocalTurns(record.localAgentId, opts);
  const source = record.source || {};
  const snapshot = record.snapshot || {};
  const marker = returnPacketMarker(jobId);
  const lines = [
    "# Context update from the local continuation",
    "",
    `This work continued locally after ${source.profileName || source.profileId || "the official seat"} became unavailable.`,
    "Use this as context for the official bot. It is a handoff packet, not a claim that cloud history was merged.",
    "",
    `Original bot: ${source.agentName || source.agentId || "Current bot"}`,
    `Local copy: ${record.localAgentId}`,
    `Snapshot captured: ${new Date(record.lastSnapshotAt || record.createdAt).toISOString()}`,
    "",
    "## Original task",
    snapshot.lastUser || "(not captured)",
    "",
    "## Work done locally",
  ];
  if (!localTurns.length) lines.push("(No local transcript entries were available.)");
  for (const turn of localTurns) {
    lines.push("");
    lines.push(`${turn.role.toUpperCase()}: ${turn.text}`);
  }
  lines.push("");
  lines.push("Continue from this state. Ask only for facts that are still missing.");
  if (marker) lines.push("", `<!-- ${marker} -->`);
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

function returnJobFile(profileId, opts) {
  const safe = cleanText(profileId, 160).replace(/[^a-zA-Z0-9._-]+/g, "-") || "cursor";
  return path.join(returnJobsDir(opts), `${safe}.json`);
}

function prepareReturn(agentId, opts) {
  opts = opts || {};
  return withRegistryLock(opts, () => {
    const registry = loadRegistry(opts);
    const record = registry.records.find((item) => item.localAgentId === agentId && item.status !== "discarded");
    if (!record || !isLiveRecord(record, opts)) throw new Error("continuation not found");
    const profileId = record.source && record.source.profileId;
    if (!profileId) throw new Error("official source profile is unavailable");
    const preparedAt = Date.now();
    const jobId = `${record.id}:${preparedAt}:${crypto.randomBytes(8).toString("hex")}`;
    const marker = returnPacketMarker(jobId);
    const text = buildReturnPacket(record, opts, jobId);
    const file = returnJobFile(profileId, opts);
    writeJsonAtomic(file, {
      version: VERSION,
      id: jobId,
      marker,
      sourceProfileId: profileId,
      sourceAgentId: record.source.agentId || null,
      sourceAgentName: record.source.agentName || null,
      localAgentId: record.localAgentId,
      continuationId: record.id,
      text,
      at: preparedAt,
    });
    record.lastReturnPreparedAt = preparedAt;
    record.updatedAt = record.lastReturnPreparedAt;
    saveRegistry(registry, opts);
    return { ok: true, file, profileId, text, marker, record };
  });
}

function getReturnJob(profileId, opts) {
  const job = readJson(returnJobFile(profileId, opts), null);
  return job && job.sourceProfileId === profileId ? job : null;
}

function ackReturnJob(profileId, jobId, opts) {
  const file = returnJobFile(profileId, opts);
  const job = readJson(file, null);
  if (!job || (jobId && job.id !== jobId)) return false;
  try { fs.unlinkSync(file); } catch { return false; }
  return true;
}

function pendingContinueJobs(opts) {
  let names = [];
  try { names = fs.readdirSync(continueJobsDir(opts)); } catch { return []; }
  return names
    .filter((name) => UUID_RE.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
    .map((name) => readJson(path.join(continueJobsDir(opts), name), null))
    .filter((job) => job && UUID_RE.test(String(job.agentId || "")))
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

function continueJobLanded(job, opts) {
  if (!job || !UUID_RE.test(String(job.agentId || ""))) return false;
  const marker = cleanText(job.marker || `${SNAPSHOT_MARKER}${job.snapshotHash || ""}`, 240);
  if (!marker || marker === SNAPSHOT_MARKER) return false;
  const db = path.join(agentDir(job.agentId, opts), "store.db");
  if (!fs.existsSync(db)) return false;
  const escaped = marker.replace(/'/g, "''");
  const found = sqliteRead(
    db,
    `SELECT 1 FROM transcript_entries WHERE instr(entry, '${escaped}') > 0 LIMIT 1`,
    { timeout: 4000, maxBuffer: 1024 }
  );
  return String(found || "").trim() === "1";
}

function ackContinueJob(agentId, jobId, opts) {
  const file = continueJobFile(agentId, opts);
  const job = readJson(file, null);
  if (!job || (jobId && job.id !== jobId)) return false;
  try { fs.unlinkSync(file); } catch { return false; }
  return true;
}

function bumpContinueJob(agentId, jobId, opts) {
  const file = continueJobFile(agentId, opts);
  const job = readJson(file, null);
  if (!job || (jobId && job.id !== jobId)) return null;
  job.attempts = Number(job.attempts || 0) + 1;
  job.lastAttemptAt = Date.now();
  writeJsonAtomic(file, job);
  return job;
}

function fallbackActiveAgent(deletingId, opts) {
  let names = [];
  try { names = fs.readdirSync(agentsDir(opts), { withFileTypes: true }); } catch { return null; }
  const candidate = names.find((entry) =>
    entry.isDirectory()
      && UUID_RE.test(entry.name)
      && entry.name !== deletingId
      && fs.existsSync(path.join(agentsDir(opts), entry.name, "profile.json"))
  );
  return candidate ? candidate.name : null;
}

function clearActiveAgent(agentId, opts) {
  const file = path.join(agentsDir(opts), "active-agent.json");
  const active = readJson(file, null);
  if (!active || active.activeAgentId !== agentId) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function deleteViaGateway(agentId, opts) {
  if (opts && opts.deleteAgent) return !!opts.deleteAgent(agentId);
  const homeRoot = path.join(os.homedir(), ".grok", "grokbot-d");
  if (rootDir(opts) !== homeRoot) return false;
  try {
    const token = secGuard.mintSessionJwt({
      audience: "agent-control",
      expiresInSeconds: 30,
    });
    execFileSync("curl", [
      "-fsS", "-X", "POST", "http://127.0.0.1:1337/api/deleteLocalAgents",
      "-H", "content-type: application/json",
      "-H", `authorization: Bearer ${token}`,
      "-d", JSON.stringify({ ids: [agentId] }),
    ], { encoding: "utf8", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function discard(agentId, opts) {
  opts = opts || {};
  return withRegistryLock(opts, () => {
    const registry = loadRegistry(opts);
    const record = registry.records.find((item) => item.localAgentId === agentId && item.status !== "discarded");
    if (!record || !isLiveRecord(record, opts)) throw new Error("continuation not found");
    const meta = continuationMeta(agentId, opts);
    if (!meta || meta.sourceKey !== record.sourceKey) {
      throw new Error("refusing to delete an unmanaged agent");
    }

    const fallback = fallbackActiveAgent(agentId, opts);
    if (fallback) setActiveAgent(fallback, opts);
    else clearActiveAgent(agentId, opts);
    deleteViaGateway(agentId, opts);
    if (fs.existsSync(agentDir(agentId, opts))) {
      fs.rmSync(agentDir(agentId, opts), { recursive: true, force: true });
    }
    try { fs.unlinkSync(continueJobFile(agentId, opts)); } catch {}
    record.status = "discarded";
    record.discardedAt = Date.now();
    record.updatedAt = record.discardedAt;
    saveRegistry(registry, opts);
    return { ok: true, discarded: agentId, fallback, record };
  });
}

module.exports = {
  VERSION,
  UUID_RE,
  MAX_TURNS,
  MAX_TURN_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MAX_PROFILE_CHARS,
  SNAPSHOT_MARKER,
  RETURN_PACKET_MARKER,
  rootDir,
  agentsDir,
  registryFile,
  normalizeTurns,
  turnsFromTranscriptEntries,
  normalizeSnapshot,
  sourceKeyOf,
  deterministicAgentId,
  buildInitialPrompt,
  buildReturnPacket,
  createOrUpdate,
  list,
  getByAgent,
  findBySnapshot,
  setKept,
  prepareReturn,
  getReturnJob,
  ackReturnJob,
  pendingContinueJobs,
  continueJobLanded,
  ackContinueJob,
  bumpContinueJob,
  readLocalTurns,
  discard,
};

if (require.main === module) {
  const cmd = process.argv[2] || "list";
  if (cmd === "list") console.log(JSON.stringify(list(), null, 2));
  else {
    console.error("usage: continuation.js list");
    process.exitCode = 2;
  }
}
