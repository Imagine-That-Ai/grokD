#!/usr/bin/env node
// Robust inter-bot messaging tests for Grok Bot D local box.
const fs = require("fs");
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const secGuard = require("./security-guard");
const HOST = "http://127.0.0.1:1337";
const TOKEN = secGuard.getGatewayToken();

async function api(method, body = {}) {
  const r = await fetch(`${HOST}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${r.status}: ${text.slice(0, 400)}`);
  return json;
}

function lastEntries(agentId, n = 8) {
  const { execFileSync } = require("child_process");
  const db = `/tmp/grokbot-hack/box-data/agents/${agentId}/store.db`;
  const out = execFileSync("sqlite3", [db, `SELECT id || '\\t' || substr(entry,1,500) FROM transcript_entries ORDER BY rowid DESC LIMIT ${n};`], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function transcriptHas(agentId, needle) {
  return lastEntries(agentId, 20).some((line) => line.includes(needle));
}

const resolveTeammate = (agents, raw) => {
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
};

async function waitFor(pred, { timeoutMs = 45000, everyMs = 800, label = "condition" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function sendBetween(fromName, toRaw, message) {
  const agents = await api("listAgents");
  const dest = resolveTeammate(agents, toRaw);
  if (!dest) throw new Error(`could not resolve ${toRaw}`);
  const from = resolveTeammate(agents, fromName);
  const prompt = `[Bot-to-bot from ${from?.name || fromName}]: ${message}`;
  await api("sendPrompt", { agentId: dest.id, prompt, awaitTurn: false });
  return { dest, from, prompt };
}

(async () => {
  const results = [];
  const pass = (name) => { results.push({ name, ok: true }); console.log(`PASS  ${name}`); };
  const fail = (name, err) => { results.push({ name, ok: false, err: String(err) }); console.log(`FAIL  ${name}: ${err}`); };

  let agents = [];
  try { agents = await api("listAgents"); } catch (_) { agents = []; }
  if (!Array.isArray(agents) || agents.length < 2) {
    console.log(`SKIP test-bot-messaging (need >= 2 live agents, got ${agents?.length || 0})`);
    return;
  }
  const by = (q) => resolveTeammate(agents, q);
  const lol = by("lol");
  const grok = by('grok"D"') || by("Grok Bot D") || by("grok d");
  const sally = by("sally");
  if (!lol || !grok || !sally) {
    console.log(`SKIP test-bot-messaging (missing required named bots: lol=${!!lol} grok=${!!grok} sally=${!!sally})`);
    return;
  }

  // Test 1: Full name resolution
  try {
    assert(by("lol")?.id === lol.id, "lol");
    assert(by('grok"D"')?.id === grok.id || by("Grok Bot D")?.id === grok.id, "grok name resolution");
    assert(by("sally the seashell slinging slut")?.id === sally.id, "sally full");
    assert(by("Grok Bot D")?.id === grok.id, "Grok Bot D");
    assert(by("grok d")?.id === grok.id, "grok d");
    assert(by("sally")?.id === sally.id, "sally");
    assert(by("does-not-exist-bot") == null, "unknown");
    pass("name-resolution");
  } catch (e) { fail("name-resolution", e); }

  // 2. empty / unknown via the same rules the bridge uses
  try {
    assert(!resolveTeammate(agents, ""), "empty");
    assert(!resolveTeammate(agents, "   "), "ws");
    assert(!resolveTeammate(agents, "nope-xyz"), "unknown");
    pass("reject-bad-targets");
  } catch (e) { fail("reject-bad-targets", e); }

  // 3. sally -> lol unique token, wait for delivery in lol transcript
  const tokenA = `PINGA-${Date.now().toString(36)}`;
  try {
    await sendBetween("sally", "lol", `Reply with exactly the token ${tokenA} and nothing else.`);
    await waitFor(() => transcriptHas(lol.id, tokenA), { label: `lol received ${tokenA}` });
    pass("deliver-sally-to-lol");
  } catch (e) { fail("deliver-sally-to-lol", e); }

  // 4. wait for lol to actually reply (wake + inference)
  try {
    await waitFor(() => {
      const lines = lastEntries(lol.id, 8);
      // a send-message after the inbound token
      const idx = lines.findIndex((l) => l.includes(tokenA) && l.includes("user"));
      if (idx < 0) return false;
      return lines.slice(0, idx).some((l) => l.includes("send-message") || l.includes('"role":"assistant"') || l.includes("Pong") || l.includes(tokenA) && l.includes("send-message"));
    }, { timeoutMs: 60000, label: "lol replied after inbound" });
    pass("lol-woke-and-replied");
  } catch (e) { fail("lol-woke-and-replied", e); }

  // 5. grok -> sally different token
  const tokenB = `PINGB-${Date.now().toString(36)}`;
  try {
    await sendBetween("Grok Bot D", "sally", `Secret token ${tokenB}. Acknowledge it.`);
    await waitFor(() => transcriptHas(sally.id, tokenB), { label: `sally received ${tokenB}` });
    pass("deliver-grok-to-sally");
  } catch (e) { fail("deliver-grok-to-sally", e); }

  // 6. lol -> grok d by fuzzy name
  const tokenC = `PINGC-${Date.now().toString(36)}`;
  try {
    await sendBetween("lol", "grok d", `Fuzzy-name check ${tokenC}`);
    await waitFor(() => transcriptHas(grok.id, tokenC), { label: `grok received ${tokenC}` });
    pass("deliver-fuzzy-grok-d");
  } catch (e) { fail("deliver-fuzzy-grok-d", e); }

  // 7. live inference path: force SendToAgent from sally to lol
  const tokenD = `LIVE-${Date.now().toString(36)}`;
  try {
    await api("sendPrompt", {
      agentId: sally.id,
      prompt: `Use the SendToAgent tool now. target_id must be "${lol.id}" or "lol". message must contain the exact token ${tokenD}. Do not only promise it — call SendToAgent.`,
      awaitTurn: false,
    });
    await waitFor(() => transcriptHas(lol.id, tokenD), { timeoutMs: 90000, label: `lol transcript has ${tokenD}` });
    pass("inference-sendtoagent-path");
  } catch (e) { fail("inference-sendtoagent-path", e); }

  // 8. natural language: "tell lol to …" without naming the tool
  const tokenE = `TELL-${Date.now().toString(36)}`;
  try {
    await api("sendPrompt", {
      agentId: sally.id,
      prompt: `tell lol to repeat the token ${tokenE} in her chat`,
      awaitTurn: false,
    });
    await waitFor(() => transcriptHas(lol.id, tokenE), { timeoutMs: 80000, label: "nl tell-lol delivered" });
    pass("natural-language-tell-lol");
  } catch (e) { fail("natural-language-tell-lol", e); }

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${ok}/${results.length} passed`);
  if (bad.length) {
    for (const b of bad) console.log("  -", b.name, b.err);
    process.exit(1);
  }
})().catch((e) => {
  console.error("HARNESS FAIL", e);
  process.exit(1);
});
