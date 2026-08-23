#!/usr/bin/env node
// Create and repair the local agent database shape expected by the bundled host.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BUSY_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLE_SQL = {
  kv: `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;`,
  blobs: `
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL
) STRICT;`,
  transcript_entries: `
CREATE TABLE IF NOT EXISTS transcript_entries (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  entry TEXT NOT NULL
) STRICT;`,
};

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_transcript_window
  ON transcript_entries(seq, entry)
  WHERE json_extract(entry, '$.kind') != 'tool-call'
    AND COALESCE(json_extract(entry, '$.branched'), 0) != 1;
CREATE INDEX IF NOT EXISTS idx_transcript_branched
  ON transcript_entries(seq, entry)
  WHERE COALESCE(json_extract(entry, '$.branched'), 0) = 1;`;

const INDEX_PREDICATES = {
  idx_transcript_window: `
    json_extract(entry, '$.kind') != 'tool-call'
      AND COALESCE(json_extract(entry, '$.branched'), 0) != 1`,
  idx_transcript_branched: `
    COALESCE(json_extract(entry, '$.branched'), 0) = 1`,
};

const PYTHON_CANDIDATES = [
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "python3",
];

function pythonCommands() {
  const configured = String(process.env.GROK_D_PYTHON_CANDIDATES || "")
    .split(path.delimiter)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const seen = new Set();
  const commands = [];
  for (const candidate of configured.concat(PYTHON_CANDIDATES)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    commands.push(candidate);
  }
  return commands;
}

function runSql(file, sql, query) {
  const options = {
    encoding: "utf8",
    timeout: BUSY_TIMEOUT_MS + 2000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", query ? "pipe" : "ignore", "pipe"],
  };
  const errors = [];
  try {
    const args = ["-batch", "-noheader", "-separator", "\t", file, sql];
    return execFileSync("sqlite3", args, options) || "";
  } catch (error) {
    errors.push(error);
  }

  const script = query
    ? [
        "import sqlite3, sys",
        "db = sqlite3.connect(sys.argv[1], timeout=5)",
        "try:",
        "    for row in db.execute(sys.argv[2]):",
        "        print('\\t'.join('' if value is None else str(value) for value in row))",
        "finally:",
        "    db.close()",
      ].join("\n")
    : [
        "import sqlite3, sys",
        "db = sqlite3.connect(sys.argv[1], timeout=5)",
        "try:",
        "    db.executescript(sys.argv[2])",
        "    db.commit()",
        "finally:",
        "    db.close()",
      ].join("\n");
  for (const python of pythonCommands()) {
    try {
      return execFileSync(python, ["-c", script, file, sql], options) || "";
    } catch (error) {
      errors.push(error);
    }
  }

  const detail = errors
    .map((error) => String(error && (error.stderr || error.message) || error).trim())
    .filter(Boolean)
    .join("; ");
  throw new Error(`could not open local agent store.db${detail ? `: ${detail}` : ""}`);
}

function queryRows(file, sql) {
  return String(runSql(file, sql, true) || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tableInfo(file, name) {
  return queryRows(file, `PRAGMA table_info(${quoteIdent(name)});`).map((row) => ({
    cid: Number(row[0]),
    name: row[1],
    type: String(row[2] || "").toUpperCase(),
    notnull: Number(row[3]),
    defaultValue: row[4],
    pk: Number(row[5]),
  }));
}

function tableIsStrict(file, name) {
  const row = queryRows(file, `PRAGMA table_list(${quoteIdent(name)});`)
    .find((item) => item[1] === name && item[2] === "table");
  return !!(row && Number(row[5]) === 1);
}

function normalizePredicate(value) {
  const match = /\bWHERE\b([\s\S]*?)\s*;?\s*$/i.exec(String(value || ""));
  return match ? match[1].toLowerCase().replace(/\s+/g, "") : "";
}

function indexState(file, name) {
  const rows = queryRows(file, "PRAGMA index_list(transcript_entries);");
  const row = rows.find((item) => item[1] === name);
  if (!row) return { exists: false, canonical: false };
  const columns = queryRows(file, `PRAGMA index_info(${quoteIdent(name)});`).map((item) => item[2]);
  const schemaHex = queryRows(
    file,
    `SELECT hex(sql) FROM sqlite_schema WHERE type = 'index' AND name = ${quoteSql(name)};`
  )[0];
  const schema = schemaHex && schemaHex[0]
    ? Buffer.from(schemaHex[0], "hex").toString("utf8")
    : "";
  const predicate = normalizePredicate(schema);
  return {
    exists: true,
    canonical: Number(row[4]) === 1
      && columns.join(",") === "seq,entry"
      && predicate === normalizePredicate(`WHERE ${INDEX_PREDICATES[name] || ""}`),
    predicate,
  };
}

function exactColumns(actual, expected) {
  if (actual.length !== expected.length) return false;
  return expected.every((column, index) => {
    const got = actual[index];
    return got
      && got.name === column.name
      && got.type === column.type
      && got.notnull === column.notnull
      && got.pk === column.pk;
  });
}

function hasUniqueColumn(file, table, column) {
  const indexes = queryRows(file, `PRAGMA index_list(${quoteIdent(table)});`);
  for (const row of indexes) {
    if (Number(row[2]) !== 1 || Number(row[4]) === 1) continue;
    const columns = queryRows(file, `PRAGMA index_info(${quoteIdent(row[1])});`).map((item) => item[2]);
    if (columns.length === 1 && columns[0] === column) return true;
  }
  return false;
}

function tableState(file, name, expected, uniqueColumn) {
  const columns = tableInfo(file, name);
  return {
    exists: columns.length > 0,
    columns,
    canonical: columns.length > 0
      && tableIsStrict(file, name)
      && exactColumns(columns, expected)
      && (!uniqueColumn || hasUniqueColumn(file, name, uniqueColumn)),
  };
}

function inspectAgentStoreDb(file) {
  if (!fs.existsSync(file)) {
    return { exists: false, canonical: false };
  }
  const kv = tableState(file, "kv", [
    { name: "key", type: "TEXT", notnull: 1, pk: 1 },
    { name: "value", type: "TEXT", notnull: 1, pk: 0 },
  ]);
  const blobs = tableState(file, "blobs", [
    { name: "id", type: "TEXT", notnull: 1, pk: 1 },
    { name: "data", type: "BLOB", notnull: 1, pk: 0 },
  ]);
  const transcript = tableState(file, "transcript_entries", [
    { name: "seq", type: "INTEGER", notnull: 0, pk: 1 },
    { name: "id", type: "TEXT", notnull: 1, pk: 0 },
    { name: "entry", type: "TEXT", notnull: 1, pk: 0 },
  ], "id");
  const windowIndex = indexState(file, "idx_transcript_window");
  const branchedIndex = indexState(file, "idx_transcript_branched");
  return {
    exists: true,
    canonical: kv.canonical
      && blobs.canonical
      && transcript.canonical
      && windowIndex.canonical
      && branchedIndex.canonical,
    kv,
    blobs,
    transcript,
    windowIndex,
    branchedIndex,
  };
}

function recoveryMarker(file, columns) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const marker = `~grokd-recovered-${crypto.randomBytes(8).toString("hex")}~`;
    if (!columns.some((column) => column.name === "id")) return marker;
    const collision = queryRows(
      file,
      `SELECT 1 FROM transcript_entries
       WHERE id IS NOT NULL AND instr(CAST(id AS TEXT), ${quoteSql(marker)}) > 0
       LIMIT 1;`
    )[0];
    if (!collision) return marker;
  }
  throw new Error("could not allocate a collision-free transcript recovery marker");
}

function recoveredIdExpression(columns, marker) {
  const generated = `${quoteSql(marker)} || printf('%016x', rowid)`;
  if (!columns.some((column) => column.name === "id")) {
    return generated;
  }
  return [
    "CASE",
    "WHEN id IS NULL OR length(trim(CAST(id AS TEXT))) = 0",
    `THEN ${generated}`,
    "ELSE CAST(id AS TEXT)",
    "END",
  ].join(" ");
}

function repairTranscriptSql(file, state) {
  if (!state.exists) return TABLE_SQL.transcript_entries;
  if (state.canonical) return "";
  if (!state.columns.some((column) => column.name === "entry")) {
    throw new Error("incompatible local agent store.db: transcript_entries has no entry column");
  }
  const signature = state.columns.map((column) => column.name).sort().join(",");
  if (!new Set(["entry,id", "entry,seq", "entry,id,seq"]).has(signature)) {
    throw new Error("incompatible local agent store.db: unknown transcript_entries schema");
  }
  const backup = `_grokd_legacy_transcript_${process.pid}_${Date.now()}`;
  const marker = recoveryMarker(file, state.columns);
  const hasSeq = state.columns.some((column) => column.name === "seq");
  return `
ALTER TABLE transcript_entries RENAME TO ${quoteIdent(backup)};
${TABLE_SQL.transcript_entries}
WITH recovered AS (
  SELECT
    rowid AS legacy_rowid,
    ${recoveredIdExpression(state.columns, marker)} AS base_id,
    CAST(entry AS TEXT) AS entry,
    ${hasSeq ? "CASE WHEN typeof(seq) = 'integer' THEN seq ELSE rowid END" : "rowid"} AS legacy_order
  FROM ${quoteIdent(backup)}
  WHERE entry IS NOT NULL
),
numbered AS (
  SELECT
    legacy_rowid,
    base_id,
    entry,
    legacy_order,
    ROW_NUMBER() OVER (
      PARTITION BY base_id
      ORDER BY legacy_order, legacy_rowid
    ) AS duplicate_rank
  FROM recovered
)
INSERT INTO transcript_entries(id, entry)
  SELECT
    CASE
      WHEN duplicate_rank = 1 THEN base_id
      ELSE base_id || ${quoteSql(marker)} || printf('%016x', legacy_rowid)
    END,
    entry
  FROM numbered
  ORDER BY legacy_order, legacy_rowid;
DROP TABLE ${quoteIdent(backup)};`;
}

function ensureAgentStoreDb(file) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(parent, 0o700); } catch {}
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("refusing to open a symlinked local agent store.db");
  }
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, "wx", 0o600);
    fs.closeSync(fd);
  }
  try { fs.chmodSync(file, 0o600); } catch {}

  const before = inspectAgentStoreDb(file);
  if (before.kv && before.kv.exists && !before.kv.canonical) {
    throw new Error("incompatible local agent store.db: kv schema");
  }
  if (before.blobs && before.blobs.exists && !before.blobs.canonical) {
    throw new Error("incompatible local agent store.db: blobs schema");
  }
  const transcriptSql = before.transcript
    ? repairTranscriptSql(file, before.transcript)
    : TABLE_SQL.transcript_entries;
  const rebuildingTranscript = !!(before.transcript && !before.transcript.canonical);
  const indexDropSql = [
    ["idx_transcript_window", before.windowIndex],
    ["idx_transcript_branched", before.branchedIndex],
  ]
    .filter(([, state]) => state && state.exists && (rebuildingTranscript || !state.canonical))
    .map(([name]) => `DROP INDEX ${quoteIdent(name)};`)
    .join("\n");
  const sql = `
PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
BEGIN IMMEDIATE;
${indexDropSql}
${before.kv && before.kv.exists ? "" : TABLE_SQL.kv}
${before.blobs && before.blobs.exists ? "" : TABLE_SQL.blobs}
${transcriptSql}
${INDEX_SQL}
COMMIT;`;
  runSql(file, sql, false);

  const after = inspectAgentStoreDb(file);
  if (!after.canonical) {
    throw new Error("local agent store.db did not reach the canonical host schema");
  }
  const quickCheck = queryRows(file, "PRAGMA quick_check;")[0];
  if (!quickCheck || quickCheck[0] !== "ok") {
    throw new Error("local agent store.db failed PRAGMA quick_check");
  }
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

function ensureAgentStores(root) {
  const agentsRoot = path.resolve(root);
  fs.mkdirSync(agentsRoot, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(agentsRoot, 0o700); } catch {}
  const entries = fs.readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && UUID_RE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const summary = {
    root: agentsRoot,
    checked: 0,
    created: 0,
    repaired: 0,
  };
  for (const entry of entries) {
    const file = path.join(agentsRoot, entry.name, "store.db");
    let before;
    try {
      before = inspectAgentStoreDb(file);
      ensureAgentStoreDb(file);
    } catch (error) {
      throw new Error(
        `local agent ${entry.name} store repair failed: ${error && error.message || error}`
      );
    }
    summary.checked += 1;
    if (!before.exists) summary.created += 1;
    else if (!before.canonical) summary.repaired += 1;
  }
  return summary;
}

module.exports = {
  BUSY_TIMEOUT_MS,
  inspectAgentStoreDb,
  ensureAgentStoreDb,
  ensureAgentStores,
};

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: agent-store-db.js <store.db> | --agents-root <directory>");
    process.exit(2);
  }
  if (arg === "--agents-root") {
    const root = process.argv[3];
    if (!root) {
      console.error("usage: agent-store-db.js --agents-root <directory>");
      process.exit(2);
    }
    console.log(JSON.stringify(ensureAgentStores(root), null, 2));
    process.exit(0);
  }
  const file = arg;
  ensureAgentStoreDb(path.resolve(file));
  console.log(JSON.stringify(inspectAgentStoreDb(path.resolve(file)), null, 2));
}
