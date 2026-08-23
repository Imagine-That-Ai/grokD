#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const patch = require("./patch-asar");

(async function main() {
let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

const r1 = patch.tryReplace("abc", "b", "B", "x");
assert(r1.status === "patched" && r1.text === "aBc", r1.text);
ok("exact-patch");

const r2 = patch.tryReplace("aBc", "b", "B", "x");
assert(r2.status === "already", r2.status);
ok("already");

const r3 = patch.tryReplace("aaa", "zzz", "Q", "x");
assert(r3.status === "skipped" && r3.reason === "no-match", r3.reason);
ok("no-match-does-not-throw");

const r4 = patch.tryReplace("xx xx", "xx", "Y", "x");
assert(r4.status === "skipped" && /ambiguous/.test(r4.reason), r4.reason);
ok("ambiguous-skip");

const fuzzy = patch.fuzzyIpn('return{identity:r,access:await t.readAccess().catch(s3s)}');
assert(fuzzy.status === "patched" && /granted/.test(fuzzy.text), fuzzy.text);
ok("fuzzy-ipn");

{
  const v20 = [
    "var ZEr=HPn({}),",
    "{ensureCursorAuthService:u2}=ZEr,",
    "iGs=createConsumer(u2);",
  ].join("");
  const wrapped = patch.fuzzyWrapEnsureAuth(v20);
  assert(wrapped.status === "patched", wrapped.status);
  assert(wrapped.text.includes("wrapEnsureMainAuth(u2)"), wrapped.text);
  assert(
    wrapped.text.indexOf("wrapEnsureMainAuth(u2)") <
      wrapped.text.indexOf("createConsumer(u2)"),
    "official auth factory must be wrapped before any consumer captures it"
  );
  ok("main-auth-factory-before-first-consumer");
}

{
  const preload = [
    'var electron=require("electron");',
    'var desktop={cursorAccount:{getStatus:async()=>({kind:"logged-out"})},onboarding:{}};',
    'electron.contextBridge.exposeInMainWorld("desktop",desktop);',
  ].join("");
  const wrapped = patch.wrapPreloadAuth(preload);
  assert(wrapped.status === "patched", wrapped.status);
  assert(wrapped.text.includes("__grokdPreExposeDesktop"), wrapped.text);
  assert(
    wrapped.text.indexOf("__grokdPreExposeDesktop") <
      wrapped.text.indexOf('contextBridge.exposeInMainWorld("desktop"'),
    "local auth must be applied before contextBridge freezes the desktop API"
  );
  ok("preload-auth-before-context-bridge");
}

{
  const v23 = 'Dc.markPhase("auth_service");let d=await CE(),m=uJn({getStatus:()=>d.getStatus()';
  const w = patch.fuzzyWrapAuth(v23);
  assert(w.status === "patched", w.status);
  assert(w.text.includes("wrapMainAuth"), w.text);
  assert(w.text.includes("let m=uJn"), "kept membership bind: " + w.text);
  const v20 = 'Ic.markPhase("auth_service");let a=await u2(),l=FOn({getStatus:()=>a.getStatus()';
  const w2 = patch.fuzzyWrapAuth(v20);
  assert(w2.status === "patched" && w2.text.includes("wrapMainAuth"), w2.text);
  ok("fuzzy-wrap-auth-0.23");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-asar-"));
const mainFile = path.join(tmp, "main.cjs");
const preFile = path.join(tmp, "preload.cjs");
fs.writeFileSync(mainFile, [
  "var ZEr={ensureCursorAuthService:async()=>({})}," +
    "{ensureCursorAuthService:u2}=ZEr,iGs={};",
  patch.IPN_OFFICIAL,
  patch.READ_OFFICIAL,
  patch.AUTH_OFFICIAL,
].join("\n"));
fs.writeFileSync(preFile, [
  'var electron=require("electron");',
  'var desktop={cursorAccount:{getStatus:async()=>({kind:"logged-out"})},onboarding:{}};',
  'electron.contextBridge.exposeInMainWorld("desktop",desktop);',
].join(""));
const report = patch.applyPatches({ mainPath: mainFile, preloadPath: preFile });
assert(report.ok === true, JSON.stringify(report));
assert(report.preloadHook === "patched", report.preloadHook);
assert(report.preloadAuth === "patched", report.preloadAuth);
assert(fs.readFileSync(preFile, "utf8").includes("profile-ui-inject.js"), "hook landed");
assert(report.ensureMainAuth === "patched", report.ensureMainAuth);
assert(report.IPn === "patched", report.IPn);
assert(report.descriptorRead === "patched", report.descriptorRead);
assert(report.wrapMainAuth === "patched", report.wrapMainAuth);
ok("complete-asar-contract");

const incompleteMain = path.join(tmp, "main-incomplete.cjs");
const incompletePreload = path.join(tmp, "preload-incomplete.cjs");
fs.writeFileSync(incompleteMain, "console.log('stock')\n");
fs.writeFileSync(incompletePreload, 'electron.contextBridge.exposeInMainWorld("desktop",desktop);');
const incomplete = patch.applyPatches({ mainPath: incompleteMain, preloadPath: incompletePreload });
assert(incomplete.ok === false, JSON.stringify(incomplete));
assert(incomplete.missing.includes("IPn"), JSON.stringify(incomplete));
assert(incomplete.missing.includes("descriptorRead"), JSON.stringify(incomplete));
assert(incomplete.missing.includes("ensureMainAuth"), JSON.stringify(incomplete));
assert(incomplete.missing.includes("wrapMainAuth"), JSON.stringify(incomplete));
ok("incomplete-asar-fails-closed");

{
  const authRoot = path.join(tmp, "auth-root");
  fs.mkdirSync(authRoot);
  fs.writeFileSync(path.join(authRoot, "active-env.json"), JSON.stringify({
    mode: "local",
    profileId: "local-d",
  }));
  process.env.GROK_PROFILE_ROOT = authRoot;
  delete require.cache[require.resolve("./profile-auth-preload")];
  const auth = require("./profile-auth-preload");
  let observed = null;
  const desktop = {
    cursorAccount: {
      onStatusChanged(fn) {
        fn({ kind: "logged-out" });
        return () => {};
      },
    },
    onboarding: {},
  };
  auth.applyAuthPolicy(desktop);
  const stop = desktop.cursorAccount.onStatusChanged((status) => { observed = status; });
  assert(observed && observed.kind === "logged-in", JSON.stringify(observed));
  assert(typeof stop === "function", "local status subscription must be disposable");
  stop();
  const rendererStatus = await desktop.cursorAccount.getStatus();
  rendererStatus.kind = "logged-out";
  assert((await desktop.cursorAccount.getStatus()).kind === "logged-in",
    "renderer auth status leaked a mutable shared object");

  let officialFactoryCalls = 0;
  const ensure = auth.wrapEnsureMainAuth(async function () {
    officialFactoryCalls++;
    return {
      getStatus: async function () { return { kind: "logged-out" }; },
      subscribe: function () { return function () {}; },
      login: async function () { return { kind: "logged-out" }; },
      logout: async function () { return { kind: "logged-out" }; },
    };
  });
  const localMain = await ensure();
  assert(officialFactoryCalls === 0, "local mode touched the official auth factory");
  assert((await localMain.getStatus()).kind === "logged-in", "local main auth is not logged in");
  assert((await localMain.getValidAccessToken()).split(".").length === 3,
    "local main auth token must be structurally JWT-like");
  assert((await localMain.revokeForAccountRefusal()).kind === "completed",
    "local refusal handling must remain non-destructive");
  let secondListenerStatus = null;
  localMain.subscribe((status) => { status.kind = "logged-out"; });
  localMain.subscribe((status) => { secondListenerStatus = status; });
  await localMain.login();
  assert(secondListenerStatus && secondListenerStatus.kind === "logged-in",
    "main auth listeners shared mutable status");

  const seat = path.join(tmp, "local-safe-storage-seat");
  process.env.GROK_SEAT4 = seat;
  const fakeSafeStorage = {
    isEncryptionAvailable: function () { return false; },
    encryptString: function () { throw new Error("official encrypt called"); },
    decryptString: function () { throw new Error("official decrypt called"); },
  };
  assert(auth.installLocalSafeStorage(fakeSafeStorage) === true,
    "local safeStorage shim was not installed");
  const encrypted = fakeSafeStorage.encryptString("first-run-secret");
  assert(Buffer.isBuffer(encrypted), "local safeStorage encrypt did not return a Buffer");
  assert(!encrypted.includes(Buffer.from("first-run-secret")),
    "local safeStorage wrote plaintext");
  assert(fakeSafeStorage.decryptString(encrypted) === "first-run-secret",
    "local safeStorage round trip failed");
  let rejectedForeign = false;
  try { fakeSafeStorage.decryptString(Buffer.from("official-keychain-ciphertext")); }
  catch (e) { rejectedForeign = e && e.code === "GROKD_LOCAL_SAFE_STORAGE_FOREIGN_CIPHERTEXT"; }
  assert(rejectedForeign, "local safeStorage accepted foreign Keychain ciphertext");
  const keyDir = path.join(seat, ".grokd-local-safe-storage");
  const keyPath = path.join(seat, ".grokd-local-safe-storage", "key");
  assert((fs.statSync(keyDir).mode & 0o777) === 0o700,
    "local safeStorage directory permissions must be 0700");
  assert((fs.statSync(keyPath).mode & 0o777) === 0o600,
    "local safeStorage key permissions must be 0600");
  const frozenSafeStorage = Object.freeze({
    isEncryptionAvailable: function () { return false; },
    encryptString: function () {},
    decryptString: function () {},
  });
  assert(auth.installLocalSafeStorage(frozenSafeStorage) === false,
    "unpatchable safeStorage must fail closed");
  delete process.env.GROK_SEAT4;

  fs.writeFileSync(path.join(authRoot, "active-env.json"), JSON.stringify({
    mode: "cursor",
    profileId: "cursor-1",
  }));
  const officialMain = await ensure();
  assert(officialFactoryCalls === 1, "Cursor mode did not call the official auth factory");
  assert((await officialMain.getStatus()).kind === "logged-out",
    "Cursor mode changed official auth status");
  delete process.env.GROK_PROFILE_ROOT;
  ok("local-auth-never-opens-official-keychain");
}

{
  const relaunch = fs.readFileSync(path.join(__dirname, "relaunch-d.sh"), "utf8");
  const canonical = relaunch.indexOf('$HOME/Applications/Grok Bot D.app');
  const legacy = relaunch.indexOf('$HOME/Applications/grok\\"D\\".app');
  assert(canonical >= 0 && legacy >= 0 && canonical < legacy,
    "relauncher must prefer the canonical public app");
  const install = fs.readFileSync(path.join(__dirname, "install.sh"), "utf8");
  assert(install.includes('DEST="$HOME/Applications/Grok Bot D.app"'),
    "installer must use the canonical app path");
  assert(install.includes("LEGACY_APP=") && install.includes("ln -s"),
    "installer must replace a stale legacy bundle with a canonical alias");
  ok("canonical-app-wins");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n}/12 patch-asar checks passed`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
