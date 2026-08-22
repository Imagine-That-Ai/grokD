#!/usr/bin/env node
// Broader robustness suite: create/list, messages, broadcast, routines, coding/exec.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HOST = "http://127.0.0.1:1337";
const PROXY = "http://127.0.0.1:8787";
const TOKEN = "fake-gateway-token";
const BOX = "/tmp/grokbot-hack/box-data/agents";
const STAMP = Date.now().toString(36);

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function api(method, body = {}) {
  const r = await fetch(`${HOST}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${r.status}: ${String(text).slice(0, 400)}`);
  return json;
}

function dbPath(agentId) {
  return path.join(BOX, agentId, "store.db");
}

function lastEntries(agentId, n = 12) {
  const db = dbPath(agentId);
  if (!fs.existsSync(db)) return [];
  const out = execFileSync("sqlite3", [
    db,
    `SELECT id || '\\t' || substr(entry,1,700) FROM transcript_entries ORDER BY rowid DESC LIMIT ${n};`,
  ], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function transcriptHas(agentId, needle) {
  return lastEntries(agentId, 30).some((line) => line.includes(needle));
}

async function waitFor(pred, { timeoutMs = 45000, everyMs = 700, label = "condition" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout waiting for ${label}`);
}

const { resolveTeammate } = require("./bridge-lib.js");

(async () => {
  const results = [];
  const pass = (name) => { results.push({ name, ok: true }); console.log(`PASS  ${name}`); };
  const fail = (name, err) => { results.push({ name, ok: false, err: String(err) }); console.log(`FAIL  ${name}: ${err}`); };

  let agents = await api("listAgents");
  const by = (q) => resolveTeammate(agents, q);
  let lol = by("lol");
  if (!lol) {
    const res = await api("createAgent", { name: "lol", description: "test agent lol", origin: "user" });
    lol = res.agent || res;
  }
  let grok = by('grok"D"') || by("Grok Bot D") || by("grok d") || by("Local D");
  if (!grok) {
    const res = await api("createAgent", { name: 'grok"D"', description: "test agent grok", origin: "user" });
    grok = res.agent || res;
  }
  let sally = by("sally");
  if (!sally) {
    const res = await api("createAgent", { name: "sally the seashell slinging slut", description: "test agent sally", origin: "user" });
    sally = res.agent || res;
  }
  let bench = by("Robust Bench");
  if (!bench) {
    const res = await api("createAgent", { name: "Robust Bench", description: "test agent bench", origin: "user" });
    bench = res.agent || res;
  }
  agents = await api("listAgents");
  assert(lol && grok && sally && bench, `missing core roster lol=${!!lol} grok=${!!grok} sally=${!!sally} bench=${!!bench}`);

  // 1. name resolution
  try {
    assert(by("lol")?.id === lol.id, "lol");
    assert(by("LOL")?.id === lol.id, "LOL");
    assert(by('grok"D"')?.id === grok.id || by("Local D")?.id === grok.id || by("Grok Bot D")?.id === grok.id, "grok name resolution");
    assert(by("does-not-exist-bot") == null, "unknown");
    pass("name-resolution");
  } catch (e) { fail("name-resolution", e); }

  // 2. createAgent
  let created = null;
  try {
    const name = `Suite ${STAMP}`;
    const res = await api("createAgent", { name, description: "robustness harness bot", origin: "user" });
    created = res.agent || res;
    assert(created && created.id && created.name === name, `bad create payload ${JSON.stringify(res).slice(0, 200)}`);
    agents = await api("listAgents");
    const found = resolveTeammate(agents, created.id);
    assert(found && found.name === name, "created agent not in listAgents");
    pass("create-agent");
  } catch (e) { fail("create-agent", e); }

  // 3. Host persist: sendPrompt must appear as a user line. Token-echo is covered by two-step on a quiet dest.
  const tokenP = `PROMPT-${STAMP}`;
  try {
    const dest = bench || grok;
    await api("sendPrompt", { agentId: dest.id, prompt: `Harness ping. Token ${tokenP}.`, awaitTurn: false });
    await waitFor(() => lastEntries(dest.id, 20).some((l) => l.includes(tokenP) && (l.includes('"role":"user"') || l.includes("Harness ping"))), {
      timeoutMs: 20000,
      label: `user line ${tokenP} on ${dest.name}`,
    });
    pass("send-prompt-lands");
  } catch (e) { fail("send-prompt-lands", e); }

  // 4. broadcastToAgents — always an idle warm dest (busy agents can ack scheduled:1 and then drop)
  const tokenB = `BCAST-${STAMP}`;
  try {
    const fresh = await api("listAgents");
    const dest = (Array.isArray(fresh) ? fresh : []).find((a) => a && a.id === (bench && bench.id) && !a.isRunning && !a.isComposingMessage)
      || (Array.isArray(fresh) ? fresh : []).find((a) => a && a.id === (grok && grok.id) && !a.isRunning && !a.isComposingMessage)
      || bench || grok;
    const sendB = async () => api("broadcastToAgents", { targets: [dest.id], message: `Broadcast token ${tokenB}` });
    const r = await sendB();
    assert((r.scheduled ?? 0) >= 1 || (r.total ?? 0) >= 1, `broadcast not scheduled: ${JSON.stringify(r)}`);
    try {
      await waitFor(() => transcriptHas(dest.id, tokenB), { timeoutMs: 20000, label: `broadcast ${tokenB} -> ${dest.name}` });
    } catch {
      const r2 = await sendB();
      assert((r2.scheduled ?? 0) >= 1 || (r2.total ?? 0) >= 1, `broadcast retry not scheduled: ${JSON.stringify(r2)}`);
      await waitFor(() => transcriptHas(dest.id, tokenB), { timeoutMs: 25000, label: `broadcast retry ${tokenB}` });
    }
    pass("broadcast-delivers");
  } catch (e) { fail("broadcast-delivers", e); }

  // 5. bot-to-bot inbound on a warm dest (reply is nice; delivery is the contract)
  const tokenM = `MSG-${STAMP}`;
  try {
    const dest = bench || grok;
    const before = lastEntries(dest.id, 8).join("\n");
    assert(!before.includes(tokenM), "token already existed");
    await api("sendPrompt", {
      agentId: dest.id,
      prompt: `[Bot-to-bot from sally]: Reply with exactly the token ${tokenM} and nothing else.`,
      awaitTurn: false,
    });
    await waitFor(() => {
      const lines = lastEntries(dest.id, 20);
      return lines.some((l) => l.includes(tokenM) && (l.includes('"role":"user"') || l.includes("[Bot-to-bot")));
    }, { timeoutMs: 25000, label: `inbound ${tokenM} on ${dest.name}` });
    pass("bot-to-bot-deliver");
  } catch (e) { fail("bot-to-bot-deliver", e); }

  // 6. natural-language tell
  const tokenT = `TELL-${STAMP}`;
  try {
    await api("sendPrompt", {
      agentId: sally.id,
      prompt: `tell lol to repeat the token ${tokenT} in her chat`,
      awaitTurn: false,
    });
    await waitFor(() => transcriptHas(lol.id, tokenT), { timeoutMs: 90000, label: `nl tell ${tokenT}` });
    pass("nl-tell-lol");
  } catch (e) { fail("nl-tell-lol", e); }

  // 7. routine create + poll fire -> transcript
  const tokenR = `ROUTINE-${STAMP}`;
  try {
    const dest = created || grok;
    const localId = `harness-${STAMP}`;
    const dir = path.join(BOX, dest.id, "automations", localId);
    fs.mkdirSync(dir, { recursive: true });
    const cfg = {
      name: `Pulse ${STAMP}`,
      prompt: `Say the exact token ${tokenR} in chat, then stop.`,
      schedule: "* * * * *",
      enabled: true,
      provenance: "harness",
      createdAt: Date.now() - 120000,
      lastRunAt: Date.now() - 120000,
    };
    fs.writeFileSync(path.join(dir, "automation.json"), JSON.stringify(cfg, null, 2));
    const poll = await fetch(`${PROXY}/sand/automation-events/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const pollText = await poll.text();
    assert(poll.ok, `poll ${poll.status} ${pollText.slice(0, 200)}`);
    await waitFor(() => transcriptHas(dest.id, tokenR) || transcriptHas(dest.id, `[Routine: Pulse ${STAMP}]`), {
      timeoutMs: 25000,
      label: `routine fire ${tokenR}`,
    });
    // disable so it does not keep firing
    cfg.enabled = false;
    fs.writeFileSync(path.join(dir, "automation.json"), JSON.stringify(cfg, null, 2));
    pass("routine-poll-fires-chat");
  } catch (e) { fail("routine-poll-fires-chat", e); }

  // 8. existing minute-joke routine has actually produced a joke (historical proof)
  try {
    const lines = lastEntries(lol.id, 80);
    const hasRoutineUser = lines.some((l) => l.includes("[Routine: Minute Jokes]"));
    const hasJoke = lines.some((l) => /send-message/.test(l) && /mugged|joke|why did|walks into|bartender/i.test(l));
    assert(hasRoutineUser, "no Minute Jokes user lines on lol");
    assert(hasJoke || lines.some((l) => l.includes("send-message") && l.includes("Why did")), "no joke send-message after routines");
    pass("routine-produced-joke");
  } catch (e) { fail("routine-produced-joke", e); }

  // 9. coding + shell via inference on Robust Bench (or created agent)
  const execDir = `/tmp/grokbot-hack/suite-exec-${STAMP}`;
  const tokenE = `EXEC-${STAMP}`;
  try {
    fs.mkdirSync(execDir, { recursive: true });
    const dest = bench || created || grok;
    await api("sendPrompt", {
      agentId: dest.id,
      prompt: [
        "You are in a local robustness harness. Do this now with tools, do not only promise it:",
        `1. Write a file at ${execDir}/hello.js containing exactly: console.log('${tokenE}');`,
        `2. Run: node ${execDir}/hello.js`,
        `3. Also write the stdout to ${execDir}/out.txt`,
        "4. Reply with the exact stdout token.",
      ].join("\n"),
      awaitTurn: false,
    });
    await waitFor(() => {
      try {
        const js = fs.existsSync(path.join(execDir, "hello.js"))
          && fs.readFileSync(path.join(execDir, "hello.js"), "utf8").includes(tokenE);
        const out = fs.existsSync(path.join(execDir, "out.txt"))
          && fs.readFileSync(path.join(execDir, "out.txt"), "utf8").includes(tokenE);
        return js && out;
      } catch { return false; }
    }, { timeoutMs: 120000, label: `hello.js + out.txt with ${tokenE}` });
    pass("coding-shell-exec");
  } catch (e) { fail("coding-shell-exec", e); }

  // 10. two-step: second prompt must produce an assistant line that repeats the token
  const tokenW = `FLOW-${STAMP}`;
  try {
    const dest = grok || bench || created;
    await api("sendPrompt", { agentId: dest.id, prompt: `Step 1 of a 2-step workflow. Remember token ${tokenW}. Reply 'acked'.`, awaitTurn: false });
    await waitFor(() => lastEntries(dest.id, 12).some((l) => l.includes("send-message") && /\backed\b/i.test(l)), {
      timeoutMs: 60000,
      label: `flow step1 ack ${tokenW}`,
    });
    await api("sendPrompt", { agentId: dest.id, prompt: `Step 2: repeat the exact token ${tokenW} in your reply.`, awaitTurn: false });
    await waitFor(() => lastEntries(dest.id, 16).some((l) => l.includes("send-message") && l.includes(tokenW)), {
      timeoutMs: 60000,
      label: `flow step2 ${tokenW}`,
    });
    pass("two-step-workflow-prompts");
  } catch (e) { fail("two-step-workflow-prompts", e); }

  // leave the roster clean
  if (created && created.id) {
    try { await api("deleteAgents", { ids: [created.id] }); } catch {}
  }

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
