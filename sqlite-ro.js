// Read-only SQLite that works on macOS while a WAL writer is live.
// Apple's sqlite3 -readonly does not take FILENAME SQL the way we need.
"use strict";

const { execFileSync } = require("child_process");

function sqliteRead(db, sql, opts) {
  const timeout = (opts && opts.timeout) || 4000;
  const encoding = (opts && opts.encoding) || "utf8";
  const maxBuffer = (opts && opts.maxBuffer) || 4 * 1024 * 1024;
  const py = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3"];
  let python = "python3";
  for (const c of py) {
    try {
      if (c === "python3" || require("fs").existsSync(c)) { python = c; break; }
    } catch {}
  }
  try {
    return execFileSync(python, ["-c",
      "import sqlite3,sys\n"
      + "c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True, timeout=2)\n"
      + "rows=c.execute(sys.argv[2])\n"
      + "print('\\n'.join('' if r[0] is None else str(r[0]) for r in rows))\n",
      db, sql,
    ], { encoding, timeout, maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err1) {
    try {
      return execFileSync("sqlite3", ["file:" + db + "?mode=ro&immutable=1", sql], {
        encoding, timeout, maxBuffer, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err2) {
      if (opts && opts.throwOnError) {
        throw new Error(`sqliteRead failed: ${err2.message || err1.message}`);
      }
      if (opts && opts.allowNullOnError) {
        return null;
      }
      return "";
    }
  }
}

module.exports = { sqliteRead };
