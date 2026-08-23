#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  ensureAgentStoreDb,
  ensureAgentStores,
  inspectAgentStoreDb,
} = require("./agent-store-db");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS ", name);
};

function sqlite(db, sql) {
  return execFileSync("sqlite3", [db, sql], { encoding: "utf8" });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-agent-store-"));

const fresh = path.join(root, "fresh", "store.db");
ensureAgentStoreDb(fresh);
const freshState = inspectAgentStoreDb(fresh);
assert(freshState.canonical, JSON.stringify(freshState));
assert(freshState.kv.canonical, "kv schema");
assert(freshState.blobs.canonical, "blobs schema");
assert(freshState.transcript.canonical, "transcript schema");
assert(freshState.windowIndex.canonical && freshState.branchedIndex.canonical, "transcript indexes");
assert((fs.statSync(fresh).mode & 0o777) === 0o600, "store.db must be owner-only");
assert((fs.statSync(path.dirname(fresh)).mode & 0o777) === 0o700, "agent directory must be owner-only");
sqlite(fresh, [
  "INSERT INTO kv(key,value) VALUES ('purpose','test');",
  "INSERT INTO blobs(id,data) VALUES ('blob-one',x'0102');",
  "INSERT INTO transcript_entries(id,entry) VALUES ('turn-one','{\"kind\":\"message\"}');",
].join(" "));
ensureAgentStoreDb(fresh);
assert(sqlite(fresh, "SELECT value FROM kv WHERE key='purpose';").trim() === "test", "kv lost");
assert(sqlite(fresh, "SELECT hex(data) FROM blobs WHERE id='blob-one';").trim() === "0102", "blob lost");
assert(sqlite(fresh, "SELECT id FROM transcript_entries;").trim() === "turn-one", "turn lost");
sqlite(fresh, [
  "DROP INDEX idx_transcript_window;",
  "CREATE INDEX idx_transcript_window ON transcript_entries(seq, entry) WHERE 1 = 1;",
].join(" "));
assert(!inspectAgentStoreDb(fresh).windowIndex.canonical, "wrong index predicate accepted");
ensureAgentStoreDb(fresh);
assert(inspectAgentStoreDb(fresh).windowIndex.canonical, "wrong index predicate not repaired");
ok("creates-idempotent-canonical-store");

const legacy = path.join(root, "legacy", "store.db");
fs.mkdirSync(path.dirname(legacy), { recursive: true });
sqlite(legacy, [
  "CREATE TABLE transcript_entries (id TEXT, entry TEXT);",
  "INSERT INTO transcript_entries VALUES ('legacy-one','{\"kind\":\"message\",\"content\":\"one\"}');",
  "INSERT INTO transcript_entries VALUES ('legacy-one','{\"kind\":\"message\",\"content\":\"duplicate\"}');",
  "INSERT INTO transcript_entries VALUES ('','{\"kind\":\"message\",\"content\":\"blank\"}');",
].join(" "));
ensureAgentStoreDb(legacy);
const legacyState = inspectAgentStoreDb(legacy);
assert(legacyState.canonical, JSON.stringify(legacyState));
const recovered = sqlite(
  legacy,
  "SELECT seq || '|' || id || '|' || json_extract(entry, '$.content')"
    + " FROM transcript_entries ORDER BY seq;"
).trim().split("\n");
assert(recovered.length === 3, JSON.stringify(recovered));
assert(recovered[0] === "1|legacy-one|one", recovered[0]);
assert(/^2\|legacy-one~grokd-recovered-[0-9a-f]{16}~[0-9a-f]{16}\|duplicate$/.test(recovered[1]), recovered[1]);
assert(/^3\|~grokd-recovered-[0-9a-f]{16}~[0-9a-f]{16}\|blank$/.test(recovered[2]), recovered[2]);
assert(new Set(recovered.map((row) => row.split("|")[1])).size === 3, "recovered ids are not unique");
ok("repairs-two-column-store-without-losing-turns");

const incompatible = path.join(root, "incompatible", "store.db");
fs.mkdirSync(path.dirname(incompatible), { recursive: true });
sqlite(incompatible, "CREATE TABLE kv (key TEXT); INSERT INTO kv VALUES ('keep-me');");
let rejected = false;
try {
  ensureAgentStoreDb(incompatible);
} catch (error) {
  rejected = /incompatible/.test(String(error && error.message || error));
}
assert(rejected, "incompatible schema was accepted");
assert(sqlite(incompatible, "SELECT key FROM kv;").trim() === "keep-me", "failed repair destroyed data");
const unknownTranscript = path.join(root, "unknown-transcript", "store.db");
fs.mkdirSync(path.dirname(unknownTranscript), { recursive: true });
sqlite(unknownTranscript, [
  "CREATE TABLE transcript_entries (id TEXT, entry TEXT, private_metadata TEXT);",
  "INSERT INTO transcript_entries VALUES ('keep','{\"kind\":\"message\"}','do-not-drop');",
].join(" "));
let unknownTranscriptRejected = false;
try {
  ensureAgentStoreDb(unknownTranscript);
} catch (error) {
  unknownTranscriptRejected = /unknown transcript_entries schema/.test(
    String(error && error.message || error)
  );
}
assert(unknownTranscriptRejected, "unknown transcript schema was destructively migrated");
assert(
  sqlite(unknownTranscript, "SELECT private_metadata FROM transcript_entries;").trim() === "do-not-drop",
  "unknown transcript schema lost data"
);
ok("fails-closed-on-unknown-schema");

const sweepRoot = path.join(root, "sweep-agents");
const missingId = "11111111-1111-4111-8111-111111111111";
const oldId = "22222222-2222-4222-8222-222222222222";
fs.mkdirSync(path.join(sweepRoot, missingId), { recursive: true });
fs.mkdirSync(path.join(sweepRoot, oldId), { recursive: true });
fs.mkdirSync(path.join(sweepRoot, ".grokd-agent-still-building"), { recursive: true });
sqlite(
  path.join(sweepRoot, oldId, "store.db"),
  "CREATE TABLE transcript_entries (id TEXT, entry TEXT);"
    + " INSERT INTO transcript_entries VALUES ('old','{\"kind\":\"message\"}');"
);
const sweep = ensureAgentStores(sweepRoot);
assert(sweep.checked === 2 && sweep.created === 1 && sweep.repaired === 1, JSON.stringify(sweep));
assert(inspectAgentStoreDb(path.join(sweepRoot, missingId, "store.db")).canonical, "missing store not created");
assert(inspectAgentStoreDb(path.join(sweepRoot, oldId, "store.db")).canonical, "old store not repaired");
assert(
  !fs.existsSync(path.join(sweepRoot, ".grokd-agent-still-building", "store.db")),
  "startup sweep opened a staging directory"
);
const badId = "33333333-3333-4333-8333-333333333333";
const badStore = path.join(sweepRoot, badId, "store.db");
fs.mkdirSync(path.dirname(badStore), { recursive: true });
sqlite(badStore, "CREATE TABLE blobs (id TEXT); INSERT INTO blobs VALUES ('preserve');");
let sweepRejected = false;
try {
  ensureAgentStores(sweepRoot);
} catch (error) {
  sweepRejected = String(error && error.message || error).includes(badId);
}
assert(sweepRejected, "startup sweep did not identify the incompatible agent");
assert(sqlite(badStore, "SELECT id FROM blobs;").trim() === "preserve", "startup sweep destroyed bad store");
ok("startup-sweep-repairs-every-visible-agent-and-fails-closed");

const python = [
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
].find((candidate) => fs.existsSync(candidate));
if (python) {
  const fallbackRoot = path.join(root, "python-fallback");
  const fakeBin = path.join(fallbackRoot, "bin");
  const badPython = path.join(fakeBin, "bad-python");
  const fakeSqlite = path.join(fakeBin, "sqlite3");
  const fallbackDb = path.join(fallbackRoot, "agent", "store.db");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(badPython, "#!/bin/sh\nexit 43\n");
  fs.writeFileSync(fakeSqlite, "#!/bin/sh\nexit 42\n");
  fs.chmodSync(badPython, 0o755);
  fs.chmodSync(fakeSqlite, 0o755);
  const child = spawnSync(process.execPath, [
    path.join(__dirname, "agent-store-db.js"),
    fallbackDb,
  ], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      PATH: fakeBin,
      GROK_D_PYTHON_CANDIDATES: [badPython, python].join(path.delimiter),
    }),
    timeout: 20000,
  });
  assert(child.status === 0, `${child.stdout}\n${child.stderr}`);
  assert(inspectAgentStoreDb(fallbackDb).canonical, "later Python candidate was not attempted");
}
ok("tries-every-available-python-fallback");

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/5 agent-store checks passed`);
