#!/usr/bin/env node
// Fast, no-network unit tests for gateway-shim helpers.
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const {
  isIdle, resolveTargets, broadcastOk, distinctiveToken, hayHasMessage,
  agentDbPath, parseJson, waitUntilIdle, waitTranscripts, handleSpecial,
  AGENTS_ROOT, broadcastMessage,
} = require("./gateway-shim");

let n = 0;
const ok = (name) => { n++; console.log(`PASS  ${name}`); };

// isIdle
assert(isIdle(null) === true, "null idle");
assert(isIdle(undefined) === true, "missing idle");
assert(isIdle({ isRunning: false, isComposingMessage: false }) === true, "both false");
assert(isIdle({ isRunning: true, isComposingMessage: false }) === false, "running");
assert(isIdle({ isRunning: false, isComposingMessage: true }) === false, "composing");
assert(isIdle({ isRunning: true, isComposingMessage: true }) === false, "both busy");
ok("isIdle");

// resolveTargets
assert(JSON.stringify(resolveTargets("sendPrompt", { agentId: "aaa" })) === '["aaa"]', "sp id");
assert(resolveTargets("sendPrompt", {}).length === 0, "sp empty");
assert(resolveTargets("sendPrompt", null).length === 0, "sp null");
assert(JSON.stringify(resolveTargets("broadcastToAgents", { targets: ["a", "b"] })) === '["a","b"]', "bc ids");
assert(resolveTargets("broadcastToAgents", { targets: [] }).length === 0, "bc empty");
assert(resolveTargets("broadcastToAgents", {}).length === 0, "bc missing");
assert(JSON.stringify(resolveTargets("broadcastToAgents", { targets: ["a", "", null] })) === '["a"]', "bc filter");
assert(resolveTargets("listAgents", { agentId: "x" }).length === 0, "other");
ok("resolveTargets");

// distinctiveToken + hayHasMessage
assert(distinctiveToken("Broadcast token BCAST-abc12345") === "BCAST-abc12345", "stamped");
assert(distinctiveToken("hi").length === 0, "short");
assert(distinctiveToken("hello there this is long enough").length >= 8, "long phrase");
assert(hayHasMessage('{"text":"Broadcast token BCAST-abc12345"}', "Broadcast token BCAST-abc12345"), "full msg");
assert(hayHasMessage('user said BCAST-abc12345 later', "Broadcast token BCAST-abc12345"), "token only");
assert(!hayHasMessage("nothing here", "Broadcast token BCAST-abc12345"), "miss");
ok("token-match");

// path jail
const uuid = "9b916ddb-76be-4d38-a62d-abf785a0e49d";
const db = agentDbPath(uuid);
assert(db === path.join(AGENTS_ROOT, uuid, "store.db"), db);
assert(db.startsWith(path.resolve(AGENTS_ROOT) + path.sep), "under root");
assert(agentDbPath("") == null, "empty");
assert(agentDbPath("../etc/passwd") == null, "rel");
assert(agentDbPath("/etc/passwd") == null, "abs");
assert(agentDbPath(uuid + "/../../etc/passwd") == null, "escape");
assert(agentDbPath("not-a-uuid") == null, "not uuid");
ok("path-jail");

// parseJson + broadcastOk + broadcastMessage
assert(parseJson('{"a":1}').a === 1, "json");
assert(parseJson(Buffer.from('{"b":2}')).b === 2, "buf");
assert(parseJson("nope") == null, "bad");
assert(broadcastOk({ scheduled: 1 }), "sched");
assert(broadcastOk({ total: 2 }), "total");
assert(!broadcastOk({ scheduled: 0, total: 0 }), "zero");
assert(!broadcastOk({}), "empty obj");
assert(!broadcastOk(null), "null ok");
assert(broadcastMessage({ message: "m", prompt: "p" }) === "m", "msg first");
assert(broadcastMessage({ prompt: "p" }) === "p", "prompt fallback");
ok("parse-broadcast");

(async () => {
  // waitUntilIdle
  {
    let nCalls = 0;
    const st = await waitUntilIdle("x", async () => {
      nCalls++;
      return [{ id: "x", isRunning: nCalls < 3, isComposingMessage: false }];
    }, { timeoutMs: 2000, pollMs: 5 });
    assert(st === "idle", st);
    assert(nCalls >= 3, `calls ${nCalls}`);
  }
  {
    const st = await waitUntilIdle("x", async () => [{ id: "x", isRunning: true, isComposingMessage: false }], {
      timeoutMs: 40, pollMs: 8,
    });
    assert(st === "timeout", st);
  }
  {
    const st = await waitUntilIdle("missing", async () => [], { timeoutMs: 200, pollMs: 5 });
    assert(st === "idle", "missing is idle");
  }
  ok("waitUntilIdle");

  // waitTranscripts
  {
    const seen = new Set();
    const miss = await waitTranscripts(["a", "b"], "TOK-12345678", {
      timeoutMs: 80, pollMs: 5,
      has: (id) => { seen.add(id); return id === "a"; },
    });
    assert(JSON.stringify(miss) === '["b"]', JSON.stringify(miss));
    assert(seen.has("a") && seen.has("b"), "checked both");
  }
  {
    const miss = await waitTranscripts(["a"], "TOK-12345678", {
      timeoutMs: 200, pollMs: 5, has: () => true,
    });
    assert(miss.length === 0, "all delivered");
  }
  ok("waitTranscripts");

  // handleSpecial: sendPrompt waits then forwards original raw
  {
    const calls = [];
    const raw = JSON.stringify({ agentId: "aaa", prompt: "hello", awaitTurn: false });
    const body = JSON.parse(raw);
    const waits = [];
    const out = await handleSpecial("sendPrompt", raw, body, {
      post: async (method, b) => {
        calls.push({ method, body: b });
        return { status: 200, json: { accepted: true }, text: '{"accepted":true}' };
      },
      waitIdle: async (id) => { waits.push(id); },
      waitTx: async () => { throw new Error("sendPrompt should not poll transcript"); },
    });
    assert(out.json.accepted === true, "sp res");
    assert(waits.join() === "aaa", "sp wait");
    assert(calls.length === 1 && calls[0].method === "sendPrompt", JSON.stringify(calls));
    assert(calls[0].body === raw, "raw unchanged");
  }
  ok("handle-sendPrompt");

  // broadcast empty targets: forward as-is, no wait
  {
    const waits = [];
    const raw = JSON.stringify({ message: "hi" });
    await handleSpecial("broadcastToAgents", raw, JSON.parse(raw), {
      post: async (method, b) => ({ status: 200, json: { scheduled: 0 }, text: "{}", method, b }),
      waitIdle: async (id) => { waits.push(id); },
      waitTx: async () => ["should-not"],
    });
    assert(waits.length === 0, "no wait on empty");
  }
  ok("handle-broadcast-empty");

  // broadcast delivers first try: no retry
  {
    const methods = [];
    const raw = JSON.stringify({ targets: ["aaa"], message: "Broadcast token BCAST-zzzz1111" });
    await handleSpecial("broadcastToAgents", raw, JSON.parse(raw), {
      post: async (method, b) => {
        methods.push(method);
        return { status: 200, json: { scheduled: 1 }, text: '{"scheduled":1}', raw: b };
      },
      waitIdle: async () => {},
      waitTx: async () => [],
    });
    assert(methods.filter((m) => m === "broadcastToAgents").length === 1, methods.join());
  }
  ok("handle-broadcast-hit");

  // miss → retry once → then hit
  {
    const methods = [];
    const raw = JSON.stringify({ targets: ["aaa"], message: "Broadcast token BCAST-yyyy2222" });
    let round = 0;
    await handleSpecial("broadcastToAgents", raw, JSON.parse(raw), {
      post: async (method, b) => {
        methods.push({ method, same: b === raw });
        return { status: 200, json: { scheduled: 1 }, text: '{"scheduled":1}' };
      },
      waitIdle: async () => {},
      waitTx: async () => { round++; return round === 1 ? ["aaa"] : []; },
    });
    const bcs = methods.filter((m) => m.method === "broadcastToAgents");
    assert(bcs.length === 2, `retries ${bcs.length}`);
    assert(bcs.every((m) => m.same), "retry uses original body");
    assert(!methods.some((m) => m.method === "sendPrompt"), "no fallback");
  }
  ok("handle-broadcast-retry");

  // still missing → fallback sendPrompt per target
  {
    const calls = [];
    const raw = JSON.stringify({ targets: ["aaa", "bbb"], message: "Broadcast token BCAST-xxxx3333" });
    const body = JSON.parse(raw);
    await handleSpecial("broadcastToAgents", raw, body, {
      post: async (method, b) => {
        calls.push({ method, b });
        return { status: 200, json: { scheduled: 1, total: 2 }, text: '{"scheduled":1}' };
      },
      waitIdle: async () => {},
      waitTx: async (ids) => ids.slice(),
    });
    const falls = calls.filter((c) => c.method === "sendPrompt");
    assert(falls.length === 2, `fallback ${falls.length}`);
    assert(falls[0].b.agentId === "aaa" && falls[0].b.awaitTurn === false, JSON.stringify(falls[0].b));
    assert(falls[0].b.prompt === body.message, falls[0].b.prompt);
    assert(falls[1].b.agentId === "bbb", falls[1].b.agentId);
    assert(calls.filter((c) => c.method === "broadcastToAgents").length === 2, "one retry");
  }
  ok("handle-broadcast-fallback");

  // scheduled:0 → no retry / no fallback
  {
    const methods = [];
    const raw = JSON.stringify({ targets: ["aaa"], message: "Broadcast token BCAST-nope4444" });
    await handleSpecial("broadcastToAgents", raw, JSON.parse(raw), {
      post: async (method) => {
        methods.push(method);
        return { status: 200, json: { scheduled: 0 }, text: '{"scheduled":0}' };
      },
      waitIdle: async () => {},
      waitTx: async () => ["aaa"],
    });
    assert(methods.join() === "broadcastToAgents", methods.join());
  }
  ok("handle-broadcast-not-scheduled");

  console.log(`\n${n} unit groups passed`);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
