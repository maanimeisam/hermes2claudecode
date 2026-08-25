import express from "express";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, isScalar, isSeq } from "yaml";
import got from "got";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOOLS_DIR = path.join(ROOT, "tools");
const BINARY = path.join(TOOLS_DIR, "cli-proxy-api");
const CONFIG_PATH = path.join(TOOLS_DIR, "config.yaml");
const TOKENS_PATH = path.join(ROOT, "data", "tokens.json");
const WEB_INSTALL = path.join(ROOT, "src", "web-install.ts");
const PROVIDERS = ["claude", "gemini", "codex"];
const OAUTH_BASE = "https://portal.nousresearch.com/api/oauth";

const PORT = Number(process.env.WEB_PORT ?? 4173);

// ---- server process lifecycle (ponytail: single child process, all access serial) ----
let child = null;
const log = [];
const MAX_LOG = 500;

function pushLog(level, msg) {
  const entry = { t: new Date().toISOString(), level, msg };
  log.push(entry);
  if (log.length > MAX_LOG) log.shift();
  for (const res of clients) res.write(`data: ${JSON.stringify(entry)}\n\n`);
}

const clients = new Set();

// ---- config helpers ----
function configExists() {
  return fs.existsSync(CONFIG_PATH);
}
function readConfigDoc() {
  if (!configExists())
    throw new Error("tools/config.yaml not found — run the CLI once to create it");
  return parseDocument(fs.readFileSync(CONFIG_PATH, "utf8"));
}
function writeConfigDoc(doc) {
  fs.writeFileSync(CONFIG_PATH, doc.toString(), "utf8");
}
function getScalar(key, doc) {
  const node = doc.contents.get?.(key, true);
  return isScalar(node) ? node.value : undefined;
}
function setScalar(key, value) {
  const doc = readConfigDoc();
  const node = doc.contents.get?.(key, true);
  if (isScalar(node)) node.value = value;
  else doc.set(key, value);
  writeConfigDoc(doc);
}
function getNested(prefix, key) {
  const doc = readConfigDoc();
  const node = doc.get(prefix, true);
  const v = node?.get?.(key, true);
  return isScalar(v) ? v.value : undefined;
}
function setNested(prefix, key, value) {
  const doc = readConfigDoc();
  let node = doc.get(prefix, true);
  if (!node) {
    node = doc.createNode({});
    doc.set(prefix, node);
  }
  const existing = node.get?.(key, true);
  if (isScalar(existing)) existing.value = value;
  else node.set(key, value);
  writeConfigDoc(doc);
}

// ---- status ----
function status() {
  const binaryPresent = fs.existsSync(BINARY);
  let token = null;
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      token = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    } catch {
      token = null;
    }
  }
  let cfg = { host: "", port: 8317, tlsEnable: false, debug: false, proxyUrl: "", apiKeys: [], providerKeys: {} };
  if (configExists()) {
    const doc = readConfigDoc();
    const providerKeys = {};
    for (const p of PROVIDERS) {
      const seq = doc.get(`${p}-api-key`, true);
      providerKeys[p] = isSeq(seq) && seq.items.some((i) => i?.has?.("api-key"));
    }
    cfg = {
      host: getScalar("host", doc) ?? "",
      port: getScalar("port", doc) ?? 8317,
      tlsEnable: getNested("tls", "enable") ?? false,
      debug: getScalar("debug", doc) ?? false,
      proxyUrl: getScalar("proxy-url", doc) ?? "",
      apiKeys: (() => {
        const seq = doc.get("api-keys", true);
        return isSeq(seq) ? seq.toJSON() : [];
      })(),
      providerKeys,
    };
  }
  return {
    running: child !== null && !child.killed,
    pid: child?.pid ?? null,
    binaryPresent,
    token: token
      ? {
          access_token: (token.access_token ?? "").slice(0, 14) + "…",
          scope: token.scope,
          expires_at: token.expires_at ?? null,
        }
      : null,
    config: cfg,
  };
}

// ---- process control ----
function startProxy(args = {}) {
  if (child && !child.killed)
    throw new Error("CLIProxyAPI is already running");
  if (!fs.existsSync(BINARY))
    throw new Error("Binary not installed — update it first");

  const argv = [BINARY, "-config", CONFIG_PATH];
  if (args.tui) argv.push("--tui");
  pushLog("info", `Spawning: ${argv.join(" ")}`);
  child = cp.spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });

  child.stdout.on("data", (d) =>
    String(d)
      .trim()
      .split("\n")
      .forEach((l) => l && pushLog("info", l)),
  );
  child.stderr.on("data", (d) =>
    String(d)
      .trim()
      .split("\n")
      .forEach((l) => l && pushLog("error", l)),
  );
  child.on("exit", (code, signal) => {
    pushLog(code === 0 ? "info" : "warning", `Process exited (code=${code ?? signal})`);
    child = null;
    broadcastStatus();
  });
  broadcastStatus();
}

function stopProxy() {
  if (!child || child.killed) throw new Error("CLIProxyAPI is not running");
  const pid = child.pid;
  child.kill("SIGTERM");
  pushLog("info", `Sent SIGTERM to pid ${pid}`);
}

function broadcastStatus() {
  for (const res of clients) {
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
  }
}

// ---- provider keys ----
function providerApiKey(provider) {
  const doc = readConfigDoc();
  const seq = doc.get(`${provider}-api-key`, true);
  if (isSeq(seq) && seq.items.length) {
    const first = seq.items.find((i) => i?.has?.("api-key"));
    if (first) return first.get("api-key", true)?.value ?? "";
  }
  return "";
}
function setProviderApiKey(provider, apiKey) {
  const doc = readConfigDoc();
  const key = `${provider}-api-key`;
  const entry = doc.createNode({ "api-key": apiKey });
  const seq = doc.get(key, true);
  if (!seq?.items?.length) {
    doc.set(key, doc.createNode([entry]));
  } else {
    const existing = seq.items.find((i) => i?.has?.("api-key"));
    if (existing) existing.set("api-key", apiKey);
    else seq.add(entry);
  }
  writeConfigDoc(doc);
}

// ---- device flow ----
const deviceClient = got.extend({
  https: { rejectUnauthorized: false },
  throwHttpErrors: false,
  retry: { limit: 0 },
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
});
const clientId = "hermes-cli";
const scope = "inference:invoke";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runDeviceFlow(opts) {
  const device = await deviceClient
    .post(`${OAUTH_BASE}/device/code`, { body: `client_id=${clientId}&scope=${encodeURIComponent(scope)}` })
    .json();
  pushLog("info", `Device code issued. Enter ${device.user_code} at the verification URL.`);
  if (opts.open) {
    try {
      const { open } = await import("open");
      await open(device.verification_uri_complete ?? device.verification_uri);
      pushLog("info", "Opened verification URL in browser.");
    } catch (err) {
      pushLog("warning", `Could not auto-open browser: ${err.message}`);
    }
  }
  const started = Date.now();
  while (true) {
    if (Date.now() - started > (device.expires_in ?? 300) * 1000) {
      const e = new Error("Device code expired before authorization completed");
      pushLog("error", e.message);
      throw e;
    }
    await sleep((device.interval ?? 5) * 1000);
    const r = await deviceClient.post(`${OAUTH_BASE}/token`, {
      body: `grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${clientId}&device_code=${device.device_code}`,
    });
    if (r.statusCode === 200) {
      const tok = await r.json();
      tok.expires_at = Date.now() + (tok.expires_in ?? 0) * 1000;
      fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(tok, null, 2), { mode: 0o600 });
      pushLog("success", "Authorization successful — token stored.");
      broadcastStatus();
      return tok;
    }
    let err = {};
    try {
      err = await r.json();
    } catch {}
    if (err.error === "authorization_pending" || err.error === "slow_down") continue;
    pushLog("error", `Authorization failed: ${err.error ?? r.statusCode}`);
    throw new Error(err.error_description ?? err.error ?? "authorization failed");
  }
}

// ---- express ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => res.json(status()));
app.get("/api/logs", (_req, res) => res.json(log));

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
  res.write(`data: ${JSON.stringify({ t: new Date().toISOString(), level: "info", msg: "Connected to live log stream." })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.post("/api/provider-keys", (req, res) => {
  try {
    const keys = req.body ?? {};
    for (const p of PROVIDERS) {
      if (typeof keys[p] === "string" && keys[p].trim() !== "")
        setProviderApiKey(p, keys[p].trim());
    }
    pushLog("success", "Provider API keys saved to config.yaml.");
    res.json({ ok: true });
  } catch (e) {
    pushLog("error", `Failed to save provider keys: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/config", (req, res) => {
  try {
    const b = req.body ?? {};
    if (b.host !== undefined) setScalar("host", b.host);
    if (b.port !== undefined) setScalar("port", Number(b.port));
    if (b.debug !== undefined) setScalar("debug", Boolean(b.debug));
    if (b.proxyUrl !== undefined) {
      const u = String(b.proxyUrl).trim();
      if (u !== "" && !/^(direct|none)$/i.test(u) && !/^(socks5|http|https):\/\//i.test(u))
        return res.status(400).json({ error: "Invalid proxy-url (use socks5/http/https://..., direct, none, or empty)" });
      setScalar("proxy-url", u);
    }
    if (b.tlsEnable !== undefined) setNested("tls", "enable", Boolean(b.tlsEnable));
    pushLog("success", "Server configuration updated.");
    broadcastStatus();
    res.json({ ok: true });
  } catch (e) {
    pushLog("error", `Failed to update config: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/device-flow", async (req, res) => {
  try {
    const tok = await runDeviceFlow({ open: Boolean(req.body?.open) });
    res.json({ ok: true, scope: tok.scope });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/start", (req, res) => {
  try {
    startProxy({ tui: Boolean(req.body?.tui) });
    res.json({ ok: true });
  } catch (e) {
    pushLog("error", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stop", (_req, res) => {
  try {
    stopProxy();
    res.json({ ok: true });
  } catch (e) {
    pushLog("error", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/install", (_req, res) => {
  // ponytail: delegate to existing tsx entry so download logic stays single-sourced.
  pushLog("info", "Updating CLIProxyAPI binary…");
  const proc = cp.spawn("pnpm", ["exec", "tsx", WEB_INSTALL], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) =>
    String(d).trim().split("\n").forEach((l) => l && pushLog("info", l)),
  );
  proc.stderr.on("data", (d) =>
    String(d).trim().split("\n").forEach((l) => l && pushLog("error", l)),
  );
  proc.on("exit", (code) => {
    if (code === 0) {
      pushLog("success", "Binary updated.");
      broadcastStatus();
    } else pushLog("error", `Update failed (exit ${code}).`);
  });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Hermes panel listening on http://localhost:${PORT}`);
  pushLog("info", `Hermes control panel started on port ${PORT}.`);
});
