#!/usr/bin/env node
// Fake "cloud box" for Grok Bot — logs every request the app/daemon makes.
// Listens on the ports the real box uses: 1337, 1340, 6080, 6081.
const http = require("http");
const fs = require("fs");

const LOG = "/tmp/grokbot-box-calls.jsonl";
const DIR = "/tmp/grokbot-box-bodies";
fs.mkdirSync(DIR, { recursive: true });

let n = 0;
function makeServer(port) {
  const srv = http.createServer((req, res) => {
    const id = ++n;
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const entry = {
        id, port, ts: new Date().toISOString(),
        method: req.method, url: req.url,
        headers: { ...req.headers, authorization: req.headers.authorization ? req.headers.authorization.slice(0, 20) + "…" : undefined, "x-anyrun-network-token": req.headers["x-anyrun-network-token"] ? req.headers["x-anyrun-network-token"].slice(0, 12) + "…" : undefined },
        reqBytes: body.length,
      };
      if (body.length) {
        const safe = req.url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
        fs.writeFileSync(`${DIR}/${String(id).padStart(4, "0")}-${port}-${safe}.req.bin`, body.subarray(0, 65536));
      }
      fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
      console.log(`[box:${port}] ${req.method} ${req.url} (${body.length}B)`);
      // be permissive: empty 200, json or proto by accept
      const ct = (req.headers["content-type"] || "").includes("json") ? "application/json" : "application/proto";
      res.writeHead(200, { "content-type": ct });
      res.end(ct.includes("json") ? "{}" : Buffer.alloc(0));
    });
  });
  srv.on("upgrade", (req, socket) => {
    const id = ++n;
    fs.appendFileSync(LOG, JSON.stringify({ id, port, ts: new Date().toISOString(), wsUpgrade: true, url: req.url, headers: { ...req.headers, authorization: undefined } }) + "\n");
    console.log(`[box:${port}] WS-UPGRADE ${req.url}`);
    // accept websocket upgrade, then log frames passively (no real protocol yet)
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + require("crypto").createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64") + "\r\n\r\n");
    socket.on("data", (d) => {
      try { fs.appendFileSync(LOG, JSON.stringify({ wsFrame: true, port, url: req.url, bytes: d.length, hex: d.subarray(0, 200).toString("hex") }) + "\n"); } catch {}
    });
  });
  srv.listen(port, "127.0.0.1", () => console.log(`fake box listening on 127.0.0.1:${port}`));
}

for (const p of [1340, 6080, 6081]) makeServer(p);
console.log("log:", LOG);
