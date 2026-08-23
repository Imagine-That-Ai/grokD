// Official "Couldn't Reach Grok Bot's Computer" card.
// Keep the computer, restyle the copy, decide Retry vs Recover.
"use strict";

const SELECTOR = ".sand-computer-couldnt-reach-dialog, .sand-computer-lifecycle-dialog";
const CANDIDATE_SELECTOR = ".sand-computer-couldnt-reach-dialog, .sand-computer-lifecycle-dialog, [data-ui-dialog-root]";

function isComputerDialog(element) {
  if (!element) return false;
  try {
    if (element.matches && (element.matches(".sand-computer-couldnt-reach-dialog") || element.matches(".sand-computer-lifecycle-dialog"))) {
      return true;
    }
  } catch {}
  let t = String(element.textContent || "");
  if (!t && typeof element.querySelectorAll === "function") {
    try {
      t = Array.from(element.querySelectorAll("button, h1, h2, h3, p, span, div"))
        .map((node) => String(node && node.textContent || ""))
        .join(" ");
    } catch {}
  }
  return /Recover Grok Bot|Couldn.?t Reach|Reconnecting this seat|Grok Bot.?s Computer/i.test(t);
}

function findDialog(doc) {
  if (!doc) return null;
  // Keep compatibility with lightweight DOM adapters and older Electron
  // surfaces that only implement querySelector for the legacy selectors.
  if (typeof doc.querySelector === "function") {
    for (const selector of SELECTOR.split(", ")) {
      try {
        const candidate = doc.querySelector(selector);
        if (isComputerDialog(candidate)) return candidate;
      } catch {}
    }
  }
  if (typeof doc.querySelectorAll === "function") {
    try {
      const list = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR));
      const match = list.find(isComputerDialog);
      if (match) return match;
    } catch {}
  }
  return null;
}

function buttons(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const container = findDialog(doc);
  if (!container) return [];
  try { return Array.from(container.querySelectorAll("button")); }
  catch { return []; }
}

function overlayShowing(doc) {
  if (!doc) return false;
  const container = findDialog(doc);
  if (container) return true;
  return buttons(doc).some((b) => /Recover Grok Bot/i.test(String(b.textContent || "")));
}

function findRetry(doc) {
  return buttons(doc).find((b) => /^Retry$/i.test(String(b.textContent || "").trim())) || null;
}

function findRecover(doc) {
  return buttons(doc).find((b) => /Recover Grok Bot/i.test(String(b.textContent || ""))) || null;
}

function lostCopy(opts) {
  const paused = !!(opts && opts.paused);
  if (paused) {
    return {
      description: "This seat is paused. Files and logins are safe. The computer keeps reconnecting in the background.",
    };
  }
  return {
    description: "Reconnecting this seat's computer. Bots, files, and logins stay put.",
  };
}

function restyleLostDialog(doc, opts) {
  if (!doc || typeof doc.querySelectorAll !== "function") return false;
  const isLocal = !!(opts && opts.local);
  const dialogs = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR)).filter(isComputerDialog);
  let n = 0;
  dialogs.forEach((d) => {
    if (isLocal) {
      const backdrop = (d.closest && d.closest("[data-ui-dialog-backdrop]")) || d.parentElement;
      if (backdrop && backdrop !== doc.body && backdrop.contains(d)) backdrop.remove();
      d.remove();
      n += 1;
    }
  });
  if (isLocal) return n > 0;
  const dialog = findDialog(doc);
  if (!dialog || typeof dialog.querySelectorAll !== "function") return false;
  const copy = lostCopy(opts);
  dialog.querySelectorAll("p, h2, h3, span, div").forEach((el) => {
    if (el.children && el.children.length) return;
    const t = String(el.textContent || "").trim();
    if (!t) return;
    if (/Your Bots, files, and logins are safe|Couldn.?t Reach|reconnect on its own/i.test(t)) {
      el.textContent = copy.description;
      n += 1;
    }
  });
  return n > 0;
}

// Overlay never auto-taps Recover. Retry only when an https VM is on disk.
function pickAction(state) {
  const s = state || {};
  if (!s.overlay) return "none";
  if (s.healthy || s.hasRemote) return "retry";
  return "none";
}

module.exports = {
  SELECTOR,
  overlayShowing,
  findRetry,
  findRecover,
  lostCopy,
  restyleLostDialog,
  pickAction,
};
