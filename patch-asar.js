#!/usr/bin/env node
// Apply the small official-asar hooks D needs. Safe to run twice.
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || "/tmp/grokbot-asar";
const mainPath = path.join(SRC, "dist", "electron-main", "main.cjs");
const preloadPath = path.join(SRC, "dist", "electron-preload", "preload.cjs");

// Injected into Cursor's bundle: read active-env.json and short-circuit to
// local mode. All three IPn injection sites embed this verbatim.
const LOCAL_ENV_PROBE = 'const os=require("os"),path=require("path"),fs=require("fs"),root=process.env.GROK_PROFILE_ROOT||path.join(os.homedir(),".grok","grokbot-d");let isLoc=false;try{isLoc=require(path.join(root,"profile-auth-preload.js")).isLocalMode()}catch{try{const st=fs.statSync(path.join(root,"active-env.json"));if(!process.getuid||st.uid===process.getuid()){const env=JSON.parse(fs.readFileSync(path.join(root,"active-env.json"),"utf8"));isLoc=Boolean(env&&env.mode==="local"&&(env.profileId==="local-d"||env.profileId==="local"))}}catch{isLoc=false}}if(isLoc)';

const IPN_OFFICIAL = 'async function IPn(t){let e=await t.getAuthStatus().catch(o3s);if(e.kind==="logging-in")return{identity:null,access:a8t};let r=db(e);return r===null?{identity:null,access:e.kind==="logged-in"?a8t:Dhr}:{identity:r,access:await t.readAccess().catch(s3s)}}';
const IPN_PATCH = 'async function IPn(t){let e=await t.getAuthStatus().catch(o3s);try{' + LOCAL_ENV_PROBE + 'return{identity:db(e)||e.authId||e.email||"cursor",access:{state:"granted",reason:"none"}}}catch{}if(e.kind==="logging-in")return{identity:null,access:a8t};let r=db(e);return r===null?{identity:null,access:e.kind==="logged-in"?a8t:Dhr}:{identity:r,access:await t.readAccess().catch(s3s)}}';

const READ_OFFICIAL = 'async read(a){if(!t.codec.isAvailable())return null;let l;try{l=await XYe.promises.readFile(t.filePath,"utf8")}catch(u){return lBs(u)||xe("gateway-descriptor","read",u),null}try{let u=JSON.parse(l);return!J1t(u)||u.version!==K6n||u.accountScope!==a||typeof u.savedAtMs!="number"||e()-u.savedAtMs>r||typeof u.encrypted!="string"?null:cBs(JSON.parse(t.codec.decrypt(u.encrypted)))}catch(u){return xe("gateway-descriptor","decrypt",u),null}}';
const READ_PATCH = 'async read(a){if(!t.codec.isAvailable())return null;let n=async()=>{try{const os=require("os"),path=require("path"),root=process.env.GROK_PROFILE_ROOT||path.join(os.homedir(),".grok","grokbot-d");if(!require(path.join(root,"profile-auth-preload.js")).isLocalMode())return null;let p=t.filePath.replace(/gateway-descriptor\\.json$/,"sand-data/local-exec-daemon-connection.json");return cBs(JSON.parse(await XYe.promises.readFile(p,"utf8")))}catch{return null}};let l;try{l=await XYe.promises.readFile(t.filePath,"utf8")}catch(u){return lBs(u)?await n():(xe("gateway-descriptor","read",u),null)}try{let u=JSON.parse(l);let x=!J1t(u)||u.version!==K6n||u.accountScope!==a||typeof u.savedAtMs!="number"||e()-u.savedAtMs>r||typeof u.encrypted!="string"?null:cBs(JSON.parse(t.codec.decrypt(u.encrypted)));return x||await n()}catch(u){return xe("gateway-descriptor","decrypt",u),await n()}}';

const AUTH_OFFICIAL = 'Ic.markPhase("auth_service");let a=await u2(),l=FOn({getStatus:()=>a.getStatus()';
const AUTH_PATCH = 'Ic.markPhase("auth_service");let a=await u2();try{const os=require("os"),path=require("path"),root=process.env.GROK_PROFILE_ROOT||path.join(os.homedir(),".grok","grokbot-d");a=require(path.join(root,"profile-auth-preload.js")).wrapMainAuth(a)||a}catch{}let l=FOn({getStatus:()=>a.getStatus()';

const HOOK = `

// Disk-loaded Profiles + model picker + command bus.
try {
  const os = require("os");
  const path = require("path");
  const root = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  const hook = path.join(root, "profile-ui-inject.js");
  try { delete require.cache[require.resolve(hook)]; } catch {}
  require(hook);
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[profile-ui-inject] " + e + "\\n"); } catch (_) {}
}
`;

const MAIN_HOOK = `try{const os=require("os"),path=require("path"),root=process.env.GROK_PROFILE_ROOT||path.join(os.homedir(),".grok","grokbot-d");require(path.join(root,"patch-open-external.js"))}catch(e){try{require("fs").appendFileSync("/tmp/grokbot-renderer.log","[open-ext] "+e+"\\n")}catch(_){}}
`;

function tryReplace(text, from, to, label) {
  if (to && text.includes(to) && (!from || !text.includes(from))) {
    return { text, status: "already", label };
  }
  if (!from) return { text, status: "skipped", label, reason: "empty-from" };
  const n = text.split(from).length - 1;
  if (n === 1) return { text: text.replace(from, to), status: "patched", label };
  if (n === 0) return { text, status: "skipped", label, reason: "no-match" };
  return { text, status: "skipped", label, reason: "ambiguous:" + n };
}

function fuzzyWrapAuth(text) {
  if (text.includes("wrapMainAuth")) {
    return { text, status: "already", label: "wrap-main-auth-fuzzy" };
  }
  const re = /markPhase\("auth_service"\);let ([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\(\),/;
  if (!re.test(text)) {
    return { text, status: "skipped", label: "wrap-main-auth-fuzzy", reason: "no-match" };
  }
  const next = text.replace(re, (_, id, fn) => (
    "markPhase(\"auth_service\");let " + id + "=await " + fn + "();"
    + "try{const os=require(\"os\"),path=require(\"path\"),root=process.env.GROK_PROFILE_ROOT||path.join(os.homedir(),\".grok\",\"grokbot-d\");"
    + id + "=require(path.join(root,\"profile-auth-preload.js\")).wrapMainAuth(" + id + ")||" + id
    + "}catch{}let "
  ));
  return { text: next, status: "patched", label: "wrap-main-auth-fuzzy" };
}

function fuzzyIpn(text) {
  if (text.includes('state:"granted",reason:"none"') || (text.includes('active-env.json') && text.includes('identity:'))) {
    return { text, status: "already", label: "IPn-fuzzy" };
  }
  const re = /return\s*([A-Za-z0-9_$]+)===null\?\{identity:null,access:([A-Za-z0-9_$]+)\.kind==="logged-in"\?[A-Za-z0-9_$]+:[A-Za-z0-9_$]+\}:\{identity:\1,access:await ([A-Za-z0-9_$]+)\.readAccess\(\)\.catch\([^)]+\)\}/;
  if (re.test(text)) {
    return {
      text: text.replace(re, (m, idVar, eVar, paramVar) => {
        return "try{" + LOCAL_ENV_PROBE + "return{identity:" + idVar + "||" + eVar + ".authId||" + eVar + ".email||\"cursor\",access:{state:\"granted\",reason:\"none\"}}}catch{};" + m;
      }),
      status: "patched",
      label: "IPn-fuzzy",
    };
  }
  const fallbackRe = /return\{identity:([A-Za-z0-9_$]+),access:await ([A-Za-z0-9_$]+)\.readAccess\(\)\.catch\([^)]+\)\}/;
  if (fallbackRe.test(text)) {
    return {
      text: text.replace(fallbackRe, (m, idVar, paramVar) => "try{" + LOCAL_ENV_PROBE + "return{identity:" + idVar + "||\"cursor\",access:{state:\"granted\",reason:\"none\"}}}catch{};" + m),
      status: "patched",
      label: "IPn-fuzzy",
    };
  }
  return { text, status: "skipped", label: "IPn-fuzzy", reason: "no-match" };
}

function fuzzyDescriptorRead(text) {
  if (text.includes("sand-data/local-exec-daemon-connection.json")) {
    return { text, status: "already", label: "descriptor-read-fuzzy" };
  }
  const re = /async read\(([A-Za-z0-9_$]+)\)\{if\(!([A-Za-z0-9_$]+)\.codec\.isAvailable\(\)\)return null;let ([A-Za-z0-9_$]+);try\{\3=await ([A-Za-z0-9_$]+)\.promises\.readFile\(\2\.filePath,"utf8"\)\}catch\(([A-Za-z0-9_$]+)\)\{([^}]+)\}/;
  if (re.test(text)) {
    return {
      text: text.replace(re, (m, aArg, rObj, lVar, fsObj, uErr, origCatch) => {
        return "async read(" + aArg + "){if(!" + rObj + ".codec.isAvailable())return null;let n=async()=>{try{let p=" + rObj + ".filePath.replace(/gateway-descriptor\\.json$/,\"sand-data/local-exec-daemon-connection.json\");return JSON.parse(await " + fsObj + ".promises.readFile(p,\"utf8\"))}catch{return null}};let " + lVar + ";try{" + lVar + "=await " + fsObj + ".promises.readFile(" + rObj + ".filePath,\"utf8\")}catch(" + uErr + "){let _res=await n();if(_res)return _res;" + origCatch + ";return null;}";
      }),
      status: "patched",
      label: "descriptor-read-fuzzy",
    };
  }
  return { text, status: "skipped", label: "descriptor-read-fuzzy", reason: "no-match" };
}

function ensurePreloadHook(file) {
  if (!fs.existsSync(file)) return "missing-preload";
  let pre = fs.readFileSync(file, "utf8");
  if (pre.includes("profile-ui-inject.js")) return "already";
  fs.writeFileSync(file, pre + HOOK);
  return "patched";
}

function assertSafePath(targetPath, baseDir) {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  const lstat = fs.lstatSync(targetPath);
  if (lstat.isSymbolicLink()) {
    throw new Error(`Symlinks not allowed in patch targets: ${targetPath}`);
  }
  if (typeof process.getuid === "function" && lstat.uid !== process.getuid()) {
    throw new Error(`Untrusted ownership on patch target: ${targetPath}`);
  }
  if ((lstat.mode & 0o002) !== 0) {
    throw new Error(`World-writable patch target not allowed: ${targetPath}`);
  }
  const real = fs.realpathSync(targetPath);
  const realBase = fs.realpathSync(baseDir);
  if (!real.startsWith(realBase + path.sep) && real !== realBase) {
    throw new Error(`Target path ${targetPath} escapes base dir ${baseDir}`);
  }
}

function applyPatches(opts) {
  opts = opts || {};
  const baseDir = opts.src || (opts.mainPath ? path.dirname(opts.mainPath) : SRC);
  const mainFile = opts.mainPath || path.join(baseDir, "dist", "electron-main", "main.cjs");
  const preFile = opts.preloadPath || path.join(baseDir, "dist", "electron-preload", "preload.cjs");
  if (fs.existsSync(baseDir)) {
    assertSafePath(mainFile, baseDir);
    assertSafePath(preFile, baseDir);
  }
  if (!fs.existsSync(mainFile)) throw new Error("missing " + mainFile);
  let main = fs.readFileSync(mainFile, "utf8");
  const ipn = tryReplace(main, IPN_OFFICIAL, IPN_PATCH, "IPn");
  main = ipn.text;
  let ipnFuzzy = { status: "skipped", label: "IPn-fuzzy" };
  if (ipn.status === "skipped") {
    ipnFuzzy = fuzzyIpn(main);
    main = ipnFuzzy.text;
  }
  const rd = tryReplace(main, READ_OFFICIAL, READ_PATCH, "descriptor-read");
  main = rd.text;
  let rdFuzzy = { status: "skipped", label: "descriptor-read-fuzzy" };
  if (rd.status === "skipped") {
    rdFuzzy = fuzzyDescriptorRead(main);
    main = rdFuzzy.text;
  }
  const auth = tryReplace(main, AUTH_OFFICIAL, AUTH_PATCH, "wrap-main-auth");
  main = auth.text;
  let authFuzzy = { status: "skipped", label: "wrap-main-auth-fuzzy" };
  if (auth.status === "skipped") {
    authFuzzy = fuzzyWrapAuth(main);
    main = authFuzzy.text;
  }
  let openExt = "already";
  if (!main.includes("patch-open-external.js")) {
    main = MAIN_HOOK + main;
    openExt = "patched";
  }

  // Validate JavaScript syntax before writing
  const vm = require("vm");
  try {
    new vm.Script("(async function(){\n" + main + "\n})", { filename: "main.cjs" });
  } catch (synErr) {
    throw new Error("Patched main.cjs failed JavaScript syntax verification: " + synErr.message);
  }

  fs.writeFileSync(mainFile, main);
  const hook = ensurePreloadHook(preFile);
  const report = {
    main: mainFile,
    IPn: ipn.status === "skipped" ? ipnFuzzy.status : ipn.status,
    descriptorRead: rd.status === "skipped" ? rdFuzzy.status : rd.status,
    wrapMainAuth: auth.status === "skipped" ? authFuzzy.status : auth.status,
    openExternal: openExt,
    preloadHook: hook,
    minVersionBypass: "not-applied",
  };
  const allMandatoryOk = (hook === "patched" || hook === "already") &&
    (report.openExternal === "patched" || report.openExternal === "already") &&
    (report.IPn === "patched" || report.IPn === "already") &&
    (report.descriptorRead === "patched" || report.descriptorRead === "already") &&
    (report.wrapMainAuth === "patched" || report.wrapMainAuth === "already");
  const requireAll = opts.requireAll !== false;
  report.ok = requireAll ? allMandatoryOk : ((hook === "patched" || hook === "already") && (report.openExternal === "patched" || report.openExternal === "already"));
  return report;
}

function main() {
  const report = applyPatches();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = {
  IPN_OFFICIAL, IPN_PATCH, READ_OFFICIAL, READ_PATCH, AUTH_OFFICIAL, AUTH_PATCH,
  tryReplace, fuzzyIpn, fuzzyWrapAuth, ensurePreloadHook, applyPatches, HOOK, MAIN_HOOK,
};
