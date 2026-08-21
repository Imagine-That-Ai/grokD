// Official "Couldn't Reach Grok Bot's Computer" card.
// Keep the computer, restyle the copy, decide Retry vs Recover.
"use strict";

const SELECTOR = ".sand-computer-couldnt-reach-dialog, .sand-computer-lifecycle-dialog";

function buttons(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  try { return Array.from(doc.querySelectorAll("button")); }
  catch { return []; }
}

function overlayShowing(doc) {
  if (!doc) return false;
  if (typeof doc.querySelector === "function") {
    try {
      if (doc.querySelector(".sand-computer-couldnt-reach-dialog")) return true;
    } catch {}
  }
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
  if (!doc || typeof doc.querySelector !== "function") return false;
  const isLocal = !!(opts && opts.local);
  const dialogs = doc.querySelectorAll(
    SELECTOR + ", [data-ui-dialog-root]"
  );
  let n = 0;
  dialogs.forEach((d) => {
    const t = String(d.textContent || "");
    if (/Recover Grok Bot|Couldn.?t Reach|Reconnecting this seat/i.test(t)) {
      if (isLocal) {
        const backdrop = (d.closest && d.closest("[data-ui-dialog-backdrop]")) || d.parentElement;
        if (backdrop && backdrop !== doc.body && backdrop.contains(d)) backdrop.remove();
        d.remove();
        n += 1;
      }
    }
  });
  if (isLocal) return n > 0;
  const dialog = doc.querySelector(SELECTOR) || (overlayShowing(doc) ? doc.body : null);
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
