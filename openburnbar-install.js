"use strict";

// Install contract for grokD. The `openburnbar` npm package owns the
// loopback OpenAI-compatible gateway on :8320. The native app remains an
// optional install path, and its Swift daemon remains separate on :8317.

const DAEMON_PORT = 8317;
const GROKD_PORT = 8320;
const DAEMON_URL = "http://127.0.0.1:8317/v1/chat/completions";
const GROKD_URL = "http://127.0.0.1:8320/v1/chat/completions";

function info() {
  return {
    npmProxy: true,
    npmPackage: "openburnbar",
    npmWhat: "Local OpenAI-compatible gateway on port 8320, MCP stdio, obbresume, Pensieve memory, and optional Mac app install.",
    proxy: {
      daemon: DAEMON_URL,
      grokD: GROKD_URL,
    },
    install: {
      proxy: "npx -y --ignore-scripts openburnbar@0.2.0 proxy --port 8320",
      macApp: "npx -y --ignore-scripts openburnbar@0.2.0 app install",
      launch: "open -a OpenBurnBar",
      pointGrokD: "node ~/.grok/grokbot-d/model-lib.js set grok-4.6 openburnbar",
    },
    routes: {
      grokD: "GET http://127.0.0.1:1337/install/openburnbar",
    },
  };
}

if (require.main === module) {
  console.log(JSON.stringify(info(), null, 2));
}

module.exports = { DAEMON_PORT, GROKD_PORT, info };
