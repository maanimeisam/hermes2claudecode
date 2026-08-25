// ---- element helpers ----
const $ = (id) => document.getElementById(id);
const state = {
  running: false,
  hasToken: false,
  enabled: false,
  logFilter: "all",
  es: null,
  initialized: false,
};

const logIcons = { info: "ℹ", success: "✓", warning: "⚠", error: "✕" };
const logLabels = { info: "INFO", success: " OK ", warning: "WARN", error: "ERR " };

// ---- toast ----
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast " + kind), 2600);
}

// ---- log rendering ----
function addLog(entry) {
  const stream = $("logStream");
  const line = document.createElement("div");
  line.className = `log-line ${entry.level}`;
  const time = new Date(entry.t).toLocaleTimeString([], { hour12: false });
  line.innerHTML = `<span class="lt">${time}</span><span class="li">${logLabels[entry.level] ?? "INFO"}</span><span class="lm"></span>`;
  line.querySelector(".lm").textContent = entry.msg;
  if (state.logFilter !== "all" && state.logFilter !== entry.level) line.style.display = "none";
  stream.appendChild(line);
  while (stream.children.length > 500) stream.removeChild(stream.firstChild);
  stream.scrollTop = stream.scrollHeight;
  updateLogCount();
}
function updateLogCount() {
  const n = [...$("logStream").children].filter((c) => c.style.display !== "none").length;
  $("logCount").textContent = `${n} entries`;
}

// event-stream log + status
function connectStream() {
  const es = new EventSource("/api/stream");
  state.es = es;
  es.onopen = () => {
    $("connState").textContent = "live";
    $("connState").classList.add("live");
  };
  es.onerror = () => {
    $("connState").textContent = "reconnecting…";
    $("connState").classList.remove("live");
  };
  es.addEventListener("status", (e) => applyStatus(JSON.parse(e.data)));
  es.onmessage = (e) => {
    try { addLog(JSON.parse(e.data)); } catch {}
  };
}

// ---- status application ----
function applyStatus(s) {
  state.running = s.running;
  state.hasToken = !!s.token;
  state.enabled = s.running;

  // master toggle reflects running state
  $("masterSwitch").checked = s.running;
  $("masterLabel").textContent = s.running ? "ON" : "OFF";

  const pill = $("statePill");
  pill.classList.toggle("on", s.running);
  $("stateText").textContent = s.running ? "Active" : "Inactive";

  const rb = $("runningBadge");
  rb.textContent = s.running ? `Running · pid ${s.pid}` : "Stopped";
  rb.className = "badge " + (s.running ? "green" : "");

  // the Service card stays interactive so users can configure before starting
  $("serviceHint").textContent = s.running
    ? "Service is running. Flip the switch to stop it."
    : "Flip the master switch above to start the service.";

  // auth
  const ab = $("authBadge");
  if (s.token) {
    ab.textContent = "Authorized";
    ab.className = "badge green";
    $("tokenInfo").hidden = false;
    $("tokenScope").textContent = s.token.scope ?? "—";
    $("tokenExpiry").textContent = s.token.expires_at
      ? new Date(s.token.expires_at).toLocaleString([], { hour12: false })
      : "—";
  } else {
    ab.textContent = "No token";
    ab.className = "badge red";
    $("tokenInfo").hidden = true;
  }

  // config fields
  if (s.config) {
    $("cfg-host").value = s.config.host ?? "";
    $("cfg-port").value = s.config.port ?? 8317;
    $("cfg-debug").checked = !!s.config.debug;
    $("cfg-tls").checked = !!s.config.tlsEnable;
    $("cfg-proxy").value = s.config.proxyUrl ?? "";
  }

  // provider key set flags
  if (s.config?.providerKeys) {
    for (const p of ["claude", "gemini", "codex"]) {
      const flag = $(`set-${p}`);
      const has = !!s.config.providerKeys[p];
      if (flag) {
        flag.textContent = has ? "SET" : "";
        flag.classList.toggle("show", has);
      }
    }
  }

  // binary presence
  if (!s.binaryPresent) {
    $("serviceHint").textContent = "Binary not installed — click Update binary first.";
  }
}

// ---- api helper ----
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function withSpinner(btn, fn) {
  const spin = btn.querySelector("[data-spin]");
  spin.classList.remove("hidden");
  btn.disabled = true;
  return fn().finally(() => {
    spin.classList.add("hidden");
    btn.disabled = false;
  });
}

// ---- actions ----
$("masterSwitch").addEventListener("change", async (e) => {
  const on = e.target.checked;
  try {
    if (on) {
      await withSpinner($("updateBtn"), () => api("/api/start", { method: "POST", body: { tui: $("tuiMode").checked } }));
      toast("Service starting…", "ok");
    } else {
      await api("/api/stop", { method: "POST" });
      toast("Service stopping…");
    }
  } catch (err) {
    e.target.checked = state.running; // revert on failure
    toast(err.message, "err");
  }
});

$("updateBtn").addEventListener("click", async () => {
  try {
    await withSpinner($("updateBtn"), () => api("/api/install", { method: "POST" }));
    toast("Update started — watch the log panel.", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

$("authBtn").addEventListener("click", async () => {
  try {
    await withSpinner($("authBtn"), () => api("/api/device-flow", { method: "POST", body: { open: $("openBrowser").checked } }));
    toast("Authorization complete.", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

$("saveKeysBtn").addEventListener("click", async () => {
  const keys = {
    claude: $("key-claude").value,
    gemini: $("key-gemini").value,
    codex: $("key-codex").value,
  };
  try {
    await withSpinner($("saveKeysBtn"), () => api("/api/provider-keys", { method: "POST", body: keys }));
    toast("Provider keys saved.", "ok");
    for (const p of ["claude", "gemini", "codex"]) $(`key-${p}`).value = "";
  } catch (err) {
    toast(err.message, "err");
  }
});

$("saveCfgBtn").addEventListener("click", async () => {
  const cfg = {
    host: $("cfg-host").value.trim(),
    port: Number($("cfg-port").value),
    debug: $("cfg-debug").checked,
    tlsEnable: $("cfg-tls").checked,
    proxyUrl: $("cfg-proxy").value.trim(),
  };
  try {
    await withSpinner($("saveCfgBtn"), () => api("/api/config", { method: "POST", body: cfg }));
    toast("Configuration applied.", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

// log filters
$("logFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.logFilter = btn.dataset.level;
  [...$("logFilters").children].forEach((b) => b.classList.toggle("active", b === btn));
  [...$("logStream").children].forEach((l) => {
    l.style.display = state.logFilter === "all" || l.classList.contains(state.logFilter) ? "" : "none";
  });
  updateLogCount();
});

$("clearLogs").addEventListener("click", () => {
  $("logStream").innerHTML = "";
  updateLogCount();
});

// ---- boot ----
connectStream();
api("/api/status").then((s) => {
  if (!state.initialized) { applyStatus(s); state.initialized = true; }
}).catch(() => {});
