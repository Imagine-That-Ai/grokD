// Locate unpacked Electron native deps (tree-sitter) so host-main.cjs can boot.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function candidates() {
  const home = os.homedir();
  const extra = process.env.GROK_D_NODE_PATH ? [process.env.GROK_D_NODE_PATH] : [];
  const apps = [
    path.join(home, "Applications", 'grok"D".app'),
    path.join(home, "Applications", "Grok Bot D.app"),
    "/Applications/Grok Bot.app",
    path.join(home, "Applications", "Grok Bot.app"),
    path.join("/Applications", 'grok"D".app'),
    "/Applications/Grok Bot D.app",
  ];
  return extra.concat(apps.map((app) => path.join(app, "Contents", "Resources", "app.asar.unpacked", "dist", "deps")));
}

function resolveNodeDeps() {
  for (const dir of candidates()) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, "tree-sitter")) || fs.existsSync(path.join(dir, "web-tree-sitter"))) {
      return dir;
    }
  }
  return "";
}

function applyNodePath(env) {
  const next = Object.assign({}, env || process.env);
  const deps = resolveNodeDeps();
  if (!deps) return next;
  next.NODE_PATH = next.NODE_PATH ? deps + ":" + next.NODE_PATH : deps;
  return next;
}

module.exports = { resolveNodeDeps, applyNodePath, candidates };
