// Fall-over copy + icons. Disk-loaded every menu open so labels stay current.
"use strict";

const ICONS = {
  branch: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M8.1 7.2c2.4 1.2 4.2 2.2 7.5 4.2M8.1 16.8c2.4-1.2 4.2-2.2 7.5-4.2"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l4 4-4 4"/><path d="M20 7H9a4 4 0 00-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h11a4 4 0 004-4"/></svg>`,
  brief: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5.5A2.5 2.5 0 0110.5 3h3A2.5 2.5 0 0116 5.5V7"/><path d="M3 13h18"/></svg>`,
  clone: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/></svg>`,
};

const ROWS = [
  {
    key: "enabled",
    label: "Auto Failover",
    sub: "Master quota switch",
    tip: "Master switch: When your active seat runs out of quota, immediately halts billing and switches to the first active backup route below.",
    icon: "branch",
  },
  {
    key: "nextCursor",
    label: "Next Account",
    sub: "Switch to seat with quota",
    tip: "Rotate Accounts: Automatically switches to your next available Cursor account when current quota is reached. Local chats continue seamlessly; official Cursor chats start a new thread.",
    icon: "swap",
  },
  {
    key: "localChief",
    label: "Locally · Chief Handoff",
    sub: "Delegate to local chief",
    tip: "Primary Agent Handoff: Automatically delegates coordination to your primary local agent when this seat runs out of quota.",
    icon: "brief",
  },
  {
    key: "localClone",
    label: "Locally · Continue",
    sub: "Keep going on this Mac",
    tip: "Continue locally: Retains chat history and transfers the session to your local models. Official Cursor chats cannot keep the same cloud thread — copies recent turns to continue on local or proxied models.",
    icon: "clone",
  },
];

const TOAST = {
  enabled: "Auto Failover",
  nextCursor: "Next Account",
  localChief: "Locally · Chief Handoff",
  localClone: "Locally · Continue",
};

function rowHtml(cfg, switchHtml) {
  return ROWS.map((r) => {
    const on = !!(cfg && cfg[r.key]);
    return `
      <div class="gd-setrow" data-fo="${esc(r.key)}" role="switch" aria-checked="${on ? "true" : "false"}" tabindex="0" data-tip="${esc(r.tip)}" title="${esc(r.tip)}">
        <span class="gd-fo-ico" aria-hidden="true">${ICONS[r.icon] || ""}</span>
        <div class="gd-setcopy">
          <b>${esc(r.label)}</b>
          <p>${esc(r.sub)}</p>
        </div>
        ${switchHtml(on)}
      </div>`;
  }).join("");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");
}

module.exports = { ICONS, ROWS, TOAST, rowHtml, esc };
