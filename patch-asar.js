#!/usr/bin/env node
// Apply the small official-asar hooks D needs. Safe to run twice.
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || "/tmp/grokbot-asar";
const mainPath = path.join(SRC, "dist", "electron-main", "main.cjs");
const preloadPath = path.join(SRC, "dist", "electron-preload", "preload.cjs");

const IPN_OFFICIAL = 'async function IPn(t){let e=await t.getAuthStatus().catch(o3s);if(e.kind==="logging-in")return{identity:null,access:a8t};let r=db(e);return r===null?{identity:null,access:e.kind==="logged-in"?a8t:Dhr}:{identity:r,access:await t.readAccess().catch(s3s)}}';
const IPN_PATCH = 'async function IPn(t){let e=await t.getAuthStatus().catch(o3s);if(e.kind==="logging-in")return{identity:null,access:{state:"granted",reason:"none"}};let r=db(e);return{identity:r||e.authId||e.email||"cursor",access:{state:"granted",reason:"none"}}}';

const READ_OFFICIAL = 'async read(a){if(!t.codec.isAvailable())return null;let l;try{l=await XYe.promises.readFile(t.filePath,"utf8")}catch(u){return lBs(u)||xe("gateway-descriptor","read",u),null}try{let u=JSON.parse(l);return!J1t(u)||u.version!==K6n||u.accountScope!==a||typeof u.savedAtMs!="number"||e()-u.savedAtMs>r||typeof u.encrypted!="string"?null:cBs(JSON.parse(t.codec.decrypt(u.encrypted)))}catch(u){return xe("gateway-descriptor","decrypt",u),null}}';
const READ_PATCH = 'async read(a){if(!t.codec.isAvailable())return null;let n=async()=>{try{let p=t.filePath.replace(/gateway-descriptor\\.json$/,"sand-data/local-exec-daemon-connection.json");return cBs(JSON.parse(await XYe.promises.readFile(p,"utf8")))}catch{return null}};let l;try{l=await XYe.promises.readFile(t.filePath,"utf8")}catch(u){return lBs(u)?await n():(xe("gateway-descriptor","read",u),null)}try{let u=JSON.parse(l);let x=!J1t(u)||u.version!==K6n||u.accountScope!==a||typeof u.savedAtMs!="number"||e()-u.savedAtMs>r||typeof u.encrypted!="string"?null:cBs(JSON.parse(t.codec.decrypt(u.encrypted)));return x||await n()}catch(u){return xe("gateway-descriptor","decrypt",u),await n()}}';

const AUTH_OFFICIAL = 'Ic.markPhase("auth_service");let a=await u2(),l=FOn({getStatus:()=>a.getStatus()';
const AUTH_PATCH = 'Ic.markPhase("auth_service");let a=await u2();try{a=require(require("os").homedir()+"/.grok/grokbot-d/profile-auth-preload.js").wrapMainAuth(a)||a}catch{}let l=FOn({getStatus:()=>a.getStatus()';

const HOOK = `

// Disk-loaded Profiles + model picker + command bus.
try {
  require(require("os").homedir() + "/.grok/grokbot-d/profile-ui-inject.js");
} catch (e) {
  try { require("fs").appendFileSync("/tmp/grokbot-renderer.log", "[profile-ui-inject] " + e + "\\n"); } catch (_) {}
}
`;

const MAIN_HOOK = `try{require(require("os").homedir()+"/.grok/grokbot-d/patch-open-external.js")}catch(e){try{require("fs").appendFileSync("/tmp/grokbot-renderer.log","[open-ext] "+e+"\\n")}catch(_){}}
`;

function mustReplace(text, from, to, label) {
  if (text.includes(to) && !text.includes(from)) return { text, status: "already" };
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, found ${n}`);
  return { text: text.replace(from, to), status: "patched" };
}

function main() {
  if (!fs.existsSync(mainPath)) throw new Error("missing " + mainPath);
  let main = fs.readFileSync(mainPath, "utf8");
  const ipn = mustReplace(main, IPN_OFFICIAL, IPN_PATCH, "IPn");
  main = ipn.text;
  const rd = mustReplace(main, READ_OFFICIAL, READ_PATCH, "descriptor-read");
  main = rd.text;
  const auth = mustReplace(main, AUTH_OFFICIAL, AUTH_PATCH, "wrap-main-auth");
  main = auth.text;
  let openExt = "already";
  if (!main.includes("patch-open-external.js")) {
    main = MAIN_HOOK + main;
    openExt = "patched";
  }
  fs.writeFileSync(mainPath, main);

  let hook = "missing-preload";
  if (fs.existsSync(preloadPath)) {
    let pre = fs.readFileSync(preloadPath, "utf8");
    if (pre.includes("profile-ui-inject.js")) hook = "already";
    else {
      fs.writeFileSync(preloadPath, pre + HOOK);
      hook = "patched";
    }
  }

  const report = { main: mainPath, IPn: ipn.status, descriptorRead: rd.status, wrapMainAuth: auth.status, openExternal: openExt, preloadHook: hook };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { IPN_OFFICIAL, IPN_PATCH, READ_OFFICIAL, READ_PATCH, AUTH_OFFICIAL, AUTH_PATCH };
