// Seed a Local D agent that continues a Cursor seat's thread.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const clone = require("./clone-bot");
const paths = require("./paths");

const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
const PAYLOAD = path.join(ROOT, "runtime", "takeover.json");

function readPayload() {
  try { return JSON.parse(fs.readFileSync(PAYLOAD, "utf8")); }
  catch { return {}; }
}

function writePayload(obj) {
  fs.mkdirSync(path.dirname(PAYLOAD), { recursive: true });
  fs.writeFileSync(PAYLOAD, JSON.stringify(obj || {}, null, 2) + "\n");
  return PAYLOAD;
}

function pickTemplate(agentsDir) {
  let ids = [];
  try { ids = fs.readdirSync(agentsDir); } catch { return null; }
  for (const id of ids) {
    if (!clone.UUID_RE.test(id)) continue;
    const prof = path.join(agentsDir, id, "profile.json");
    if (fs.existsSync(prof)) return id;
  }
  return null;
}

function writeMemory(agentDir, payload) {
  const dir = path.join(agentDir, "memory", "log");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    "# Continued from " + (payload.fromName || payload.from || "Cursor"),
    "",
    "Switched to Local D. Same thread. Local models from here.",
    "",
    "From seat: " + (payload.from || "?"),
    "Model: " + (payload.model || "?"),
    "When: " + new Date(payload.at || Date.now()).toISOString(),
    "",
    "## Last composer",
    payload.lastUser || "(empty)",
    "",
    "## Recent messages",
  ];
  const excerpts = Array.isArray(payload.excerpts) ? payload.excerpts : [];
  if (!excerpts.length) lines.push("(none captured)");
  for (const line of excerpts) {
    lines.push("");
    lines.push(String(line).slice(0, 2000));
  }
  lines.push("");
  const file = path.join(dir, "takeover.md");
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function createViaApi(payload) {
  const homeRoot = path.join(os.homedir(), ".grok", "grokbot-d");
  if (ROOT !== homeRoot) throw new Error("isolated root");
  const name = "From " + (payload.fromName || payload.from || "Cursor");
  const desc = [
    "Continuation of " + (payload.fromName || payload.from || "the previous seat") + ".",
    "Keep the same settings and pick up the last thread.",
    payload.model ? ("Was using " + payload.model + ".") : "",
    payload.lastUser ? ("Last user: " + String(payload.lastUser).slice(0, 280)) : "",
  ].filter(Boolean).join(" ");
  const raw = execFileSync("curl", [
    "-sS", "-X", "POST", "http://127.0.0.1:1337/api/createAgent",
    "-H", "content-type: application/json",
    "-H", "authorization: Bearer fake-gateway-token",
    "-d", JSON.stringify({ name, description: desc, origin: "takeover" }),
  ], { encoding: "utf8", timeout: 15000 });
  const j = JSON.parse(raw);
  const id = j && (j.id || j.agentId || (j.agent && j.agent.id));
  if (!id) throw new Error("createAgent returned no id: " + raw.slice(0, 180));
  return { id, name, raw: j };
}

function seedFiles(payload) {
  const agentsDir = paths.agentsDir();
  fs.mkdirSync(agentsDir, { recursive: true });
  const tmpl = pickTemplate(agentsDir);
  const destId = clone.newId();
  if (tmpl) {
    clone.cloneAgent(tmpl, { agentsDir, destId, profileId: payload.from || null });
  } else {
    fs.mkdirSync(path.join(agentsDir, destId), { recursive: true });
  }
  const dest = path.join(agentsDir, destId);
  const name = "From " + (payload.fromName || payload.from || "Cursor");
  const prof = {
    name,
    description: "Continuation of " + (payload.fromName || payload.from || "the previous seat") + ". Same thread, local models.",
    title: "Continued",
    origin: "takeover",
    continuedFrom: { profileId: payload.from || null, at: Date.now(), model: payload.model || null },
  };
  fs.writeFileSync(path.join(dest, "profile.json"), JSON.stringify(prof, null, 2) + "\n");
  const settings = { notifyOnAgentUpdates: true, model: payload.model || "grok-4.6" };
  fs.writeFileSync(path.join(dest, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  writeMemory(dest, payload);
  fs.writeFileSync(path.join(agentsDir, "active-agent.json"), JSON.stringify({ activeAgentId: destId }) + "\n");
  return { id: destId, name, dest };
}

function seed(payload) {
  payload = Object.assign({}, readPayload(), payload || {});
  let created = null;
  try { created = createViaApi(payload); } catch {}
  const agentsDir = paths.agentsDir();
  if (created && created.id) {
    const dest = path.join(agentsDir, created.id);
    if (fs.existsSync(dest)) writeMemory(dest, payload);
    try {
      fs.writeFileSync(path.join(agentsDir, "active-agent.json"), JSON.stringify({ activeAgentId: created.id }) + "\n");
    } catch {}
    return { ok: true, via: "api", id: created.id, name: created.name };
  }
  const files = seedFiles(payload);
  return { ok: true, via: "files", id: files.id, name: files.name };
}

module.exports = { seed, writePayload, readPayload, writeMemory, PAYLOAD };

if (require.main === module) {
  const r = seed();
  console.log(JSON.stringify(r));
}
