// Official LobeHub brand marks + the OpenBurnBar crest. No invented mascots.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ASSETS = path.join(os.homedir(), ".grok", "grokbot-d", "assets");

function fileIcon(rel, id, fill) {
  const full = path.join(ASSETS, rel);
  let raw = fs.readFileSync(full, "utf8");
  const uid = "gd-" + id + "-";
  raw = raw.replace(/\sid="([^"]+)"/g, (_, name) => ' id="' + uid + name + '"');
  raw = raw.replace(/url\(#([^)]+)\)/g, (_, name) => "url(#" + uid + name + ")");
  raw = raw.replace(/\swidth="1em"/g, ' width="20"');
  raw = raw.replace(/\sheight="1em"/g, ' height="20"');
  raw = raw.replace(/\swidth="256"/g, ' width="20"');
  raw = raw.replace(/\sheight="256"/g, ' height="20"');
  if (fill) raw = raw.replace(/fill="currentColor"/g, 'fill="' + fill + '"');
  return raw;
}

const LOGOS = [
  { id: "gemini", title: "Gemini", file: "lobe/gemini-color.svg" },
  { id: "claude", title: "Claude", file: "lobe/claude-color.svg" },
  { id: "openai", title: "OpenAI", file: "lobe/openai.svg", fill: "#10A37F" },
  { id: "anthropic", title: "Anthropic", file: "lobe/anthropic.svg", fill: "#E8E4DC" },
  { id: "xai", title: "xAI", file: "lobe/xai.svg", fill: "#F4F4F5" },
  { id: "grok", title: "Grok", file: "lobe/grok.svg", fill: "#F4F4F5" },
  { id: "deepseek", title: "DeepSeek", file: "lobe/deepseek-color.svg" },
  { id: "cursor", title: "Cursor", file: "lobe/cursor.svg", fill: "#F4F4F5" },
  { id: "meta", title: "Meta", file: "lobe/meta-color.svg" },
  { id: "mistral", title: "Mistral", file: "lobe/mistral-color.svg" },
  { id: "perplexity", title: "Perplexity", file: "lobe/perplexity-color.svg" },
  { id: "openrouter", title: "OpenRouter", file: "lobe/openrouter-color.svg" },
  { id: "copilot", title: "GitHub Copilot", file: "lobe/copilot-color.svg" },
  { id: "qwen", title: "Qwen", file: "lobe/qwen-color.svg" },
];

const ORBITERS = [
  {
    id: "burnbar",
    title: "OpenBurnBar",
    scale: 1.32,
    svg: fileIcon("burnbar-mark.svg", "burnbar"),
  },
];

LOGOS.forEach((logo) => {
  ORBITERS.push({
    id: logo.id,
    title: logo.title,
    scale: 1,
    svg: fileIcon(logo.file, logo.id, logo.fill),
  });
});

const TINTS = [
  { id: "coral", hex: "#F45B69", glow: "rgba(244,91,105,0.62)", ring: "255,150,158" },
  { id: "tangerine", hex: "#FF7A3C", glow: "rgba(255,122,60,0.62)", ring: "255,176,110" },
  { id: "teal", hex: "#14B8A6", glow: "rgba(20,184,166,0.58)", ring: "110,230,214" },
  { id: "fuchsia", hex: "#E11D8F", glow: "rgba(225,29,143,0.58)", ring: "255,130,200" },
  { id: "violet", hex: "#8B5CF6", glow: "rgba(139,92,246,0.58)", ring: "196,170,255" },
  { id: "pearl", hex: "#F6EFE6", glow: "rgba(255,214,224,0.5)", ring: "255,228,220", special: "pearl" },
  { id: "blackhole", hex: "#14141A", glow: "rgba(255,92,48,0.7)", ring: "255,148,86", special: "blackhole" },
];

module.exports = { LOGOS, ORBITERS, TINTS };
