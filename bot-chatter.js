// Inter-bot chrome for the local box. The official app collapses agent-to-agent
// traffic into one "N messages with <Bot>" marker you click into; our local rail
// has no from-agent chrome on sendPrompt, so those turns land in the transcript
// as raw "[Bot-to-bot from NAME]:" user prompts and the bot's answers to them
// read like answers to you. This re-reads the exchange out of the box's SQLite
// transcripts, folds it back into one marker per run — wearing each bot's own
// mark and colour, not grey — and opens the pair's own view-only chat on click.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(os.homedir(), ".grok", "grokbot-d");
const STYLE_ID = "gd-bot-chatter-css";
const PICKER_ID = "gd-chatter-picker";
const THREAD_ID = "gd-chatter-thread";
const PAINTED = "data-gd-chatter";
const PREFIX_RE = /^\s*\[Bot-to-bot from ([^\]]+)\]:\s*([\s\S]*)$/;
const SQLITE = "/usr/bin/sqlite3";
const AGENT_MARK = "sand-agent-mark-source-"; // the app's own <symbol> per agent
const LOBE = path.join(ROOT, "assets", "lobe");
const WINDOW = 400; // entries per transcript — the mounted window never needs more

// Platinum Frost is in the seat palette but a near-white mark and near-white
// gradient text both vanish in light mode, so the bot marks use the saturated
// seven only.
const COLORS = [
  { key: "violet", hex: "#8b5cf6", lit: "#c4b5fd" },
  { key: "azure", hex: "#00c8ff", lit: "#7dd3fc" },
  { key: "flame", hex: "#ff1e56", lit: "#ff8a9c" },
  { key: "amber", hex: "#f97316", lit: "#fdba74" },
  { key: "mint", hex: "#10b981", lit: "#6ee7b7" },
  { key: "rose", hex: "#ec4899", lit: "#f9a8d4" },
  { key: "gold", hex: "#f59e0b", lit: "#fcd34d" },
];

const NAMED_COLORS = {
  purple: "violet", violet: "violet", blue: "azure", cyan: "azure",
  red: "flame", orange: "amber", green: "mint", pink: "rose", yellow: "gold",
};

const SHAPES = {
  blob: "M12 2.6c5 0 9.4 3.4 9.4 8.2 0 5.6-4 10.6-9.4 10.6S2.6 16.4 2.6 10.8C2.6 6 7 2.6 12 2.6z",
  droplet: "M12 2.2s7 7.3 7 11.6a7 7 0 11-14 0C5 9.5 12 2.2 12 2.2z",
  hex: "M12 2.4l8.2 4.8v9.6L12 21.6 3.8 16.8V7.2z",
  triangle: "M10.3 4.1a2 2 0 013.4 0l7 12.1a2 2 0 01-1.7 3H5a2 2 0 01-1.7-3z",
  spark: "M12 2.5c.9 4.6 4.4 8.1 9 9-4.6.9-8.1 4.4-9 9-.9-4.6-4.4-8.1-9-9 4.6-.9 8.1-4.4 9-9z",
};

const SHAPE_KEYS = Object.keys(SHAPES);

// The logo carries the vendor, so the label only has to carry the version.
const MODEL_MARKS = [
  { test: /grok[-\s]*composer[-\s]*([\d.]+)?/i, logo: "grok.svg", fill: "#F4F4F5",
    short: (m) => "Composer" + (m[1] ? " " + m[1] : "") },
  { test: /grok[-\s]*([\d.]+)/i, logo: "grok.svg", fill: "#F4F4F5", short: (m) => m[1] },
  { test: /gpt[-\s]*([\d.]+)/i, logo: "openai.svg", fill: "#10A37F", short: (m) => "GPT " + m[1] },
  { test: /claude[-\s]*(opus|sonnet|haiku|fable)[-\s]*([\d]+(?:[-.][\d]+)?)?/i, logo: "claude-color.svg",
    short: (m) => m[1][0].toUpperCase() + m[1].slice(1) + (m[2] ? " " + m[2].replace("-", ".") : "") },
  { test: /deepseek[^\w]*v?([\d.]+)?/i, logo: "deepseek-color.svg", short: (m) => "V" + (m[1] || "3") },
  { test: /(?:kimi|moonshot)[^\w]*k?([\d.]+)?/i, logo: "moonshot.svg", fill: "#F4F4F5",
    short: (m) => "K" + (m[1] || "2") },
  { test: /gemini[-\s]*([\d.]+)?/i, logo: "gemini-color.svg", short: (m) => "Gemini" + (m[1] ? " " + m[1] : "") },
  { test: /qwen[-\s]*([\d.]+)?/i, logo: "qwen-color.svg", short: (m) => "Qwen" + (m[1] ? " " + m[1] : "") },
  { test: /mistral/i, logo: "mistral-color.svg", short: () => "Mistral" },
];

/* ------------------------------------------------------------------ pure */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseChatter(text) {
  const m = PREFIX_RE.exec(String(text || ""));
  if (!m) return null;
  return { from: m[1].trim(), body: m[2].trim() };
}

// Names travel with whatever the sending agent was called mid-turn, so "sally"
// and "sally the seashell slinging slut" are the same teammate.
function sameBot(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length < y.length ? x : y;
  const long = x.length < y.length ? y : x;
  return short.length >= 3 && long.startsWith(short);
}

function hashIndex(key, mod) {
  let h = 2166136261;
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % mod;
}

function markFor(name, profile) {
  const shape = (profile && SHAPES[profile.avatarShape]) ? profile.avatarShape
    : SHAPE_KEYS[hashIndex("s:" + name, SHAPE_KEYS.length)];
  const named = profile && NAMED_COLORS[String(profile.avatarColor || "").toLowerCase()];
  const color = named
    ? COLORS.find((c) => c.key === named)
    : COLORS[hashIndex("c:" + name, COLORS.length)];
  return { shape, hex: color.hex, lit: color.lit, path: SHAPES[shape] };
}

// The app paints a mark to sit on its own light disc, so its dark-mode colour
// is the deep half of the pair. Text needs the opposite: swap the halves so the
// name is legible on the transcript in both schemes.
function readableTint(raw) {
  const hit = /^light-dark\(\s*([^,]+),\s*(.+)\)\s*$/i.exec(String(raw || "").trim());
  if (!hit) return String(raw || "");
  return `light-dark(${hit[2].trim()}, ${hit[1].trim()})`;
}

function gradientOf(marks) {
  const stops = marks.length === 1
    ? [marks[0].lit, marks[0].hex]
    : marks.map((m) => m.hex);
  return `linear-gradient(96deg, ${stops.join(", ")})`;
}

function modelBadge(modelId) {
  const id = String(modelId || "").trim();
  for (const mark of MODEL_MARKS) {
    const hit = mark.test.exec(id);
    if (hit) return { logo: mark.logo, fill: mark.fill || null, short: mark.short(hit), title: id };
  }
  return { logo: "xai.svg", fill: "#F4F4F5", short: id.split("/").pop() || "model", title: id };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// entries: self transcript in seq order, {id, kind, role, content, ts}.
// outbox:  what this agent sent to other bots, {to, ts, text}, from their side.
// Returns hidden runs (chatter rows we replace with one marker) and anchor runs
// (sends with no inbound rows of their own, marked under the row they follow).
function buildRuns(entries, outbox) {
  const list = (entries || []).filter((e) => e && e.id);
  const outs = [...(outbox || [])].sort((a, b) => a.ts - b.ts);
  // undefined means "assistant turn": it inherits whatever the user turn it
  // answers was classified as, so it hides with that run. null means the row
  // stands on its own. Only the rows that carry the prefix are real inter-bot
  // messages — an answer to one is the turn's output, not a message back.
  const chatterAt = list.map((e) => {
    if (e.kind === "event") return null;
    if (e.role === "user" || e.kind === "message") {
      const hit = parseChatter(e.content);
      return hit ? hit.from : null;
    }
    return undefined;
  });
  const direct = chatterAt.map((v) => !!v);
  for (let i = 0; i < chatterAt.length; i++) {
    if (chatterAt[i] !== undefined) continue;
    chatterAt[i] = i > 0 ? chatterAt[i - 1] : null;
  }

  // A send belongs under the last row that was already on screen when it went
  // out. Anything older than the whole window pairs with messages we are not
  // showing, so it is left out rather than pinned to the top row.
  const outsAt = list.map(() => []);
  for (const o of outs) {
    let at = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].ts != null && list[i].ts <= o.ts) at = i; else break;
    }
    if (at >= 0) outsAt[at].push(o);
  }

  const runs = [];
  const newRun = (kind, headKey) => {
    const run = { kind, headKey, hide: [], partners: [], inCount: 0, outCount: 0 };
    runs.push(run);
    return run;
  };
  const addPartner = (run, name) => {
    if (!name) return;
    if (!run.partners.some((p) => sameBot(p, name))) run.partners.push(name);
    else if (name.length > run.partners.find((p) => sameBot(p, name)).length) {
      run.partners = run.partners.map((p) => (sameBot(p, name) ? name : p));
    }
  };

  const addOuts = (run, sent) => {
    for (const o of sent) { run.outCount++; addPartner(run, o.to); }
    return run;
  };

  let open = null;
  let pending = [];
  for (let i = 0; i < list.length; i++) {
    const key = list[i].id;
    const partner = chatterAt[i];
    if (partner) {
      if (!open) {
        open = addOuts(newRun("hidden", key), pending);
        pending = [];
      }
      open.hide.push(key);
      if (direct[i]) open.inCount++;
      addPartner(open, partner);
    } else if (list[i].kind !== "event") {
      open = null;
    }
    if (!outsAt[i].length) continue;
    if (open) { addOuts(open, outsAt[i]); continue; }
    if (chatterAt[i + 1]) { pending = pending.concat(outsAt[i]); continue; }
    addOuts(newRun("anchor", key), outsAt[i]);
  }
  if (pending.length && list.length) {
    addOuts(newRun("anchor", list[list.length - 1].id), pending);
  }

  const byKey = new Map();    // row key -> the run that row belongs to
  const afterKey = new Map(); // row key -> a run drawn under that row
  for (const run of runs) {
    if (run.kind === "anchor") { afterKey.set(run.headKey, run); continue; }
    byKey.set(run.headKey, run);
    for (const k of run.hide.slice(1)) byKey.set(k, { hidden: true, run });
  }
  return { runs, byKey, afterKey };
}

function runLabel(run) {
  const n = run.inCount + run.outCount;
  const many = run.partners.length > 1;
  return {
    count: run.inCount ? String(n) : "",
    lead: run.inCount ? (n === 1 ? "message with" : "messages with") : "Messaged",
    name: many ? plural(run.partners.length, "Bot") : (run.partners[0] || "a Bot"),
  };
}

// The pair's own chat: what they sent us lives in our transcript, what we sent
// them only exists in theirs.
function mergeThread(selfName, partnerName, selfEntries, partnerEntries) {
  const pick = (entries, from, dir) => (entries || []).flatMap((e) => {
    const hit = parseChatter(e && e.content);
    if (!hit || !sameBot(hit.from, from)) return [];
    return [{ dir, text: hit.body, ts: e.ts || 0 }];
  });
  return [
    ...pick(selfEntries, partnerName, "in"),
    ...pick(partnerEntries, selfName, "out"),
  ].sort((a, b) => a.ts - b.ts);
}

function clockTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

/* ------------------------------------------------------------------ box */

function log(err) {
  try { fs.appendFileSync("/tmp/grokbot-renderer.log", "[bot-chatter] " + err + "\n"); } catch (_) {}
}

function agentsDir() {
  try { return require(path.join(ROOT, "paths.js")).agentsDir(); }
  catch { return path.join(ROOT, "hack", "box-data", "agents"); }
}

// A read-only handle cannot create the -shm a WAL database needs, and the box
// leaves that file behind only while an agent is warm. Plain open, SELECT only.
function sql(db, query) {
  const opts = { encoding: "utf8", timeout: 6000, maxBuffer: 32 * 1024 * 1024 };
  try { return execFileSync(SQLITE, ["-readonly", "-noheader", db, query], opts); }
  catch { return execFileSync(SQLITE, ["-noheader", db, query], opts); }
}

function rowsOf(db, query) {
  const out = [];
  for (const line of sql(db, query).split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (_) {}
  }
  return out;
}

function normalize(entry) {
  const msg = entry.message && entry.message.content;
  return {
    id: entry.id,
    kind: entry.kind,
    role: entry.role || (entry.kind === "send-message" ? "assistant" : ""),
    content: entry.kind === "send-message" ? String(msg || "") : String(entry.content || ""),
    ts: Number(entry.timestampMs || 0),
  };
}

let modelCache = { at: 0, id: "" };
function boxModel() {
  if (Date.now() - modelCache.at < 5000) return modelCache.id;
  let id = "";
  try { id = require(path.join(ROOT, "model-lib.js")).resolveConfig().model || ""; }
  catch (e) { log(e); }
  modelCache = { at: Date.now(), id };
  return id;
}

// Gradient ids inside a logo would collide once the same mark is drawn twice,
// so they are namespaced per file — identical copies resolve to one definition.
const logoCache = new Map();
function logoSvg(file, size, fill) {
  const key = file + ":" + size + ":" + (fill || "");
  if (logoCache.has(key)) return logoCache.get(key);
  let raw = "";
  try { raw = fs.readFileSync(path.join(LOBE, file), "utf8"); } catch (e) { log(e); }
  if (raw) {
    const tag = "gdl-" + file.replace(/\W+/g, "-") + "-";
    raw = raw.replace(/\sid="([^"]+)"/g, (_, name) => ' id="' + tag + name + '"')
      .replace(/url\(#([^)]+)\)/g, (_, name) => "url(#" + tag + name + ")")
      .replace(/\s(width|height)="1em"/g, (_, dim) => " " + dim + '="' + size + '"');
    if (fill) raw = raw.replace(/fill="currentColor"/g, 'fill="' + fill + '"');
  }
  logoCache.set(key, raw);
  return raw;
}

let agentCache = { at: 0, list: [] };
function listAgents() {
  if (Date.now() - agentCache.at < 5000) return agentCache.list;
  const dir = agentsDir();
  const list = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { names = []; }
  for (const id of names) {
    const db = path.join(dir, id, "store.db");
    let profile;
    try { profile = JSON.parse(fs.readFileSync(path.join(dir, id, "profile.json"), "utf8")); }
    catch { continue; }
    if (!profile || !profile.name || !fs.existsSync(db)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(db).mtimeMs; } catch (_) {}
    list.push({ id, name: String(profile.name), profile, db, mtime });
  }
  agentCache = { at: Date.now(), list };
  return list;
}

function agentNamed(name) {
  const hits = listAgents().filter((a) => sameBot(a.name, name));
  if (!hits.length) return null;
  return hits.sort((a, b) => b.mtime - a.mtime)[0];
}

const txCache = new Map();
function transcript(agent) {
  if (!agent) return [];
  let mtime = 0;
  try { mtime = fs.statSync(agent.db).mtimeMs; } catch { return []; }
  const hit = txCache.get(agent.db);
  if (hit && hit.mtime === mtime) return hit.rows;
  let rows = [];
  try {
    rows = rowsOf(agent.db, `select entry from (select entry, seq from transcript_entries
      order by seq desc limit ${WINDOW}) order by seq`).map(normalize);
  } catch (e) { log(e); }
  txCache.set(agent.db, { mtime, rows });
  return rows;
}

function chatterOf(agent) {
  if (!agent) return [];
  const rows = transcript(agent);
  const hit = txCache.get(agent.db);
  if (hit && hit.chatter && hit.rows === rows) return hit.chatter;
  const chatter = rows.filter((e) => PREFIX_RE.test(e.content));
  if (hit) hit.chatter = chatter;
  return chatter;
}

// What this agent sent out only shows up in the recipients' transcripts.
function outboxFor(self) {
  const out = [];
  for (const other of listAgents()) {
    if (!self || other.id === self.id) continue;
    for (const e of chatterOf(other)) {
      const hit = parseChatter(e.content);
      if (hit && sameBot(hit.from, self.name)) out.push({ to: other.name, ts: e.ts, text: hit.body });
    }
  }
  return out;
}

/* ------------------------------------------------------------------- dom */

function headerName() {
  const head = document.querySelector("header");
  if (!head) return "";
  return String(head.innerText || "").split("\n")[0].trim();
}

function domRows() {
  return [...document.querySelectorAll(".sand-transcript-row")].filter((r) => r.dataset.rowKey);
}

function roleOf(row) {
  if (row.dataset.role) return row.dataset.role;
  const inner = row.querySelector("[data-role]");
  return (inner && inner.dataset.role) || "assistant";
}

// Row keys repeat across agents, so a name hint alone can pick the wrong box.
// Confirm the guess against the mounted rows before trusting it.
function scoreAgent(agent, rows) {
  const byId = new Map(transcript(agent).map((e) => [e.id, e]));
  let score = 0;
  for (const row of rows) {
    const entry = byId.get(row.dataset.rowKey);
    if (!entry) continue;
    const text = String(row.innerText || "").replace(/\s+/g, " ").trim();
    const want = entry.content.replace(/\s+/g, " ").trim().slice(0, 24);
    score += want && text.includes(want) ? 2 : 1;
  }
  return score;
}

let selfCache = { sig: "", agent: null };
function resolveSelf(rows) {
  if (!rows.length) return null;
  const sig = headerName() + "|" + rows.map((r) => r.dataset.rowKey).join(",");
  if (selfCache.sig === sig) return selfCache.agent;
  const hinted = agentNamed(headerName());
  let best = null;
  let bestScore = 0;
  const pool = hinted ? [hinted, ...listAgents().filter((a) => a.id !== hinted.id)] : listAgents();
  for (const agent of pool) {
    const score = scoreAgent(agent, rows);
    if (score > bestScore) { best = agent; bestScore = score; }
    if (agent === hinted && score >= rows.length * 2) break;
  }
  selfCache = { sig, agent: bestScore >= rows.length ? best : null };
  return selfCache.agent;
}

// No box transcript (a Cursor seat, or a brand-new agent): group what is
// mounted so the raw handoff text still never reaches the reader.
function entriesFromDom(rows) {
  return rows.map((row, i) => ({
    id: row.dataset.rowKey,
    kind: "message",
    role: roleOf(row),
    content: String(row.innerText || ""),
    ts: i,
  }));
}

function ensureCss() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .gd-chatter-line { display:flex; width:100%; align-items:center; justify-content:center; padding:3px 0 5px; }
    .gd-chatter-mark { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }
    .gd-chatter-chip {
      display:inline-flex; align-items:center; gap:6px; padding:4px 12px 4px 9px;
      border-radius:999px; border:1px solid transparent; background:transparent; cursor:pointer;
      font:700 11.5px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      color:var(--gdg-text-dim, rgba(255,255,255,0.56));
      transition:background .16s ease, border-color .16s ease, transform .16s ease;
    }
    .gd-chatter-chip:hover, .gd-chatter-chip[aria-expanded="true"] {
      background:color-mix(in srgb, var(--gd-chatter-tint) 14%, transparent);
      border-color:color-mix(in srgb, var(--gd-chatter-tint) 46%, transparent);
      transform:translateY(-0.5px);
    }
    .gd-chatter-chip:focus-visible { outline:2px solid var(--gd-chatter-tint); outline-offset:2px; }
    .gd-chatter-swap { display:inline-flex; color:var(--gd-chatter-tint); opacity:.9; }
    .gd-chatter-tinted {
      font-weight:850; background:var(--gd-chatter-grad); -webkit-background-clip:text;
      background-clip:text; color:transparent;
    }
    .gd-chatter-marks { display:inline-flex; align-items:center; }
    .gd-chatter-marks > * { margin-left:-4px; }
    .gd-chatter-marks > *:first-child { margin-left:0; }
    .gd-chatter-marks > svg { width:13px; height:13px; }

    .gd-chatter-model {
      display:inline-flex; align-items:center; gap:3px; margin-left:3px; padding:1px 6px 1px 4px;
      border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.2px;
      background:color-mix(in srgb, var(--gd-chatter-tint) 12%, transparent);
      border:1px solid color-mix(in srgb, var(--gd-chatter-tint) 26%, transparent);
      color:var(--gdg-text-dim, rgba(255,255,255,0.62));
    }
    .gd-chatter-model svg { width:13px; height:13px; flex:0 0 auto; }
    .gd-chatter-chip .gd-chatter-tinted { max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gd-chatter-head-model { margin-left:auto; --gd-chatter-tint: var(--gdg-candy, #ff3448); }
    .gd-chatter-head-model .gd-chatter-model svg { width:12px; height:12px; }

    .gd-chatter-pop {
      position:fixed; z-index:1000004; min-width:184px; padding:6px; border-radius:16px;
      background:var(--gdg-shell, rgba(18,18,26,0.94)); border:1px solid var(--gdg-border, rgba(255,255,255,0.16));
      box-shadow:var(--gdg-lift, 0 24px 60px rgba(0,0,0,0.7)), var(--gdg-bevel, none);
      backdrop-filter:var(--gdg-blur, blur(30px)); -webkit-backdrop-filter:var(--gdg-blur, blur(30px));
    }
    .gd-chatter-pop-row {
      display:flex; align-items:center; gap:9px; width:100%; padding:7px 10px; border:0; border-radius:11px;
      background:transparent; cursor:pointer; text-align:left; color:var(--gdg-text, #fff);
      font:700 12px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    .gd-chatter-pop-row:hover { background:color-mix(in srgb, var(--gd-chatter-tint) 20%, transparent); }
    .gd-chatter-pop-row .gd-chatter-model { margin-left:auto; }
    .gd-chatter-pop-row > svg { width:16px; height:16px; flex:0 0 16px; }

    .gd-chatter-scrim {
      position:fixed; inset:0; z-index:1000005; display:flex; align-items:center; justify-content:center;
      padding:44px 24px; background:rgba(4,4,10,0.52);
    }
    .gd-chatter-panel {
      display:flex; flex-direction:column; width:min(620px, 100%); max-height:100%;
      border-radius:22px; overflow:hidden; color:var(--gdg-text, #fff);
      background:var(--gdg-shell, rgba(18,18,26,0.96)); border:1px solid var(--gdg-border, rgba(255,255,255,0.16));
      box-shadow:var(--gdg-lift, 0 30px 80px rgba(0,0,0,0.8)), var(--gdg-bevel, none);
      backdrop-filter:var(--gdg-blur, blur(34px)); -webkit-backdrop-filter:var(--gdg-blur, blur(34px));
      font:400 13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    .gd-chatter-head {
      display:flex; align-items:center; gap:8px; padding:13px 14px;
      border-bottom:1px solid var(--gdg-border, rgba(255,255,255,0.12));
    }
    .gd-chatter-head > svg { width:17px; height:17px; }
    .gd-chatter-who-head { font-weight:800; font-size:12.5px; }
    .gd-chatter-x {
      border:0; background:transparent; cursor:pointer; padding:4px 7px; border-radius:9px;
      color:var(--gdg-text-dim, rgba(255,255,255,0.56)); font-size:15px; line-height:1;
    }
    .gd-chatter-x:hover { background:rgba(127,127,140,0.18); color:var(--gdg-text, #fff); }
    .gd-chatter-log { overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:13px; }
    .gd-chatter-msg { display:flex; gap:9px; align-items:flex-start; }
    .gd-chatter-msg > svg, .gd-chatter-msg > .gd-chatter-mark { margin-top:3px; }
    .gd-chatter-msg--cont { margin-top:-8px; }
    .gd-chatter-gutter { width:15px; flex:0 0 15px; }
    .gd-chatter-msg > svg { width:15px; height:15px; flex:0 0 15px; }
    .gd-chatter-who { display:block; font-size:10.5px; font-weight:800; margin-bottom:3px; letter-spacing:.2px; }
    .gd-chatter-bubble {
      padding:9px 12px; border-radius:14px; white-space:pre-wrap; word-break:break-word;
      background:color-mix(in srgb, var(--gd-chatter-tint) 13%, transparent);
      border:1px solid color-mix(in srgb, var(--gd-chatter-tint) 32%, transparent);
    }
    .gd-chatter-when { display:block; margin-top:4px; font-size:10px; color:var(--gdg-text-dim, rgba(255,255,255,0.5)); }
    .gd-chatter-empty { padding:26px 8px; text-align:center; color:var(--gdg-text-dim, rgba(255,255,255,0.5)); }
    .gd-chatter-foot {
      display:flex; align-items:center; gap:10px; padding:11px 14px;
      border-top:1px solid var(--gdg-border, rgba(255,255,255,0.12));
      font-size:11.5px; color:var(--gdg-text-dim, rgba(255,255,255,0.55));
    }
    .gd-chatter-close {
      margin-left:auto; padding:6px 14px; border-radius:999px; cursor:pointer;
      border:1px solid var(--gdg-border, rgba(255,255,255,0.18));
      background:var(--gdg-chip, rgba(255,255,255,0.08)); color:var(--gdg-text, #fff);
      font:700 11.5px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    .gd-chatter-close:hover { border-color:color-mix(in srgb, var(--gdg-candy, #ff3448) 60%, transparent); }
  `;
  (document.head || document.documentElement).appendChild(s);
}

// Cloning needs a real node, so the mark goes in as a placeholder that
// fillMarks() populates once the surrounding html is in the document.
function markSvg(mark, size) {
  const px = size || 13;
  if (mark.mount) {
    return `<span class="gd-chatter-mark" data-agent="${esc(mark.mount)}" ` +
      `style="width:${px}px;height:${px}px"></span>`;
  }
  return shapeSvg(mark, px);
}

function fillMarks(root) {
  for (const slot of root.querySelectorAll(".gd-chatter-mark[data-agent]")) {
    const mount = markMount(slot.dataset.agent);
    slot.textContent = "";
    if (!mount) continue;
    const copy = mount.cloneNode(true);
    copy.style.width = slot.style.width;
    copy.style.height = slot.style.height;
    copy.style.flex = "0 0 auto";
    copy.removeAttribute("aria-label");
    slot.appendChild(copy);
  }
}

function shapeSvg(mark, size) {
  const px = size || 13;
  const id = "gdm" + hashIndex(mark.shape + mark.hex, 99999);
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true">` +
    `<defs><radialGradient id="${id}" cx="34%" cy="26%" r="86%">` +
    `<stop offset="0" stop-color="${mark.lit}"/><stop offset="1" stop-color="${mark.hex}"/>` +
    `</radialGradient></defs>` +
    `<path d="${mark.path}" fill="url(#${id})"/></svg>`;
}

const SWAP_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 9h15l-3.4-3.4M20 15H5l3.4 3.4"/></svg>`;

// Every bot's mark is already on screen in the bot list. The shape lives in a
// shared symbol but the colour does not: the parts paint with `fill: var(--fg)`
// and each mount sets --fg itself, so a bare <use> comes out black. Clone the
// whole mount instead — exact shape, exact colour, and it follows any avatar
// the user picks later. The hashed shape below is for bots this window never
// drew (a deleted teammate, or one scrolled out of a long list).
function markMount(agentId) {
  if (!agentId || typeof document === "undefined") return null;
  const use = document.querySelector(`use[href="#${AGENT_MARK}${agentId}"]`);
  const mount = use && use.closest(".sand-grok-bot-mark");
  return mount || null;
}

function appMark(agentId) {
  const mount = markMount(agentId);
  if (!mount) return null;
  // --fg is usually a light-dark() pair: hand the raw value to CSS so our text
  // follows the theme, and keep the resolved paint for anything that needs a
  // plain colour.
  const raw = mount.style.getPropertyValue("--fg").trim()
    || getComputedStyle(mount).getPropertyValue("--fg").trim();
  let solid = "";
  const part = mount.querySelector('[style*="var(--fg)"]');
  if (part) solid = getComputedStyle(part).fill;
  const tint = readableTint(raw || solid) || COLORS[0].hex;
  return { mount: agentId, hex: tint, lit: tint };
}

function markOf(name, agent) {
  const real = appMark(agent && agent.id);
  const fallback = markFor(name, agent && agent.profile);
  return Object.assign({ name: (agent && agent.name) || name, agent }, fallback, real || {});
}

function marksFor(run) {
  return run.partners.map((name) => markOf(name, agentNamed(name)));
}

function badgeHtml(size) {
  const badge = modelBadge(boxModel());
  if (!badge.title) return "";
  return `<span class="gd-chatter-model" title="${esc(badge.title)}">` +
    logoSvg(badge.logo, size || 11, badge.fill) +
    `<span>${esc(badge.short)}</span></span>`;
}

function chipFor(run) {
  const marks = marksFor(run);
  const label = runLabel(run);
  if (marks.length === 1 && marks[0].name) label.name = marks[0].name;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "gd-chatter-chip";
  chip.style.setProperty("--gd-chatter-tint", marks[0] ? marks[0].hex : COLORS[0].hex);
  chip.style.setProperty("--gd-chatter-grad", gradientOf(marks.length ? marks : [markFor("bot")]));
  chip.title = marks.map((m) => m.name).join(" · ");
  chip.innerHTML =
    `<span class="gd-chatter-swap">${SWAP_SVG}</span>` +
    (label.count ? `<span class="gd-chatter-tinted">${esc(label.count)}</span>` : "") +
    `<span>${esc(label.lead)}</span>` +
    `<span class="gd-chatter-marks">${marks.map((m) => markSvg(m)).join("")}</span>` +
    `<span class="gd-chatter-tinted">${esc(label.name)}</span>` +
    badgeHtml(13);
  fillMarks(chip);
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (marks.length === 1) openThread(marks[0]);
    else openPicker(chip, marks);
  });
  return chip;
}

function lineFor(run) {
  const line = document.createElement("div");
  line.className = "gd-chatter-line";
  line.setAttribute(PAINTED, "1");
  line.appendChild(chipFor(run));
  return line;
}

function unpaint(row) {
  const line = row.querySelector(":scope > .gd-chatter-line");
  if (line) line.remove();
  const content = row.querySelector(":scope > .sand-row-content");
  if (content && content.dataset.gdChatterHid) {
    content.style.display = "";
    delete content.dataset.gdChatterHid;
  }
  if (row.dataset.gdChatterHidden) {
    row.style.display = "";
    delete row.dataset.gdChatterHidden;
  }
  row.removeAttribute(PAINTED);
}

function paintRow(row, state) {
  const key = row.dataset.rowKey;
  if (!state) {
    if (row.hasAttribute(PAINTED)) unpaint(row);
    return;
  }
  // The app's marks come and go with the sidebar, so whether we could borrow
  // them is part of what a painted row is — otherwise a chip keeps a mark that
  // no longer resolves.
  const real = state.run.partners.map((n) => {
    const agent = agentNamed(n);
    return agent && document.getElementById(AGENT_MARK + agent.id) ? "1" : "0";
  }).join("");
  const stamp = `${state.kind}:${key}:${state.run.inCount}/${state.run.outCount}:${real}`;
  if (row.getAttribute(PAINTED) === stamp) return;
  unpaint(row);
  row.setAttribute(PAINTED, stamp);
  if (state.kind === "hidden") {
    row.dataset.gdChatterHidden = "1";
    row.style.display = "none";
    return;
  }
  if (state.kind === "head") {
    const content = row.querySelector(":scope > .sand-row-content");
    if (content) {
      content.dataset.gdChatterHid = "1";
      content.style.display = "none";
    }
  }
  row.appendChild(lineFor(state.run));
}

// Hiding a row changes what the virtual transcript measures, which re-renders
// rows, which would call us straight back: paint has to be deaf to itself or
// the renderer spins on ResizeObserver notifications.
function paint() {
  const rows = domRows();
  if (!rows.length) return;
  ensureCss();
  const self = resolveSelf(rows);
  const entries = self ? transcript(self) : entriesFromDom(rows);
  const outbox = self ? outboxFor(self) : [];
  const { byKey, afterKey } = buildRuns(entries, outbox);
  if (observer) { observer.disconnect(); observer.takeRecords(); }
  try { applyRuns(rows, byKey, afterKey); }
  finally { if (observer) observer.observe(document.body, OBSERVE); }
}

function applyRuns(rows, byKey, afterKey) {
  for (const row of rows) {
    const key = row.dataset.rowKey;
    const after = afterKey.get(key);
    const hit = byKey.get(key);
    if (hit && hit.hidden) paintRow(row, { kind: "hidden", run: hit.run });
    else if (hit) paintRow(row, { kind: "head", run: hit });
    else if (after) paintRow(row, { kind: "anchor", run: after });
    else paintRow(row, null);
  }
}

/* ---------------------------------------------------------------- click-in */

function closePicker() {
  const pop = document.getElementById(PICKER_ID);
  if (!pop) return;
  if (pop._gdDismiss) document.removeEventListener("click", pop._gdDismiss, true);
  if (pop._gdAnchor) pop._gdAnchor.setAttribute("aria-expanded", "false");
  pop.remove();
}

function openPicker(anchor, marks) {
  closePicker();
  const pop = document.createElement("div");
  pop.id = PICKER_ID;
  pop.className = "gd-chatter-pop";
  pop._gdAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  for (const mark of marks) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "gd-chatter-pop-row";
    row.style.setProperty("--gd-chatter-tint", mark.hex);
    row.innerHTML = markSvg(mark, 16) + `<span>${esc(mark.name)}</span>` + badgeHtml(11);
    fillMarks(row);
    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
      openThread(mark);
    });
    pop.appendChild(row);
  }
  document.body.appendChild(pop);

  const box = anchor.getBoundingClientRect();
  const width = pop.offsetWidth || 184;
  const height = pop.offsetHeight || 120;
  let top = box.bottom + 6;
  if (top + height > window.innerHeight - 12) top = Math.max(12, box.top - height - 6);
  let left = box.left + box.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  pop.style.top = Math.round(top) + "px";
  pop.style.left = Math.round(left) + "px";

  const dismiss = (e) => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    closePicker();
  };
  pop._gdDismiss = dismiss;
  setTimeout(() => document.addEventListener("click", dismiss, true), 0);
}

function closeThread() {
  const scrim = document.getElementById(THREAD_ID);
  if (!scrim) return;
  if (scrim._gdKeys) document.removeEventListener("keydown", scrim._gdKeys, true);
  scrim.remove();
}

function openThread(partnerMark) {
  closePicker();
  closeThread();
  ensureCss();
  const self = resolveSelf(domRows());
  const selfName = (self && self.name) || headerName() || "This Bot";
  const selfMark = markOf(selfName, self);
  const partner = partnerMark.agent || agentNamed(partnerMark.name);
  const messages = mergeThread(
    selfName, partnerMark.name,
    self ? chatterOf(self) : [],
    partner ? chatterOf(partner) : []
  );

  const scrim = document.createElement("div");
  scrim.id = THREAD_ID;
  scrim.className = "gd-chatter-scrim";
  const panel = document.createElement("section");
  panel.className = "gd-chatter-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${selfName} and ${partnerMark.name}`);

  panel.innerHTML = `
    <header class="gd-chatter-head">
      ${markSvg(selfMark, 17)}
      <span class="gd-chatter-who-head" style="color:${selfMark.hex}">${esc(selfName)}</span>
      <span class="gd-chatter-swap" style="--gd-chatter-tint:${partnerMark.hex}">${SWAP_SVG}</span>
      ${markSvg(partnerMark, 17)}
      <span class="gd-chatter-who-head" style="color:${partnerMark.hex}">${esc(partnerMark.name)}</span>
      <span class="gd-chatter-head-model">${badgeHtml(12)}</span>
      <button type="button" class="gd-chatter-x" aria-label="Close">✕</button>
    </header>
    <div class="gd-chatter-log"></div>
    <footer class="gd-chatter-foot">
      <span>🔒 This chat is view-only</span>
      <button type="button" class="gd-chatter-close">Close Chat</button>
    </footer>`;

  fillMarks(panel);
  const log = panel.querySelector(".gd-chatter-log");
  if (!messages.length) {
    log.innerHTML = `<p class="gd-chatter-empty">No messages between these two on this box yet.</p>`;
  }
  let last = null;
  for (const msg of messages) {
    const mark = msg.dir === "out" ? selfMark : partnerMark;
    const who = msg.dir === "out" ? selfName : partnerMark.name;
    const runOn = msg.dir === last; // same bot again: mark and name once per run
    last = msg.dir;
    const row = document.createElement("div");
    row.className = "gd-chatter-msg" + (runOn ? " gd-chatter-msg--cont" : "");
    row.style.setProperty("--gd-chatter-tint", mark.hex);
    row.innerHTML =
      (runOn ? `<span class="gd-chatter-gutter"></span>` : markSvg(mark, 15)) +
      `<div>${runOn ? "" : `<span class="gd-chatter-who" style="color:${mark.hex}">${esc(who)}</span>`}` +
      `<div class="gd-chatter-bubble">${esc(msg.text)}</div>` +
      `<span class="gd-chatter-when">${esc(clockTime(msg.ts))}</span></div>`;
    fillMarks(row);
    log.appendChild(row);
  }

  scrim.appendChild(panel);
  document.body.appendChild(scrim);
  log.scrollTop = log.scrollHeight;

  panel.querySelector(".gd-chatter-x").addEventListener("click", closeThread);
  panel.querySelector(".gd-chatter-close").addEventListener("click", closeThread);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeThread(); });
  const keys = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeThread(); } };
  scrim._gdKeys = keys;
  document.addEventListener("keydown", keys, true);
}

// Marker chrome only appears when real inter-bot traffic is on screen, which
// makes it awkward to eyeball. `node command-client.js`-style callers can open
// either surface on demand against the bots this chat has actually talked to.
function preview(mode) {
  const rows = domRows();
  const self = resolveSelf(rows);
  const entries = self ? transcript(self) : entriesFromDom(rows);
  const { runs } = buildRuns(entries, self ? outboxFor(self) : []);
  const names = runs.flatMap((r) => r.partners)
    .reduce((keep, name) => (keep.some((n) => sameBot(n, name)) ? keep : keep.concat(name)), []);
  const pool = names.length ? names.map((n) => agentNamed(n) || { name: n })
    : listAgents().filter((a) => !self || a.id !== self.id).sort((a, b) => b.mtime - a.mtime).slice(0, 3);
  const marks = pool.slice(0, 6).map((a) => markOf(a.name, a.id ? a : null));
  if (!marks.length) return null;
  ensureCss();
  if (mode === "thread") {
    openThread(marks[0]);
    return { mode: "thread", with: marks[0].name };
  }
  const anchor = document.querySelector(".gd-chatter-chip") || document.querySelector("header") || document.body;
  openPicker(anchor, marks);
  return { mode: "picker", bots: marks.map((m) => m.name) };
}

/* ----------------------------------------------------------------- start */

let observer = null;

// A recycled row can keep its node and swap only the key and the text, so
// childList alone would leave a marker sitting on someone else's message.
const OBSERVE = {
  childList: true, subtree: true, characterData: true,
  attributes: true, attributeFilter: ["data-row-key"],
};

function start() {
  if (typeof document === "undefined" || !document.body) return;
  try { paint(); } catch (e) { log(e); }
  if (observer) return;
  let timer = null;
  observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { paint(); } catch (e) { log(e); }
    }, 120);
  });
  observer.observe(document.body, OBSERVE);
}

// Reloading this module on a live renderer must not leave the previous observer
// running against the old code, or old markers on rows the new code owns.
function stop() {
  if (observer) { observer.disconnect(); observer = null; }
  closePicker();
  closeThread();
  document.querySelectorAll("[" + PAINTED + "]").forEach((n) => {
    if (n.classList.contains("gd-chatter-line")) n.remove(); else unpaint(n);
  });
  const css = document.getElementById(STYLE_ID);
  if (css) css.remove();
  txCache.clear();
  selfCache = { sig: "", agent: null };
}

module.exports = {
  start, stop, paint, preview, openPicker, openThread, closePicker, closeThread,
  parseChatter, sameBot, markFor, markOf, modelBadge, shapeSvg, readableTint, gradientOf, buildRuns, runLabel, mergeThread,
  esc, clockTime, listAgents, transcript, chatterOf, outboxFor, resolveSelf,
  boxModel, logoSvg, COLORS, SHAPES, MODEL_MARKS,
};
