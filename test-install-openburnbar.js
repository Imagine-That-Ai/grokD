#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const fs = require("fs");
const path = require("path");
const info = require("./openburnbar-install").info();
const models = require("./model-lib");
const onboardingApi = require("./splash/onboarding");
const onboarding = fs.readFileSync(path.join(__dirname, "splash", "onboarding.js"), "utf8");
const onboardingCss = fs.readFileSync(path.join(__dirname, "splash", "onboarding.css"), "utf8");
const renderBody = (onboarding.match(/function render\(\) \{([^}]*)\}/) || [])[1] || "";

assert(info.npmProxy === true, "npm ships the proxy");
assert(/npx -y (--ignore-scripts )?openburnbar(@[0-9.]+)? proxy --port 8320/.test(info.install.proxy), info.install.proxy);
assert(info.proxy.daemon.indexOf(":8317") >= 0, info.proxy.daemon);
assert(models.defaultConfig().proxyTarget === "openburnbar", models.defaultConfig().proxyTarget);
assert(models.FALLBACK_ORDER[0] === "openburnbar", models.FALLBACK_ORDER.join(","));
assert(
  onboardingApi.isOpenBurnBarHealthPayload({
    status: "ok", service: "openburnbar-proxy", pid: 42, port: 8320,
  }),
  "valid proxy health identity rejected"
);
assert(
  !onboardingApi.isOpenBurnBarHealthPayload({
    status: "ok", service: "foreign-proxy", pid: 42, port: 8320,
  }),
  "foreign listener accepted as OpenBurnBar"
);
assert(
  !onboardingApi.isOpenBurnBarHealthPayload({
    status: "ok", service: "openburnbar-proxy", pid: 42, port: 8317,
  }),
  "wrong port accepted as OpenBurnBar"
);
assert(
  !/npm cannot start the proxy yet|No proxy via npm yet|Installing OpenBurnBar\.app via npm/.test(onboarding),
  "stale Mac-app-only onboarding copy"
);
assert(/Starting the OpenBurnBar npm gateway on :8320/.test(onboarding), "missing npm proxy startup feedback");
assert(/OpenBurnBar did not start/.test(onboarding), "missing startup failure feedback");
assert(/exited before it became ready/.test(onboarding), "missing immediate launcher-exit feedback");
assert(renderBody.includes('note("");'), "step renders must clear stale onboarding feedback");
assert(/aria-modal", "true"/.test(onboarding), "onboarding dialog must identify itself as modal");
assert(/aria-label", "Set up Grok D"/.test(onboarding), "onboarding dialog must keep a stable accessible name");
assert(/overflow-y:\s*auto/.test(onboardingCss), "onboarding must remain scrollable in constrained windows");
assert(
  /min-width:\s*821px[\s\S]*max-width:\s*980px[\s\S]*gd-proxy-port[\s\S]*display:\s*none/.test(onboardingCss),
  "recommended gateway must preserve its brand name at compact desktop widths"
);
for (const asset of ["burnbar-mark.svg", "cliproxy-mark.svg", "vibeproxy-mark.svg"]) {
  assert(fs.existsSync(path.join(__dirname, "assets", asset)), `missing proxy logo: ${asset}`);
  assert(onboarding.includes(`../assets/${asset}`), `onboarding does not render proxy logo: ${asset}`);
}
console.log("PASS  npm-proxy-is-cli-gateway");
console.log("PASS  grokD-default-is-openburnbar");

const http = require("http");
const { spawn } = require("child_process");
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate a test port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
const TEST_TOKEN = "test-isolated-token-" + Math.random().toString(36).slice(2, 10);
function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: "127.0.0.1",
      port,
      path: pathname,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") }));
    });
    req.on("error", reject);
  });
}
async function waitForInstallRoute(port) {
  const deadline = Date.now() + 3000;
  let lastError;
  while (Date.now() < deadline) {
    try { return await get(port, "/install/openburnbar"); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("gateway shim did not become ready");
}
(async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, [path.join(__dirname, "gateway-shim.js")], {
    env: { ...process.env, GROK_SHIM_PORT: String(port), GROK_SHIM_UP: "http://127.0.0.1:19338", SAND_HOST_GATEWAY_TOKEN: TEST_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const r = await waitForInstallRoute(port);
    assert(r.status === 200 && r.json.npmProxy === true, JSON.stringify(r));
    console.log("PASS  install-route");
    console.log("\n3/3 openburnbar install contract checks passed");
  } finally {
    child.kill("SIGTERM");
  }
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
