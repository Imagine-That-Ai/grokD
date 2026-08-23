#!/usr/bin/env node
// Capability matrix: Local and each Cursor seat must stay up, stay signed
// in, and complete a send. Does not kill Grok Bot B.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const { waitReady, sendCommand } = require("./command-client");
const box = require("./box-state");
const cdpSend = require("./cdp-send");

const ROOT = path.join(os.homedir(), ".grok", "grokbot-d");
const SWITCH = path.join(ROOT, "switch-profile.js");
const SEAT4 = path.join(os.homedir(), "Library/Application Support/GrokBotSeat4");
const REPORT = path.join(ROOT, "proof", `seat-matrix-${Date.now()}`);

const SEATS = [
  { id: "cursor-b", label: "Cursor B", kind: "cursor" },
  { id: "local-d", label: "Local D", kind: "local" },
  { id: "cursor-b", label: "Cursor B again", kind: "cursor" },
  { id: "cursor-a", label: "Cursor A", kind: "cursor" },
  { id: "cursor-c", label: "Cursor C", kind: "cursor" },
  { id: "local-d", label: "Local D again", kind: "local" },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function bUp() {
  try {
    execFileSync("pgrep", ["-f", "Grok Bot B.app/Contents/MacOS/Grok Bot.real --user-data-dir"], {
      encoding: "utf8", timeout: 2000,
    });
    return true;
  } catch { return false; }
}

function dPid() {
  try {
    const out = execFileSync("pgrep", ["-f", "Grok Bot D.app/Contents/MacOS/Grok Bot.real --user-data-dir"], {
      encoding: "utf8", timeout: 2000,
    });
    return parseInt(out.trim().split(/\s+/)[0], 10) || null;
  } catch { return null; }
}

function switchTo(id) {
  const r = spawnSync(process.execPath, [SWITCH, "switch", id], {
    encoding: "utf8",
    timeout: 45000,
  });
  return {
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

async function waitD(prevPid, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const pid = dPid();
    if (pid && pid !== prevPid) {
      try {
        const ready = await waitReady(8000);
        return { pid, ready };
      } catch {}
    }
    await sleep(400);
  }
  return { pid: dPid(), ready: null };
}

function conn() {
  const p = box.connectionPath(SEAT4);
  if (!fs.existsSync(p)) return { present: false };
  const j = box.readJson(p) || {};
  return {
    present: true,
    remote: box.isRemoteConnection(p),
    local: /127\.0\.0\.1|localhost/.test(j.baseUrl || ""),
    baseUrl: j.baseUrl || null,
  };
}

async function probeSeat(label, token) {
  const out = { label, token, ok: false };
  out.bUp = bUp();
  out.dPid = dPid();
  out.conn = conn();
  try {
    await waitReady(15000);
    out.status = await sendCommand("status", {}, 20000);
  } catch (e) {
    out.statusError = String(e.message || e);
    return out;
  }
  try {
    out.page = cdpSend.evalJs(`(function(){
      const t = document.body ? document.body.innerText : "";
      return {
        unavail: /isn.?t available on this account/i.test(t),
        rec: /Will send when reconnected/.test(t),
        orbs: !!document.getElementById("pure-lava-orbs-root"),
        composer: !!(document.querySelector("[contenteditable=true]") || document.querySelector("[role=textbox]")),
      };
    })()`);
  } catch (e) { out.pageError = String(e.message || e); }
  out.cover = !!(out.page && out.page.unavail);
  out.queued = !!(out.status && out.status.queued) || !!(out.page && out.page.rec);
  out.orbs = !!(out.page && out.page.orbs);
  out.composer = !!(out.page && out.page.composer);
  out.loggedIn = (out.status && out.status.mode === "local")
    || (out.status && out.status.identity && out.status.identity.kind === "logged-in");
  if (out.status && out.status.mode === "cursor" && !out.conn.remote) {
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && !conn().remote) await sleep(500);
    out.conn = conn();
  }
  if (out.status && out.status.mode === "cursor" && !out.conn.remote) {
    out.sendError = "no remote computer for this Cursor seat";
    out.replied = false;
    out.ok = false;
    return out;
  }
  const text = `In one short line, reply with exactly ${token} and nothing else.`;
  try {
    if (out.status && out.status.mode === "local") {
      out.send = await sendCommand("send", { text, token, timeoutMs: 70000 }, 85000);
      out.replied = !!(out.send && out.send.ok);
    } else {
      out.send = cdpSend.send(text, token, 70000);
      out.replied = !!(out.send && out.send.ok);
    }
  } catch (e) {
    out.sendError = String(e.message || e);
    out.replied = false;
  }
  out.ok = !!(out.bUp && out.dPid && out.loggedIn && !out.cover && !out.queued && out.replied);
  return out;
}

async function main() {
  fs.mkdirSync(REPORT, { recursive: true });
  const results = [];
  if (!bUp() || !dPid()) {
    console.log("SKIP  test-seat-matrix (requires live Grok Bot B and D GUI processes)");
    process.exit(0);
  }

  const initialProfile = (() => {
    try {
      const p = path.join(process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d"), "active-env.json");
      return JSON.parse(fs.readFileSync(p, "utf8")).profileId || "local-d";
    } catch { return "local-d"; }
  })();

  try {
    for (const seat of SEATS) {
      const prev = dPid();
      const sw = switchTo(seat.id);
      let parsed = null;
      try { parsed = JSON.parse(sw.stdout.split("\n").pop()); } catch {}
      const switchOk = sw.status === 0 && (!parsed || parsed.ok !== false);
      if (!switchOk) {
        results.push({
          seat: seat.id,
          label: seat.label,
          kind: seat.kind,
          switch: sw,
          wait: null,
          probe: { label: seat.label, token: null, ok: false, error: "Profile switch failed before probe" },
        });
        continue;
      }
      const waited = (parsed && parsed.noop)
        ? { pid: dPid(), ready: await waitReady(15000).catch(() => null), noop: true }
        : await waitD(prev);
      const token = `HARNESS-${seat.id.replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${Date.now().toString().slice(-6)}`;
      const row = {
        seat: seat.id,
        label: seat.label,
        kind: seat.kind,
        switch: sw,
        wait: waited,
        probe: await probeSeat(seat.label, token),
      };
      results.push(row);
      console.log(JSON.stringify({
        seat: row.seat,
        label: row.label,
        dPid: row.probe.dPid,
        bUp: row.probe.bUp,
        loggedIn: row.probe.loggedIn,
        cover: row.probe.cover,
        queued: row.probe.queued,
        conn: row.probe.conn,
        replied: row.probe.replied,
        ok: row.probe.ok,
      }));
      if (!bUp()) throw new Error("B died during " + seat.id);
    }
  } finally {
    try {
      switchTo(initialProfile);
    } catch (_) {}
  }

  const summary = {
    ts: Date.now(),
    passed: results.filter((r) => r.probe.ok).length,
    total: results.length,
    bUp: bUp(),
    results,
  };
  fs.writeFileSync(path.join(REPORT, "report.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("\nREPORT", REPORT);
  console.log(`${summary.passed}/${summary.total} seats passed, B ${summary.bUp ? "up" : "DOWN"}`);
  if (summary.passed !== summary.total || !summary.bUp) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
