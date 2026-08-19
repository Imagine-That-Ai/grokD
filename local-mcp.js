// D-only local MCP bridge. It makes the selected public marketplace connectors
// visible to the local host and executes their remote MCP endpoints directly.
// Secrets are read from macOS Keychain and are never written to logs/config JSON.

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { tryParse } = require("./protoutil");

const KEYCHAIN_ACCOUNT = "alberto-local";
const MEM0_SERVICE = "grokd-mem0-api-key";
const X_TOKEN_SERVICE = "grokd-x-token";
const GITHUB_TOKEN_SERVICE = "grokd-github-token";
const GOOGLE_TOKEN_SERVICE = "grokd-google-token";
const GOOGLE_CLIENT_SERVICE = "OpenBurnBar Windows Google OAuth";
const CALLBACK_URI = "http://localhost:8787/callback";
const MCP_PROTOCOL = "2025-03-26";
const X_CLIENT_ID = "NGdZYmo4VVp2T1BnRG55NlExOGQ6MTpjaQ";
const X_SCOPES = [
  "tweet.read", "users.read", "follows.read", "space.read", "mute.read",
  "like.read", "list.read", "block.read", "bookmark.read", "offline.access",
];
const GOOGLE_READ_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
const OAUTH_CONFIG = {
  notion: {
    authorizationEndpoint: "https://mcp.notion.com/authorize",
    tokenEndpoint: "https://mcp.notion.com/token",
    registrationEndpoint: "https://mcp.notion.com/register",
    scope: "default",
  },
  stripe: {
    authorizationEndpoint: "https://access.stripe.com/mcp/oauth2/authorize",
    tokenEndpoint: "https://access.stripe.com/mcp/oauth2/token",
    registrationEndpoint: "https://access.stripe.com/mcp/oauth2/register",
  },
  cloudflare: {
    scope: "",
  },
  sentry: {
    authorizationEndpoint: "https://mcp.sentry.dev/oauth/authorize",
    tokenEndpoint: "https://mcp.sentry.dev/oauth/token",
    registrationEndpoint: "https://mcp.sentry.dev/oauth/register",
    scope: "org:read",
    resource: "https://mcp.sentry.dev/mcp",
  },
  linear: {
    authorizationEndpoint: "https://mcp.linear.app/authorize",
    tokenEndpoint: "https://mcp.linear.app/token",
    registrationEndpoint: "https://mcp.linear.app/register",
    scope: "read",
    resource: "https://mcp.linear.app/mcp",
  },
  render: {
    authorizationEndpoint: "https://api.render.com/v1/oauth/authorize",
    tokenEndpoint: "https://api.render.com/v1/oauth/token",
    scope: "",
    resource: "https://mcp.render.com/mcp",
  },
  amplitude: {
    authorizationEndpoint: "https://mcp.amplitude.com/authorize",
    tokenEndpoint: "https://mcp.amplitude.com/token",
    registrationEndpoint: "https://mcp.amplitude.com/register",
    scope: "mcp:read offline_access",
    resource: "https://mcp.amplitude.com",
  },
  resend: {
    authorizationEndpoint: "https://api.resend.com/oauth/authorize",
    tokenEndpoint: "https://api.resend.com/oauth/token",
    registrationEndpoint: "https://api.resend.com/oauth/register",
    scope: "full_access",
    resource: "https://mcp.resend.com",
  },
};

const SERVERS = {
  x: {
    id: 49086599,
    pluginId: 49086599,
    name: "x",
    displayName: "X",
    url: "https://api.x.com/mcp",
    kind: "x",
  },
  github: {
    id: 48677658,
    pluginId: 48677658,
    name: "github",
    displayName: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    kind: "github",
  },
  "google-drive": {
    id: 45893413,
    pluginId: 45893413,
    name: "google-drive",
    displayName: "Google Drive",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    kind: "google",
  },
  "google-calendar": {
    id: 45893411,
    pluginId: 45893411,
    name: "google-calendar",
    displayName: "Google Calendar",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    kind: "google",
  },
  sentry: {
    id: 579,
    pluginId: 579,
    name: "sentry",
    displayName: "Sentry",
    url: "https://mcp.sentry.dev/mcp?utm_source=plugin",
    kind: "sentry",
  },
  linear: {
    id: 512,
    pluginId: 512,
    name: "linear",
    displayName: "Linear",
    url: "https://mcp.linear.app/mcp",
    kind: "linear",
  },
  render: {
    id: 1295,
    pluginId: 1295,
    name: "render",
    displayName: "Render",
    url: "https://mcp.render.com/mcp",
    kind: "render",
  },
  amplitude: {
    id: 786,
    pluginId: 786,
    name: "amplitude",
    displayName: "Amplitude",
    url: "https://mcp.amplitude.com/mcp",
    kind: "amplitude",
  },
  resend: {
    id: 5188,
    pluginId: 5188,
    name: "resend",
    displayName: "Resend",
    url: "https://mcp.resend.com/mcp",
    kind: "resend",
  },
  gmail: {
    id: 45893410,
    pluginId: 45893410,
    name: "gmail",
    displayName: "Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    kind: "google",
  },
  mem0: {
    id: 5648,
    pluginId: 5648,
    name: "mem0",
    displayName: "Mem0",
    url: "https://mcp.mem0.ai/mcp/",
    kind: "mem0",
  },
  notion: {
    id: 404,
    pluginId: 404,
    name: "notion",
    displayName: "Notion",
    url: "https://mcp.notion.com/mcp",
    kind: "notion",
  },
  stripe: {
    id: 408,
    pluginId: 408,
    name: "stripe",
    displayName: "Stripe",
    url: "https://mcp.stripe.com",
    kind: "stripe",
  },
  "cloudflare-docs": {
    id: 407,
    pluginId: 407,
    name: "cloudflare-docs",
    displayName: "Cloudflare Docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    kind: "cloudflare-public",
  },
  "cloudflare-bindings": {
    id: 4071,
    pluginId: 407,
    name: "cloudflare-bindings",
    displayName: "Cloudflare Bindings",
    url: "https://bindings.mcp.cloudflare.com/mcp",
    kind: "cloudflare",
  },
  "cloudflare-builds": {
    id: 4072,
    pluginId: 407,
    name: "cloudflare-builds",
    displayName: "Cloudflare Builds",
    url: "https://builds.mcp.cloudflare.com/mcp",
    kind: "cloudflare",
  },
  "cloudflare-observability": {
    id: 4073,
    pluginId: 407,
    name: "cloudflare-observability",
    displayName: "Cloudflare Observability",
    url: "https://observability.mcp.cloudflare.com/mcp",
    kind: "cloudflare",
  },
};

const ACCOUNT_SLOTS = {
  x: [
    { key: "alberto8793", service: X_TOKEN_SERVICE },
    { key: "x-2", service: `${X_TOKEN_SERVICE}-2` },
    { key: "x-3", service: `${X_TOKEN_SERVICE}-3` },
    { key: "cubelove.ai", service: `${X_TOKEN_SERVICE}-4` },
  ],
  github: [{ key: "default", service: GITHUB_TOKEN_SERVICE }],
  google: [
    { key: "alberto8793", service: `${GOOGLE_TOKEN_SERVICE}-1` },
    { key: "gmail-2", service: `${GOOGLE_TOKEN_SERVICE}-2` },
  ],
  mem0: [{ key: "default", service: null }],
  notion: [{ key: "default", service: "grokd-notion-token" }],
  stripe: [{ key: "default", service: "grokd-stripe-token" }],
  cloudflare: [{ key: "default", service: "grokd-cloudflare-token" }],
  sentry: [{ key: "default", service: "grokd-sentry-token" }],
  linear: [{ key: "default", service: "grokd-linear-token" }],
  render: [{ key: "default", service: "grokd-render-token" }],
  amplitude: [{ key: "default", service: "grokd-amplitude-token" }],
  resend: [{ key: "default", service: "grokd-resend-token" }],
};
const byId = new Map(Object.values(SERVERS).map((s) => [String(s.id), s]));
const sessions = new Map();
const toolCache = new Map();
const pendingOAuth = new Map();
const googleRefreshes = new Map();
const invalidAuth = new Set();
let rpcCounter = 100;
let cachedSecrets = new Map();

function keychainGet(service) {
  if (cachedSecrets.has(service)) return cachedSecrets.get(service);
  try {
    const value = execFileSync("security", ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value) cachedSecrets.set(service, value);
    return value || null;
  } catch {
    return null;
  }
}

function keychainGetForAccount(account, service) {
  try {
    const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function keychainSet(service, value) {
  if (!value) return false;
  try {
    execFileSync("security", ["add-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", service, "-w", value, "-U"], {
      stdio: "ignore",
    });
    cachedSecrets.set(service, value);
    return true;
  } catch {
    return false;
  }
}

function parseTokenPayload(raw) {
  if (!raw) return null;
  for (const candidate of [raw, /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, "hex").toString("utf8") : null]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return { access_token: raw };
}

function readToken(service) {
  return parseTokenPayload(keychainGet(service));
}

function saveToken(service, token) {
  return keychainSet(service, JSON.stringify(token));
}

function normalizeAccountKey(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function slotsForKind(kind) {
  return ACCOUNT_SLOTS[kind] || [{ key: "default", service: null }];
}

function slotFor(spec) {
  const slots = slotsForKind(spec.kind);
  const key = normalizeAccountKey(spec.accountKey || slots[0].key);
  return slots.find((slot) => slot.key === key) || slots[0];
}

function accountSpec(base, accountKey) {
  const slot = slotFor({ ...base, accountKey });
  const key = slot.key;
  return {
    ...base,
    accountKey: key,
    serverIdentifier: key === "default" ? base.name : `${base.name}--${key}`,
    runtimeName: key === "default" ? base.name : `${base.name}--${key}`,
    keychainService: slot.service,
  };
}

function resolveSpec(identifier) {
  const value = String(identifier || "");
  for (const base of Object.values(SERVERS)) {
    if (value === base.name || value === String(base.id)) return accountSpec(base);
    const prefix = `${base.name}--`;
    if (value.startsWith(prefix)) return accountSpec(base, value.slice(prefix.length));
  }
  return null;
}

function accountSpecs(base) {
  return slotsForKind(base.kind).map((slot) => accountSpec(base, slot.key));
}

function mem0Key() {
  return process.env.MEM0_API_KEY || keychainGet(MEM0_SERVICE);
}

function tokenServiceFor(spec) {
  const slot = slotFor(spec);
  if (spec.kind === "cloudflare" && spec.name) {
    const suffix = String(spec.name).replace(/^cloudflare-/, "");
    return `${X_TOKEN_SERVICE.replace("x-token", "cloudflare-token")}-${suffix}`;
  }
  return slot.service || (spec.kind === "google" ? GOOGLE_TOKEN_SERVICE : null);
}

function tokenFor(spec) {
  if (!["x", "github", "google", "notion", "stripe", "cloudflare", "sentry", "linear", "render", "amplitude", "resend"].includes(spec.kind)) return null;
  const service = tokenServiceFor(spec);
  if (!service) return null;
  const token = readToken(service);
  return token ? { ...token, _keychainService: service } : null;
}

function tokenUsable(token) {
  if (!token?.access_token) return false;
  if (!token.expires_at && !token.expires_in) return true;
  const expiry = token.expires_at || (token.created_at || Date.now()) + Number(token.expires_in) * 1000;
  return Number.isFinite(expiry) && expiry > Date.now() + 30_000;
}

function hasAuth(spec) {
  if (spec.kind === "mem0") return Boolean(mem0Key());
  if (spec.kind === "cloudflare-public") return true;
  const runtimeName = spec.runtimeName || spec.name;
  if (invalidAuth.has(runtimeName)) return false;
  const token = tokenFor(spec);
  return tokenUsable(token) || (["google", "notion", "stripe", "cloudflare", "sentry", "linear", "render", "amplitude", "resend"].includes(spec.kind) && Boolean(token?.refresh_token));
}

function oauthConfigFor(spec) {
  if (spec.kind === "google") return { authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token" };
  if (spec.kind === "cloudflare") {
    const origin = new URL(spec.url).origin;
    return {
      authorizationEndpoint: `${origin}/oauth/authorize`,
      tokenEndpoint: `${origin}/token`,
      registrationEndpoint: `${origin}/register`,
      resource: spec.url,
    };
  }
  const configured = OAUTH_CONFIG[spec.kind] || {};
  return { ...configured, resource: configured.resource || spec.url };
}

async function ensureRefreshableToken(spec) {
  const current = tokenFor(spec);
  if (!current || tokenUsable(current) || !current.refresh_token) return current;
  const service = current._keychainService || slotFor(spec).service;
  const config = oauthConfigFor(spec);
  const tokenEndpoint = current.token_endpoint || config.tokenEndpoint;
  if (!tokenEndpoint) return current;
  if (googleRefreshes.has(service)) return googleRefreshes.get(service);
  const params = {
    refresh_token: current.refresh_token,
    grant_type: "refresh_token",
    client_id: current.client_id,
  };
  if (current.client_secret) params.client_secret = current.client_secret;
  const promise = (async () => {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok || !data.access_token) throw new Error(data.error_description || `${spec.displayName} token refresh failed (${response.status})`);
    const updated = { ...current, ...data, token_endpoint: tokenEndpoint, created_at: Date.now(), expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
    delete updated._keychainService;
    saveToken(service, updated);
    return { ...updated, _keychainService: service };
  })().finally(() => googleRefreshes.delete(service));
  googleRefreshes.set(service, promise);
  return promise;
}

async function ensureToken(spec) {
  if (["google", "notion", "stripe", "cloudflare"].includes(spec.kind)) return ensureRefreshableToken(spec);
  return tokenFor(spec);
}

function varint(value) {
  let n = BigInt(value);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return Buffer.from(out);
}

function field(no, wireType, value) {
  return Buffer.concat([varint((no << 3) | wireType), value]);
}
function pbBytes(no, value) {
  const b = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return field(no, 2, Buffer.concat([varint(b.length), b]));
}
function pbStr(no, value) { return pbBytes(no, String(value)); }
function pbInt(no, value) { return field(no, 0, varint(value)); }
function pbBool(no, value) { return value ? pbInt(no, 1) : Buffer.alloc(0); }
function pbMsg(no, value) { return pbBytes(no, value); }

function pbValue(value) {
  if (value === null || value === undefined) return pbInt(1, 0);
  if (typeof value === "number") {
    const b = Buffer.alloc(8); b.writeDoubleLE(value, 0); return field(2, 1, b);
  }
  if (typeof value === "string") return pbStr(3, value);
  if (typeof value === "boolean") return pbBool(4, value);
  if (Array.isArray(value)) return pbMsg(6, Buffer.concat(value.map((v) => pbMsg(1, pbValue(v)))));
  if (typeof value === "object") return pbMsg(5, pbStruct(value));
  return pbStr(3, String(value));
}
function pbStruct(value) {
  const entries = [];
  for (const [key, val] of Object.entries(value || {})) {
    entries.push(pbMsg(1, Buffer.concat([pbStr(1, key), pbMsg(2, pbValue(val))])));
  }
  return Buffer.concat(entries);
}

function unwrapProto(body) {
  if (body.length >= 5 && body[0] === 0) {
    const n = body.readUInt32BE(1);
    if (n <= body.length - 5) return body.subarray(5, 5 + n);
  }
  return body;
}

function decodeStruct(buf) {
  const fields = tryParse(buf) || [];
  const out = {};
  for (const f of fields) {
    if (f.fieldNo !== 1 || f.wireType !== 2) continue;
    const entry = tryParse(f.value) || [];
    let key = null, value = null;
    for (const ef of entry) {
      if (ef.fieldNo === 1 && ef.wireType === 2) key = ef.value.toString("utf8");
      if (ef.fieldNo === 2 && ef.wireType === 2) value = decodeValue(ef.value);
    }
    if (key != null) out[key] = value;
  }
  return out;
}
function decodeValue(buf) {
  const fields = tryParse(buf) || [];
  for (const f of fields) {
    if (f.fieldNo === 1) return null;
    if (f.fieldNo === 2 && f.wireType === 1) return f.value.readDoubleLE(0);
    if (f.fieldNo === 3 && f.wireType === 2) return f.value.toString("utf8");
    if (f.fieldNo === 4 && f.wireType === 0) return Number(f.value) !== 0;
    if (f.fieldNo === 5 && f.wireType === 2) return decodeStruct(f.value);
    if (f.fieldNo === 6 && f.wireType === 2) {
      return (tryParse(f.value) || []).filter((x) => x.fieldNo === 1 && x.wireType === 2).map((x) => decodeValue(x.value));
    }
  }
  return null;
}

function configFor(spec) {
  const config = { type: "http", url: spec.url };
  if (spec.kind === "x") {
    config.auth = { CLIENT_ID: X_CLIENT_ID, scopes: X_SCOPES };
  } else if (spec.kind === "github") {
    config.headers = { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" };
  } else if (spec.kind === "mem0") {
    // Keep the secret out of the account config. The bridge injects it at call time.
    config.headers = { Authorization: "Token ${MEM0_API_KEY}" };
  }
  return config;
}
function allConfig() {
  return { mcpServers: Object.fromEntries(Object.values(SERVERS).map((s) => [s.name, configFor(s)])) };
}

function encodeAvailableServer(spec) {
  const parts = [
    pbInt(1, spec.id),
    pbStr(2, spec.name),
    pbBool(4, true),
    pbStr(5, "http"),
    pbStr(8, spec.url),
    pbInt(9, spec.pluginId),
    pbBool(11, accountSpecs(spec).some((account) => hasAuth(account))),
    pbStr(15, spec.name),
  ];
  for (const account of accountSpecs(spec)) {
    parts.push(pbMsg(17, Buffer.concat([
      pbStr(1, account.accountKey),
      pbStr(2, account.serverIdentifier),
      pbBool(3, hasAuth(account)),
    ])));
  }
  return Buffer.concat(parts);
}
function availableServersResponse() {
  return Buffer.concat(Object.values(SERVERS).map((s) => pbMsg(1, encodeAvailableServer(s))));
}

function metadataEntry(spec) {
  return pbMsg(2, Buffer.concat([pbStr(1, spec.name), pbMsg(2, Buffer.concat([pbInt(1, spec.pluginId), pbInt(2, spec.id)]))]));
}
function mcpConfigResponse() {
  const json = JSON.stringify(allConfig());
  return Buffer.concat([pbStr(1, json), ...Object.values(SERVERS).map(metadataEntry)]);
}

function pluginConfigResponse(pluginId) {
  const spec = [...byId.values()].find((s) => s.pluginId === Number(pluginId));
  const cfg = spec ? { mcpServers: { [spec.name]: configFor(spec) } } : { mcpServers: {} };
  return Buffer.concat([pbStr(1, JSON.stringify(cfg)), pbStr(2, "local-grokd")]);
}

function userInstallResponse(pluginId) {
  const now = Date.now();
  return pbMsg(1, Buffer.concat([
    pbInt(1, 1), pbInt(2, pluginId), pbBool(4, true), pbInt(6, now), pbInt(7, now),
  ]));
}

function authHeaders(spec) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL,
  };
  if (spec.kind === "mem0") {
    const key = mem0Key();
    if (key) headers.authorization = `Token ${key}`;
  } else {
    const token = tokenFor(spec);
    if (tokenUsable(token)) headers.authorization = `Bearer ${token.access_token}`;
  }
  const session = sessions.get(spec.runtimeName || spec.name);
  if (session?.id) headers["Mcp-Session-Id"] = session.id;
  return headers;
}

function parseRpcResponse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  let result = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try { result = JSON.parse(data); } catch {}
  }
  return result;
}

async function mcpRequest(spec, method, params, options = {}) {
  const sessionKey = spec.runtimeName || spec.name;
  const state = sessions.get(sessionKey) || { initialized: false };
  if (!state.initialized && method !== "initialize") {
    const init = await mcpRequest(spec, "initialize", {
      protocolVersion: MCP_PROTOCOL,
      capabilities: {},
      clientInfo: { name: "grokd-local", version: "1.0" },
    }, { allowInit: true });
    if (init.httpStatus >= 400 || init.error) return init;
    const initializedState = sessions.get(sessionKey) || state;
    initializedState.initialized = true;
    sessions.set(sessionKey, initializedState);
    await mcpRequest(spec, "notifications/initialized", {}, { notification: true, allowInit: true }).catch(() => {});
  }
  const id = options.notification ? undefined : ++rpcCounter;
  const body = { jsonrpc: "2.0", method, params: params || {} };
  if (id !== undefined) body.id = id;
  let response;
  try {
    await ensureToken(spec);
    response = await fetch(spec.url, {
      method: "POST",
      headers: authHeaders(spec),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (error) {
    return { httpStatus: 599, error: error.message || String(error) };
  }
  const text = await response.text();
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) {
    state.id = sessionId;
    sessions.set(sessionKey, state);
  }
  const parsed = parseRpcResponse(text);
  if (!response.ok) return { httpStatus: response.status, headers: Object.fromEntries(response.headers), raw: text, rpc: parsed };
  if (parsed?.error) return { httpStatus: response.status, error: parsed.error.message || JSON.stringify(parsed.error), rpc: parsed };
  return { httpStatus: response.status, rpc: parsed, raw: text };
}

function isAuthFailure(result) {
  return result?.httpStatus === 401 || result?.httpStatus === 403 || /authentication|authorization|insufficient.*scope|unauthorized/i.test(result?.error || result?.raw || "");
}

async function listTools(spec) {
  const cacheKey = spec.runtimeName || spec.name;
  const cached = toolCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const result = await mcpRequest(spec, "tools/list", {});
  if (result.rpc?.result?.tools) {
    invalidAuth.delete(cacheKey);
    const out = { ...result, tools: result.rpc.result.tools, expiresAt: Date.now() + 10 * 60_000 };
    toolCache.set(cacheKey, out);
    return out;
  }
  if (isAuthFailure(result)) invalidAuth.add(cacheKey);
  return result;
}

function encodeTool(tool, spec) {
  const schema = tool.inputSchema || { type: "object", properties: {} };
  return Buffer.concat([
    pbStr(1, tool.name || "unknown"),
    pbStr(4, spec.serverIdentifier || spec.name),
    pbStr(5, tool.name || "unknown"),
    pbStr(2, (tool.description || "").slice(0, 20_000)),
    pbMsg(3, pbStruct(schema)),
  ]);
}
function encodeToolServer(spec, status, tools) {
  return Buffer.concat([
    pbStr(1, spec.serverIdentifier || spec.name), pbStr(2, status),
    ...tools.map((tool) => pbMsg(3, encodeTool(tool, spec))),
    pbStr(4, spec.accountKey || "default"), pbStr(5, spec.name),
  ]);
}

function mcpResultSuccess(text, isError = false, structuredContent) {
  const item = pbMsg(1, pbStr(1, text));
  return pbMsg(1, Buffer.concat([item, pbBool(2, isError), structuredContent ? pbMsg(3, pbStruct(structuredContent)) : Buffer.alloc(0)]));
}
function mcpResultError(text) { return pbMsg(2, pbStr(1, text)); }

function resultText(rpc) {
  const result = rpc?.result;
  if (!result) return "";
  if (Array.isArray(result.content)) {
    return result.content.map((x) => x?.text || (x?.type ? `[${x.type}]` : "")).filter(Boolean).join("\n");
  }
  return JSON.stringify(result);
}

function googleClientCredentials() {
  const clientId = keychainGetForAccount("client_id", GOOGLE_CLIENT_SERVICE);
  const clientSecret = keychainGetForAccount("client_secret", GOOGLE_CLIENT_SERVICE);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function oauthClientFor(spec) {
  const client = readToken(`grokd-oauth-client-${spec.name}`);
  if (!client?.client_id) return null;
  return client;
}

function authUrlFor(spec) {
  const state = crypto.randomBytes(18).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const accountKey = normalizeAccountKey(spec.accountKey);
  const pending = { server: spec.name, kind: spec.kind, accountKey, verifier, createdAt: Date.now() };
  let endpoint;
  const u = new URL(spec.kind === "x" ? "https://x.com/i/oauth2/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", CALLBACK_URI);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (spec.kind === "x") {
    u.searchParams.set("client_id", X_CLIENT_ID);
    u.searchParams.set("scope", X_SCOPES.join(" "));
  } else if (spec.kind === "google") {
    const client = googleClientCredentials();
    if (!client) return null;
    endpoint = "https://oauth2.googleapis.com/token";
    pending.clientId = client.clientId; pending.clientSecret = client.clientSecret; pending.tokenEndpoint = endpoint;
    u.searchParams.set("client_id", client.clientId);
    u.searchParams.set("scope", GOOGLE_READ_SCOPES.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
  } else if (["notion", "stripe", "cloudflare", "sentry", "linear", "render", "amplitude", "resend"].includes(spec.kind)) {
    const client = oauthClientFor(spec);
    const config = oauthConfigFor(spec);
    if (!client?.client_id || !config.authorizationEndpoint) return null;
    endpoint = config.tokenEndpoint;
    pending.clientId = client.client_id; pending.clientSecret = client.client_secret; pending.tokenEndpoint = endpoint; pending.resource = config.resource || spec.url;
    u.href = config.authorizationEndpoint;
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    u.searchParams.set("client_id", client.client_id);
    u.searchParams.set("redirect_uri", CALLBACK_URI);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    if (config.scope) u.searchParams.set("scope", config.scope);
    if (pending.resource) u.searchParams.set("resource", pending.resource);
  } else {
    return null;
  }
  pendingOAuth.set(state, pending);
  return u.toString();
}

async function exchangeXCode(code, pending) {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: X_CLIENT_ID,
    redirect_uri: CALLBACK_URI,
    code_verifier: pending.verifier,
  });
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || !data.access_token) throw new Error(data.error_description || `X token exchange failed (${response.status})`);
  const service = slotFor({ kind: "x", accountKey: pending.accountKey }).service || X_TOKEN_SERVICE;
  saveToken(service, { ...data, created_at: Date.now(), expires_at: Date.now() + Number(data.expires_in || 7200) * 1000 });
  const scoped = accountSpec(SERVERS.x, pending.accountKey);
  sessions.delete(scoped.runtimeName); toolCache.delete(scoped.runtimeName);
}

async function exchangeGoogleCode(code, pending) {
  const client = googleClientCredentials();
  if (!client) throw new Error("Google OAuth client credentials are not configured");
  const body = new URLSearchParams({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: CALLBACK_URI,
    grant_type: "authorization_code",
    code_verifier: pending.verifier,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || !data.access_token) throw new Error(data.error_description || `Google token exchange failed (${response.status})`);
  const service = slotFor({ kind: "google", accountKey: pending.accountKey }).service;
  saveToken(service, { ...data, client_id: client.clientId, client_secret: client.clientSecret, created_at: Date.now(), expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 });
  for (const base of [SERVERS["google-drive"], SERVERS["google-calendar"], SERVERS.gmail]) {
    const scoped = accountSpec(base, pending.accountKey);
    sessions.delete(scoped.runtimeName); toolCache.delete(scoped.runtimeName);
  }
}

async function exchangeOAuthCode(code, pending) {
  const params = new URLSearchParams({
    code,
    client_id: pending.clientId,
    redirect_uri: CALLBACK_URI,
    grant_type: "authorization_code",
    code_verifier: pending.verifier,
  });
  if (pending.clientSecret) params.set("client_secret", pending.clientSecret);
  if (pending.resource) params.set("resource", pending.resource);
  const response = await fetch(pending.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const data = parseTokenPayload(text) || {};
  if (!response.ok || !data.access_token) throw new Error(data.error_description || `${pending.server} token exchange failed (${response.status})`);
  const base = SERVERS[pending.server];
  const service = tokenServiceFor(accountSpec(base, pending.accountKey));
  saveToken(service, {
    ...data,
    client_id: pending.clientId,
    ...(pending.clientSecret ? { client_secret: pending.clientSecret } : {}),
    token_endpoint: pending.tokenEndpoint,
    created_at: Date.now(),
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
  });
  if (base) {
    const scoped = accountSpec(base, pending.accountKey);
    sessions.delete(scoped.runtimeName); toolCache.delete(scoped.runtimeName); invalidAuth.delete(scoped.runtimeName);
  }
}

async function handleOAuthCallback(query) {
  const state = query.get("state");
  const pending = state ? pendingOAuth.get(state) : null;
  if (!pending) return { status: 400, body: "Unknown or expired OAuth state." };
  pendingOAuth.delete(state);
  if (query.get("error")) return { status: 400, body: `OAuth denied: ${query.get("error")}` };
  try {
    if (pending.server === "x") {
      await exchangeXCode(query.get("code") || "", pending);
      return { status: 200, body: "X authorization completed. You can close this window and refresh Grok D." };
    }
    if (pending.server === "google-drive" || pending.server === "google-calendar" || pending.server === "gmail") {
      await exchangeGoogleCode(query.get("code") || "", pending);
      return { status: 200, body: "Google authorization completed. You can close this window and refresh Grok D." };
    }
    if (["notion", "stripe", "cloudflare-bindings", "cloudflare-builds", "cloudflare-observability", "sentry", "linear", "render", "amplitude", "resend"].includes(pending.server)) {
      await exchangeOAuthCode(query.get("code") || "", pending);
      return { status: 200, body: `${pending.server} authorization completed. You can close this window and refresh Grok D.` };
    }
  } catch (error) {
    return { status: 500, body: `OAuth authorization failed: ${error.message}` };
  }
  return { status: 400, body: "Unsupported local OAuth connector." };
}

function statusResponse(serverIds, accountKey) {
  const statuses = [];
  for (const id of serverIds) {
    const base = byId.get(String(id));
    if (!base) continue;
    const spec = accountSpec(base, accountKey || slotsForKind(base.kind)[0].key);
    const authed = hasAuth(spec);
    const parts = [pbInt(1, base.id), pbBool(2, true), pbBool(3, !authed), pbBool(6, authed)];
    if (!authed && ["x", "google", "notion", "stripe", "cloudflare", "sentry", "linear", "render", "amplitude", "resend"].includes(spec.kind)) {
      const url = authUrlFor(spec);
      if (url) parts.push(pbStr(4, url));
    }
    statuses.push(pbMsg(1, Buffer.concat(parts)));
  }
  return Buffer.concat(statuses);
}

function serverIdsFromRequest(body) {
  return (tryParse(unwrapProto(body)) || []).filter((f) => f.fieldNo === 1 && f.wireType === 0).map((f) => Number(f.value));
}
function accountKeyFromRequest(body) {
  return stringField(body, 8) || "";
}
function serverIdentifiersFromRequest(body) {
  return (tryParse(unwrapProto(body)) || []).filter((f) => f.fieldNo === 1 && f.wireType === 2).map((f) => f.value.toString("utf8"));
}
function stringField(body, fieldNo) {
  return (tryParse(unwrapProto(body)) || []).find((f) => f.fieldNo === fieldNo && f.wireType === 2)?.value.toString("utf8") || "";
}
function messageField(body, fieldNo) {
  return (tryParse(unwrapProto(body)) || []).find((f) => f.fieldNo === fieldNo && f.wireType === 2)?.value || null;
}

async function listToolsResponse(body) {
  const identifiers = serverIdentifiersFromRequest(body);
  const out = [];
  for (const identifier of identifiers) {
    const spec = resolveSpec(identifier);
    if (!spec) continue;
    const result = await listTools(spec);
    if (result.tools) out.push(pbMsg(1, encodeToolServer(spec, "connected", result.tools)));
    else if (isAuthFailure(result)) out.push(pbMsg(1, encodeToolServer(spec, "needsAuth", [])));
    else out.push(pbMsg(1, encodeToolServer(spec, "error", [])));
  }
  return Buffer.concat(out);
}

async function executeToolResponse(body) {
  const serverId = stringField(body, 1);
  const toolName = stringField(body, 2);
  const spec = resolveSpec(serverId);
  if (!spec) return pbMsg(1, mcpResultError(`Unknown local MCP server: ${serverId}`));
  const args = decodeStruct(messageField(body, 3) || Buffer.alloc(0));
  const result = await mcpRequest(spec, "tools/call", { name: toolName, arguments: args });
  if (result.rpc?.result) {
    const rpcResult = result.rpc.result;
    const text = resultText(result.rpc);
    return pbMsg(1, mcpResultSuccess(text, rpcResult.isError === true, rpcResult.structuredContent));
  }
  if (isAuthFailure(result)) {
    const hint = spec.kind === "x" ? "Connect X in Grok D first." : spec.kind === "google" ? "Authorize Google Drive/Calendar in the isolated D flow first." : "Configure the Mem0 API key.";
    return pbMsg(1, mcpResultSuccess(`${spec.displayName} needs authorization. ${hint}`, true));
  }
  return pbMsg(1, mcpResultError(result.error || result.raw || `MCP call failed (${result.httpStatus || "unknown"})`));
}

function effectivePluginResponse() {
  // An empty effective-plugin list is valid; installed status is attributed
  // from the local MCP rows (plugin_id) by the host's marketplace view.
  return Buffer.alloc(0);
}

// JSON-level tool listing for the bridge's local GetMcpTools.
async function listServerTools(serverId) {
  const spec = resolveSpec(String(serverId));
  if (!spec) return { ok: false, error: `Unknown MCP server: ${serverId}` };
  const result = await listTools(spec);
  if (result.tools) {
    return { ok: true, tools: result.tools.map((t) => ({ name: t.name, description: (t.description || "").slice(0, 200), inputSchema: t.inputSchema })) };
  }
  return { ok: false, error: result.error || `Could not list tools (${result.httpStatus || "unknown"})` };
}
async function callTool(serverId, toolName, args) {
  const spec = resolveSpec(String(serverId));
  if (!spec) return { ok: false, error: `Unknown local MCP server: ${serverId}` };
  const result = await mcpRequest(spec, "tools/call", { name: toolName, arguments: args || {} });
  if (result.rpc?.result) {
    const text = resultText(result.rpc);
    return { ok: result.rpc.result.isError !== true, text, raw: result };
  }
  if (isAuthFailure(result)) return { ok: false, error: `${spec.displayName} needs authorization — connect it in Grok D first.` };
  return { ok: false, error: result.error || result.raw || `MCP call failed (${result.httpStatus || "unknown"})` };
}

async function handleBackendRpc(url, body) {
  const clean = url.split("?")[0];
  if (/GetAvailableMcpServers$/.test(clean)) return availableServersResponse();
  if (/GetMcpConfig$|GetEffectiveMcpConfigForUser$/.test(clean)) return mcpConfigResponse();
  if (/GetPluginMcpConfig$/.test(clean)) return pluginConfigResponse(Number((tryParse(unwrapProto(body)) || []).find((f) => f.fieldNo === 1 && f.wireType === 0)?.value || 0));
  if (/BatchGetPluginMcpConfig$/.test(clean)) return Buffer.alloc(0);
  if (/GetEffectiveUserPlugins$/.test(clean)) return effectivePluginResponse();
  if (/InstallUserPlugin$|UpdateUserPluginInstall$/.test(clean)) {
    const id = Number((tryParse(unwrapProto(body)) || []).find((f) => f.fieldNo === 1 && f.wireType === 0)?.value || 0);
    return userInstallResponse(id);
  }
  if (/ListSandMcpTools$/.test(clean)) return await listToolsResponse(body);
  if (/ExecuteSandMcpTool$/.test(clean)) return await executeToolResponse(body);
  if (/CheckHttpMcpStatus$/.test(clean)) return statusResponse(serverIdsFromRequest(body), accountKeyFromRequest(body));
  if (/ValidateMcpOAuthTokens$/.test(clean)) {
    const results = [];
    for (const f of (tryParse(unwrapProto(body)) || []).filter((x) => x.fieldNo === 3 && x.wireType === 2)) {
      const urlValue = stringField(f.value, 1);
      const requestedAccount = stringField(f.value, 2);
      const base = Object.values(SERVERS).find((s) => s.url === urlValue);
      const spec = base ? accountSpec(base, requestedAccount || slotsForKind(base.kind)[0].key) : null;
      results.push(pbMsg(1, Buffer.concat([pbStr(1, urlValue), pbBool(2, Boolean(spec && hasAuth(spec))), pbStr(3, spec?.accountKey || requestedAccount || "default")])));
    }
    return Buffer.concat(results);
  }
  if (/StoreMcpOAuthToken$/.test(clean)) {
    // The local bridge owns tokens; accepting this RPC keeps the host's
    // standard OAuth completion path compatible if it is used later.
    return Buffer.concat([pbInt(2, 1), pbInt(1, Date.now())]);
  }
  if (/DeleteMcpOAuthToken$/.test(clean)) return Buffer.alloc(0);
  return null;
}

module.exports = {
  SERVERS,
  CALLBACK_URI,
  handleBackendRpc,
  handleOAuthCallback,
  authUrlFor,
  mem0Key,
  hasAuth,
  callTool,
  listServerTools,
};
