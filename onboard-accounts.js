// First-run: several Cursor logins, each its own seat. Pure helpers.
"use strict";

function signInProfiles(profiles) {
  return (profiles || []).filter((p) => p && p.kind === "cursor" && !p.sourceUserData && !p.identitySource);
}

function nextSignInName(profiles) {
  const n = signInProfiles(profiles).length;
  return n <= 0 ? "My Cursor" : "Cursor " + (n + 1);
}

function alreadyIds(state) {
  const ids = [];
  if (Array.isArray(state && state.cursorProfiles)) {
    for (const x of state.cursorProfiles) {
      if (x && x.id && ids.indexOf(x.id) < 0) ids.push(x.id);
    }
  }
  if (state && state.cursorProfile && ids.indexOf(state.cursorProfile) < 0) {
    ids.push(state.cursorProfile);
  }
  return ids;
}

function remember(state, entry) {
  const next = Object.assign({}, state || {});
  const list = Array.isArray(next.cursorProfiles) ? next.cursorProfiles.slice() : [];
  const i = list.findIndex((x) => x && x.id === entry.id);
  if (i >= 0) list[i] = Object.assign({}, list[i], entry);
  else list.push(Object.assign({}, entry));
  next.cursorProfiles = list;
  next.cursorProfile = entry.id;
  return next;
}

function unusedImports(detected, addedIds) {
  const have = new Set(addedIds || []);
  return (detected || []).filter((s) => s && s.id && !have.has(s.id));
}

function displayName(status, fallback) {
  if (status && status.email) return String(status.email).slice(0, 60);
  if (status && status.name) return String(status.name).slice(0, 60);
  return fallback || "Cursor";
}

function addSignInProfile(store) {
  if (!store || typeof store.add !== "function") throw new Error("profile store missing");
  const name = nextSignInName(typeof store.list === "function" ? store.list() : []);
  return store.add({ name, kind: "cursor" });
}

module.exports = {
  signInProfiles,
  nextSignInName,
  alreadyIds,
  remember,
  unusedImports,
  displayName,
  addSignInProfile,
};
