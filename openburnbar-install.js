"use strict";

// Honest install contract for grokD. The published `openburnbar` npm package
// is MCP / resume / memory / Mac-app install. It does not start the local
// OpenAI-compatible gateway. That gateway is the native OpenBurnBar daemon
// (127.0.0.1:8317). grokD's `openburnbar` target still talks to :8320.

const DAEMON_PORT = 8317;
const GROKD_PORT = 8320;

function info() {
  return {
    npmProxy: false,
    npmPackage: "openburnbar",
    npmWhat: "MCP stdio, obbresume, Pensieve memory, `app install` of the notarized Mac app. Not the local /v1/chat/completions proxy.",
    proxy: {
      daemon: `http://127.0.0.1:${DAEMON_PORT}/v1/chat/completions`,
      grokD: `http://127.0.0.1:${GROKD_PORT}/v1/chat/completions`,
    },
    install: {
      macApp: "npx -y openburnbar app install",
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
