"use strict";
// Pull the newer cinematic splash out of splash/index.html.

function extractIndex(html) {
  const src = String(html || "");
  const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  const start = src.indexOf('<div id="grokd-splash-stage"');
  const scriptOpen = src.lastIndexOf("<script>");
  const stage = start >= 0 && scriptOpen > start ? src.slice(start, scriptOpen).trim() : "";
  const script = (src.slice(scriptOpen).match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";
  return { style, stage, script };
}

function scopeCss(raw) {
  return String(raw || "")
    .replace(/\*\s*\{[\s\S]*?\}\s*/, "")
    .replace(/body,\s*html\s*\{[\s\S]*?\}/, ".grokd-splash-stage { overflow: hidden; }");
}

function hardenScript(script) {
  return String(script || "")
    .replace(/(\w+)\.className = ("[^"]*");/g, "$1.setAttribute(\"class\", $2);")
    .replace(/let splashInstance = new GrokDSplash\(\);/, "window.__grokDSplashInstance = new GrokDSplash();");
}

module.exports = { extractIndex, scopeCss, hardenScript };
