#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const assert = (c, m) => { if (!c) throw new Error(m); };
const { sqliteRead } = require("./sqlite-ro");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-sql-"));
const db = path.join(tmp, "t.db");
execFileSync("sqlite3", [db, "CREATE TABLE t(x TEXT); INSERT INTO t VALUES ('hello-wal');"]);
const out = sqliteRead(db, "SELECT x FROM t;");
assert(/hello-wal/.test(out), out);
assert(sqliteRead(path.join(tmp, "missing.db"), "SELECT 1;") === "", "missing is empty not throw");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("PASS  sqlite-ro");
