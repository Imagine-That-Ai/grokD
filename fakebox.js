#!/usr/bin/env node
// Fake "cloud box" for Grok Bot — logs every request the app/daemon makes.
// Listens on the ports the real box uses: 1337, 1340, 6080, 6081.
const http = require("http");
const path = require("path");
const paths = require("./paths");
const secGuard = require("./security-guard");

const LOG_DIR = secGuard.ensureDir0700(path.join(paths.ROOT, "logs"));
const LOG = path.join(LOG_DIR, "fakebox-calls.jsonl");
const BODIES_DIR = path.join(LOG_DIR, "fakebox-bodies");
const CAPTURE_BODIES = process.env.GROKBOT_DEBUG_BODIES === "1";
if (CAPTURE_BODIES) secGuard.ensureDir0700(BODIES_DIR);

function isAuthorized(req) {
  const auth = String(req.headers.authorization || "");
  return secGuard.verifyGatewayAuth(auth) || secGuard.verifyProxyBridgeAuth(auth);
}

function appendBoxLog(entry) {
  try {
    secGuard.appendFile0600(LOG, JSON.stringify(entry) + "\n");
  } catch (_) {}
}

const MAX_REQ_SIZE = 10 * 1024 * 1024; // 10MB limit

let n = 0;
function makeServer(port) {
  const srv = http.createServer((req, res) => {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
    const id = ++n;
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_REQ_SIZE) {
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_REQ_SIZE) return;
      const body = Buffer.concat(chunks);
      const ALLOWED_HEADERS = new Set(["content-type", "accept", "user-agent", "host", "content-length", "connect-protocol-version"]);
      const safeHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (ALLOWED_HEADERS.has(k.toLowerCase())) safeHeaders[k.toLowerCase()] = v;
      }
      const cleanUrl = (req.url || "").split("?")[0].split("#")[0];
      const entry = {
        id, port, ts: new Date().toISOString(),
        method: req.method, url: cleanUrl,
        headers: safeHeaders,
        reqBytes: body.length,
      };
      if (CAPTURE_BODIES && body.length) {
        const safe = cleanUrl.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
        secGuard.writeFile0600(`${BODIES_DIR}/${String(id).padStart(4, "0")}-${port}-${safe}.req.bin`, body.subarray(0, 65536));
      }
      appendBoxLog(entry);
      console.log(`[box:${port}] ${req.method} ${cleanUrl} (${body.length}B)`);
      // be permissive: empty 200, json or proto by accept
      const ct = (req.headers["content-type"] || "").includes("json") ? "application/json" : "application/proto";
      res.writeHead(200, { "content-type": ct });
      res.end(ct.includes("json") ? "{}" : Buffer.alloc(0));
    });
  });
  srv.maxConnections = 32;
  srv.on("error", (err) => {
    console.warn(`[fakebox:${port}] listener error: ${err.message}`);
  });
  srv.on("upgrade", (req, socket) => {
    if (!isAuthorized(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const id = ++n;
    const cleanWsUrl = (req.url || "").split("?")[0].split("#")[0];
    appendBoxLog({ id, port, ts: new Date().toISOString(), wsUpgrade: true, url: cleanWsUrl });
    console.log(`[box:${port}] WS-UPGRADE ${cleanWsUrl}`);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + require("crypto").createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64") + "\r\n\r\n");
    socket.on("data", (d) => {
      if (CAPTURE_BODIES) {
        appendBoxLog({ wsFrame: true, port, url: cleanWsUrl, bytes: d.length });
      }
    });
  });
  srv.listen(port, "127.0.0.1", () => console.log(`fake box listening on 127.0.0.1:${port}`));
}

for (const p of [1340, 6080, 6081]) makeServer(p);
console.log("log:", LOG);
