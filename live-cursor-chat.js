#!/usr/bin/env node
// Drive a live conversation in D as Cursor A, then restore Local D.
// Does not kill official Grok Bot apps. Does not write their live user-data.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const { waitReady, sendCommand } = require("./command-client");

const SWITCH = path.join(__dirname, "switch-profile.js");
const PROOF = path.join(__dirname, "proof", `live-abc-${Date.now()}`);
const SEATS = [
  { id: "cursor-a", label: "A" },
];

function bUp() {
  try {
    execFileSync("pgrep", ["-f", "Grok Bot B.app/Contents/MacOS/Grok Bot.real --user-data-dir"], {
      encoding: "utf8",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

function switchTo(id) {
  const r = spawnSync(process.execPath, [SWITCH, "switch", id], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.status !== 0) throw new Error(`switch ${id}: ${r.stderr || r.stdout || r.status}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

function shot(name) {
  try {
    const dest = path.join(PROOF, `${name}.png`);
    execFileSync("screencapture", ["-x", dest], { timeout: 8000 });
    return dest;
  } catch {
    return null;
  }
}

function redactIdentity(id) {
  if (!id || typeof id !== "object") return id;
  return {
    kind: id.kind,
    email: id.email,
    name: id.name,
    authId: id.authId ? String(id.authId).slice(0, 24) + "…" : undefined,
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function pageIdentity() {
  try {
    const r = execFileSync(process.execPath, [
      path.join(__dirname, "cdp-eval.js"),
      `(async()=>{try{return await window.desktop.cursorAccount.getStatus()}catch(e){return {kind:"error",error:String(e&&e.message||e)}}})()`,
    ], { encoding: "utf8", timeout: 10000 });
    const parsed = JSON.parse(r);
    return (parsed && parsed.result && parsed.result.value) || parsed;
  } catch (e) {
    return { kind: "cdp-failed", error: String(e.message || e) };
  }
}

async function waitBus(label) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < 90000) {
    try {
      const ready = await waitReady(12000);
      const st = await sendCommand("status", {}, 10000);
      if (st && st.ok) return { ready, status: st };
      last = JSON.stringify(st);
    } catch (e) {
      last = e.message;
    }
    await sleep(1500);
  }
  throw new Error(`${label} bus not ready: ${last}`);
}

async function main() {
  fs.mkdirSync(PROOF, { recursive: true });
  const report = { startedAt: new Date().toISOString(), seats: [], bUpBefore: bUp() };

  try {
    for (const seat of SEATS) {
      console.log(`\n== switch ${seat.id} ==`);
      const sw = switchTo(seat.id);
      console.log(JSON.stringify(sw));
      await sleep(4000);
      const bus = await waitBus(seat.label);
      const ident = pageIdentity();
      const token = `LIVE-${seat.label}-${Date.now().toString(36)}`;
      const text = `Reply with exactly ${token} and one short sentence. Do not use tools.`;
      console.log("identity", redactIdentity(ident));
      shot(`${seat.label}-before-send`);
      const sent = await sendCommand("send", { text, token, timeoutMs: 90000 }, 110000);
      shot(`${seat.label}-after-send`);
      const row = {
        seat: seat.label,
        id: seat.id,
        switch: sw,
        identity: redactIdentity(ident),
        ok: !!sent.ok,
        typed: !!sent.typed,
        reply: sent.reply ? String(sent.reply).slice(0, 400) : null,
        error: sent.error || null,
        bUp: bUp(),
      };
      report.seats.push(row);
      console.log(JSON.stringify(row, null, 2));
    }
  } finally {
    console.log("\n== restore local-d ==");
    try {
      const back = switchTo("local-d");
      report.restore = back;
      await sleep(3000);
      try { report.local = await waitBus("local"); } catch (e) { report.localError = e.message; }
    } catch (e) {
      report.restoreError = e.message;
    }
    report.bUpAfter = bUp();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(PROOF, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log("proof", PROOF);
    console.log(JSON.stringify({
      seats: report.seats.map((s) => ({ seat: s.seat, ok: s.ok, email: s.identity && s.identity.email })),
      bUpAfter: report.bUpAfter,
    }, null, 2));
  }

  const failed = report.seats.filter((s) => !s.ok);
  if (failed.length) {
    process.exitCode = 1;
    console.error(`FAIL ${failed.length}/3 live Cursor chats`);
  } else {
    console.log("PASS 3/3 live Cursor chats");
  }
  if (!report.bUpAfter) {
    process.exitCode = 1;
    console.error("FAIL B is not running");
  }
}

main().catch((e) => {
  console.error(e);
  try { switchTo("local-d"); } catch {}
  process.exit(1);
});
