#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS ", name);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-continuation-"));
const agents = path.join(root, "hack", "box-data", "agents");
process.env.GROK_PROFILE_ROOT = root;
process.env.GROKBOT_HACK = path.join(root, "hack");

const continuation = require("./continuation");
const takeover = require("./takeover-local");
const { inspectAgentStoreDb } = require("./agent-store-db");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertEntry(db, seq, id, entry) {
  execFileSync("sqlite3", [
    db,
    `INSERT INTO transcript_entries(seq,id,entry) VALUES (${seq},${sqlQuote(id)},${sqlQuote(JSON.stringify(entry))})`,
  ]);
}

const fallbackId = "11111111-1111-4111-8111-111111111111";
writeJson(path.join(agents, fallbackId, "profile.json"), { name: "Existing local bot" });

const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const longTurns = Array.from({ length: 40 }, (_, index) => ({
  id: `official-${index + 1}`,
  role: index % 2 === 0 ? "user" : "assistant",
  text: `${index % 2 === 0 ? "Request" : "Reply"} ${index + 1} ${"x".repeat(4200)}`,
}));
const snapshot = {
  sourceProfileId: "cursor-a",
  sourceProfileName: "Personal Cursor",
  sourceAccountSlot: "github|user_test",
  sourceAgentId: sourceId,
  sourceAgentName: "Chief Human Officer",
  sourceAgentDescription: "Translate complex work into plain English and preserve exact evidence.",
  sourceAgentTitle: "Chief",
  sourceAgentAvatarDataUrl: "data:image/png;base64,aGVsbG8=",
  sourceAgentAvatarVersion: "avatar-v1",
  sourceAgentAvatarShape: "hex",
  sourceAgentAvatarColor: "purple",
  sourceThreadId: sourceId,
  sourceHref: "file:///official",
  model: "grok-4.6",
  lastUser: "Finish the release safely.",
  turns: longTurns,
  capturedAt: 1787450000000,
};

let missingIdentityRejected = false;
try {
  continuation.createOrUpdate({
    ...snapshot,
    sourceAgentId: null,
    sourceThreadId: null,
  });
} catch (error) {
  missingIdentityRejected = /exact official bot identity/i.test(String(error && error.message || error));
}
assert(missingIdentityRejected, "name-only continuation identity was accepted");
assert(!fs.existsSync(continuation.registryFile()), "identity failure changed continuation state");
ok("requires-the-exact-persisted-official-bot-id");

const created = continuation.createOrUpdate(snapshot);
assert(created.ok && created.reused === false, JSON.stringify(created));
assert(continuation.UUID_RE.test(created.localAgentId), created.localAgentId);
assert(created.snapshotChanged === true && created.continueJob, JSON.stringify(created));
const agentDir = path.join(agents, created.localAgentId);
const profile = readJson(path.join(agentDir, "profile.json"));
assert(profile.name === "Chief Human Officer · Local", profile.name);
assert(profile.description === snapshot.sourceAgentDescription, profile.description);
assert(profile.title === "Chief", profile.title);
assert(profile.avatarDataUrl === snapshot.sourceAgentAvatarDataUrl, "avatar copied");
assert(profile.origin === "official-continuation", profile.origin);
assert(profile.continuedFrom.agentId === sourceId, "source agent provenance");
assert(!fs.existsSync(path.join(agentDir, "automations")), "official routines must not be copied");
assert(
  !fs.readdirSync(agents).some((name) => name.startsWith(".grokd-agent-")),
  "half-built continuation directory remained visible"
);
const settings = readJson(path.join(agentDir, "settings.json"));
assert(settings.model === "grok-4.6", JSON.stringify(settings));
const active = readJson(path.join(agents, "active-agent.json"));
assert(active.activeAgentId === created.localAgentId, JSON.stringify(active));
const registryMode = fs.statSync(continuation.registryFile()).mode & 0o777;
assert(registryMode === 0o600, registryMode.toString(8));
assert((fs.statSync(path.dirname(continuation.registryFile())).mode & 0o777) === 0o700, "runtime dir mode");
assert(
  !JSON.stringify(readJson(continuation.registryFile())).includes(snapshot.sourceAgentAvatarDataUrl),
  "registry retained the copied avatar payload"
);
const schema = execFileSync("sqlite3", [
  path.join(agentDir, "store.db"),
  "PRAGMA table_info(transcript_entries); PRAGMA index_list(transcript_entries);",
], { encoding: "utf8" });
const storeState = inspectAgentStoreDb(path.join(agentDir, "store.db"));
assert(storeState.canonical, JSON.stringify(storeState));
assert(storeState.kv.canonical && storeState.blobs.canonical, "host tables missing");
assert(storeState.transcript.canonical, "strict transcript schema missing");
assert(/\|seq\|INTEGER\|0\|\|1/.test(schema), schema);
assert(/\|id\|TEXT\|1\|/.test(schema), schema);
assert(/\|entry\|TEXT\|1\|/.test(schema), schema);
assert(schema.includes("idx_transcript_window") && schema.includes("idx_transcript_branched"), schema);
const firstJob = continuation.pendingContinueJobs().find((job) => job.agentId === created.localAgentId);
assert(firstJob && firstJob.text.includes(continuation.SNAPSHOT_MARKER + created.snapshotHash), "snapshot marker");
assert(firstJob.text.includes(snapshot.sourceAgentDescription), "official instructions");
assert(firstJob.text.length <= continuation.MAX_CONTEXT_CHARS, firstJob.text.length);
const normalized = continuation.normalizeSnapshot(snapshot);
assert(normalized.turns.length > 0 && normalized.turns.length <= continuation.MAX_TURNS, normalized.turns.length);
assert(normalized.turns.every((turn) => turn.text.length <= continuation.MAX_TURN_CHARS), "turn bound");
assert(
  normalized.turns.reduce((sum, turn) => sum + turn.text.length, 0) <= continuation.MAX_TRANSCRIPT_CHARS,
  "transcript byte bound"
);
ok("creates-bounded-private-local-copy");

continuation.bumpContinueJob(created.localAgentId, firstJob.id);
const same = continuation.createOrUpdate(snapshot);
assert(same.reused === true && same.localAgentId === created.localAgentId, JSON.stringify(same));
assert(same.snapshotChanged === false, JSON.stringify(same));
const sameJob = continuation.pendingContinueJobs().find((job) => job.agentId === created.localAgentId);
assert(sameJob.attempts === 1, `same snapshot reset attempts: ${sameJob.attempts}`);
const changedSnapshot = {
  ...snapshot,
  lastUser: "Finish the release and prepare the handoff.",
  turns: longTurns.concat([{
    id: "official-new",
    role: "user",
    text: "Finish the release and prepare the handoff.",
  }]),
  capturedAt: snapshot.capturedAt + 1000,
};
const changed = continuation.createOrUpdate(changedSnapshot);
assert(changed.reused === true && changed.localAgentId === created.localAgentId, JSON.stringify(changed));
assert(changed.snapshotChanged === true && changed.snapshotHash !== created.snapshotHash, JSON.stringify(changed));
const changedJob = continuation.pendingContinueJobs().find((job) => job.agentId === created.localAgentId);
assert(changedJob.attempts === 0 && changedJob.snapshotHash === changed.snapshotHash, JSON.stringify(changedJob));
ok("reuses-one-copy-and-refreshes-only-new-context");

const other = continuation.createOrUpdate({
  ...snapshot,
  sourceAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceThreadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  capturedAt: snapshot.capturedAt + 2000,
});
assert(other.localAgentId !== created.localAgentId, "different official bots collided");
const selectedAgain = continuation.createOrUpdate(changedSnapshot);
assert(selectedAgain.localAgentId === created.localAgentId, "same official bot did not resume");
ok("keys-copies-to-the-exact-official-bot");

const db = path.join(agentDir, "store.db");
insertEntry(db, 1, "snapshot-prompt", {
  kind: "message",
  id: "snapshot-prompt",
  role: "user",
  content: changedJob.text,
});
assert(continuation.continueJobLanded(changedJob) === true, "landed prompt not detected");
assert(continuation.ackContinueJob(created.localAgentId, changedJob.id) === true, "job ack");
assert(!continuation.pendingContinueJobs().some((job) => job.agentId === created.localAgentId), "acked job remains");
insertEntry(db, 2, "local-user", {
  kind: "message",
  id: "local-user",
  role: "user",
  content: "I finished the local implementation.",
});
insertEntry(db, 3, "local-assistant", {
  kind: "send-message",
  id: "local-assistant",
  message: { type: "text", content: "Tests pass and the release notes are ready." },
});
insertEntry(db, 4, "local-tool", {
  kind: "tool-call",
  id: "local-tool",
  role: "tool",
  content: "private tool output",
});
insertEntry(db, 5, "local-secret", {
  kind: "send-message",
  id: "local-secret",
  message: { type: "secret-request", content: "private local token" },
});
const localTurns = continuation.readLocalTurns(created.localAgentId);
assert(localTurns.length === 2, JSON.stringify(localTurns));
assert(localTurns[0].text.includes("finished"), JSON.stringify(localTurns));
assert(localTurns[1].role === "assistant", JSON.stringify(localTurns));
assert(!JSON.stringify(localTurns).includes("private"), JSON.stringify(localTurns));
const prepared = continuation.prepareReturn(created.localAgentId);
assert(prepared.text.includes("I finished the local implementation."), prepared.text);
assert(prepared.text.includes("Tests pass and the release notes are ready."), prepared.text);
assert(/not a claim that cloud history was merged/i.test(prepared.text), prepared.text);
const firstReturnJob = readJson(prepared.file);
assert(firstReturnJob.marker.startsWith(continuation.RETURN_PACKET_MARKER), firstReturnJob.marker);
assert(firstReturnJob.text.includes(`<!-- ${firstReturnJob.marker} -->`), firstReturnJob.text);
assert(continuation.getReturnJob("cursor-a").id === firstReturnJob.id, "return job lookup");
assert(continuation.ackReturnJob("cursor-a", "wrong-id") === false, "wrong return job acked");
assert(continuation.ackReturnJob("cursor-a", firstReturnJob.id) === true, "return job ack");
const preparedAgain = continuation.prepareReturn(created.localAgentId);
const secondReturnJob = readJson(preparedAgain.file);
assert(secondReturnJob.id !== firstReturnJob.id, "repeat return reused the previous job id");
assert(secondReturnJob.marker !== firstReturnJob.marker, "repeat return reused the previous packet marker");
assert(secondReturnJob.text.includes(`<!-- ${secondReturnJob.marker} -->`), secondReturnJob.text);
assert(!secondReturnJob.text.includes(firstReturnJob.marker), "repeat return retained the previous packet marker");
assert(continuation.ackReturnJob("cursor-a", secondReturnJob.id) === true, "repeat return job ack");
ok("delivers-idempotently-and-prepares-reviewable-return");

assert(continuation.setKept(created.localAgentId, true).status === "kept", "keep");
assert(continuation.getByAgent(created.localAgentId).status === "kept", "keep persisted");
assert(continuation.setKept(created.localAgentId, false).status === "disposable", "temporary");
const officialSentinel = path.join(root, "official-source-untouched.txt");
fs.writeFileSync(officialSentinel, "official\n");
const deleted = [];
const discardResult = continuation.discard(created.localAgentId, {
  deleteAgent: (agentId) => { deleted.push(agentId); return true; },
});
assert(discardResult.ok && deleted[0] === created.localAgentId, JSON.stringify(discardResult));
assert(!fs.existsSync(agentDir), "local copy not deleted");
assert(fs.readFileSync(officialSentinel, "utf8") === "official\n", "official source changed");
assert(!continuation.getByAgent(created.localAgentId), "discarded copy still listed");
assert(readJson(path.join(agents, "active-agent.json")).activeAgentId !== created.localAgentId, "stale active id");
ok("keep-or-discard-never-touches-official-source");

const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-continuation-only-"));
const secondAgents = path.join(secondRoot, "agents");
const opts = { root: secondRoot, agentsDir: secondAgents };
const only = continuation.createOrUpdate({
  ...snapshot,
  sourceProfileId: "cursor-only",
  sourceAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceThreadId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
}, opts);
continuation.discard(only.localAgentId, { ...opts, deleteAgent: () => true });
assert(!fs.existsSync(path.join(secondAgents, "active-agent.json")), "last discarded bot left stale active id");
fs.rmSync(secondRoot, { recursive: true, force: true });
ok("discard-clears-last-active-agent");

const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-continuation-corrupt-"));
writeJson(path.join(corruptRoot, "runtime", "continuations.json"), { version: 1, records: "broken" });
let corruptRejected = false;
try {
  continuation.createOrUpdate({
    ...snapshot,
    sourceProfileId: "cursor-corrupt",
    sourceAgentId: "abababab-abab-4bab-8bab-abababababab",
  }, { root: corruptRoot });
} catch (error) {
  corruptRejected = /registry/i.test(String(error && error.message || error));
}
assert(corruptRejected, "corrupt continuation registry was overwritten");
assert(!fs.existsSync(path.join(corruptRoot, "hack", "box-data", "agents")), "corrupt registry created an agent");
fs.rmSync(corruptRoot, { recursive: true, force: true });
ok("fails-closed-on-a-corrupt-continuation-registry");

const staleLockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-continuation-stale-lock-"));
const staleLock = path.join(staleLockRoot, "runtime", "continuations.lock");
writeJson(staleLock, { pid: 2147483647, token: "dead", at: Date.now() - 120000 });
const oldTime = new Date(Date.now() - 120000);
fs.utimesSync(staleLock, oldTime, oldTime);
const afterStaleLock = continuation.createOrUpdate({
  ...snapshot,
  sourceProfileId: "cursor-stale-lock",
  sourceAgentId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
}, { root: staleLockRoot });
assert(
  fs.existsSync(path.join(
    staleLockRoot,
    "hack",
    "box-data",
    "agents",
    afterStaleLock.localAgentId,
    "profile.json"
  )),
  "root-scoped continuation escaped its agent root"
);
assert(!fs.existsSync(staleLock), "stale continuation lock remained");
fs.rmSync(staleLockRoot, { recursive: true, force: true });
ok("recovers-dead-locks-without-escaping-the-requested-root");

const parsed = continuation.turnsFromTranscriptEntries([
  { kind: "tool-call", id: "tool", content: "secret tool output" },
  { kind: "send-message", id: "secret", message: { type: "secret-request", content: "token" } },
  { kind: "message", id: "u", role: "user", content: "Safe user text" },
  { kind: "send-message", id: "a", message: { type: "text", content: "Safe assistant text" } },
]);
assert(parsed.length === 2, JSON.stringify(parsed));
assert(!JSON.stringify(parsed).includes("secret"), JSON.stringify(parsed));
ok("captures-human-readable-turns-only");

takeover.writePayload({
  sourceProfileId: "cursor-takeover",
  sourceProfileName: "Takeover seat",
  sourceAgentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  sourceAgentName: "Takeover bot",
  sourceAgentDescription: "Continue this bot locally.",
  model: "grok-4.6",
  turns: [{ id: "takeover-user", role: "user", text: "Resume now." }],
  capturedAt: Date.now(),
});
const takeoverResult = takeover.seed();
assert(takeoverResult.ok && takeoverResult.via === "continuation", JSON.stringify(takeoverResult));
assert(continuation.getByAgent(takeoverResult.id), "takeover did not register continuation");
assert(!fs.existsSync(takeover.PAYLOAD), "successful takeover left a replayable snapshot");
let staleRejected = false;
try {
  takeover.writePayload({
    sourceProfileId: "cursor-stale",
    sourceAgentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    capturedAt: Date.now() - takeover.MAX_PAYLOAD_AGE_MS - 1000,
  });
} catch (error) {
  staleRejected = /stale/.test(String(error && error.message || error));
}
assert(staleRejected, "stale takeover snapshot was written");
let explicitStaleRejected = false;
try {
  takeover.seed({
    sourceProfileId: "cursor-stale-explicit",
    sourceAgentId: "efefefef-efef-4fef-8fef-efefefefefef",
    capturedAt: Date.now() - takeover.MAX_PAYLOAD_AGE_MS - 1000,
  });
} catch (error) {
  explicitStaleRejected = /stale/.test(String(error && error.message || error));
}
assert(explicitStaleRejected, "explicit stale takeover snapshot was accepted");
ok("takeover-entrypoint-uses-continuation-lifecycle");

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/11 continuation checks passed`);
