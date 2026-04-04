/* ─── GlassBox Client ─── */
/* Real-time SSE pipeline visualizer */

const LAYER_STAGGER_MS = 180;
const API_BASE = "";

// ─── State ───
let eventSource = null;
let scenarios = {};
let auditHistory = [];
let activeFilter = "all";
let currentDecision = null;
let isRunning = false;

// ─── DOM Refs ───
const $status     = document.getElementById("connection-status");
const $statusLabel= $status.querySelector(".status-label");
const $policyProf = document.getElementById("policy-profile");
const $execMode   = document.getElementById("exec-mode");
const $scenCards  = document.getElementById("scenario-cards");
const $verdict    = document.getElementById("pipeline-verdict");
const $inspEmpty  = document.getElementById("inspector-empty");
const $inspContent= document.getElementById("inspector-content");
const $inspSummary= document.getElementById("inspector-summary");
const $inspJson   = document.getElementById("inspector-json");
const $copyJson   = document.getElementById("copy-json");
const $auditList  = document.getElementById("audit-list");
const $auditEmpty = document.getElementById("audit-empty");
const $clearAudit = document.getElementById("clear-audit");
const $toggleCustom = document.getElementById("toggle-custom");
const $customEditor = document.getElementById("custom-editor");
const $customJson   = document.getElementById("custom-json");
const $sendCustom   = document.getElementById("send-custom");

const allLayerNodes = document.querySelectorAll(".layer-node");

// ─── SSE Connection ───

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.onopen = () => {
    setConnectionStatus("connected", "Connected");
  };

  eventSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error("[GlassBox SSE] Parse error:", e);
    }
  };

  eventSource.onerror = () => {
    setConnectionStatus("error", "Reconnecting…");
  };
}

async function fetchScenarios() {
  try {
    const res = await fetch(`${API_BASE}/api/scenarios`);
    scenarios = await res.json();
    renderScenarioCards();
  } catch (e) {
    console.error("[GlassBox] Failed to fetch scenarios:", e);
  }
}

async function fetchPolicy() {
  try {
    const res = await fetch(`${API_BASE}/api/policy`);
    const policy = await res.json();
    $policyProf.textContent = policy.profile ?? "—";
    $execMode.textContent = policy.execution?.mode ?? "—";
  } catch (e) {
    console.error("[GlassBox] Failed to fetch policy:", e);
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "connected":
      break;
    case "pipeline:start":
      onPipelineStart(msg.envelope);
      break;
    case "pipeline:layer":
      onPipelineLayer(msg.entry);
      break;
    case "pipeline:complete":
      onPipelineComplete(msg.decision);
      break;
    case "pipeline:error":
      onPipelineError(msg.error);
      break;
  }
}

function setConnectionStatus(state, label) {
  $status.className = `connection-status ${state}`;
  $statusLabel.textContent = label;
}

// ─── Scenario Cards ───

function renderScenarioCards() {
  $scenCards.innerHTML = "";
  const icons = { allowed: "✅", oversized: "🚫", suspicious: "⚠️" };

  for (const [key, scenario] of Object.entries(scenarios)) {
    const card = document.createElement("div");
    card.className = "scenario-card";
    card.dataset.scenario = key;
    card.innerHTML = `
      <div class="sc-icon">${icons[key] ?? "📄"}</div>
      <div class="sc-name">${scenario.name}</div>
      <div class="sc-desc">${scenario.description}</div>
    `;
    card.addEventListener("click", () => runScenario(key));
    $scenCards.appendChild(card);
  }
}

async function runScenario(key) {
  if (isRunning) return;

  document.querySelectorAll(".scenario-card").forEach(c => c.classList.remove("active", "running"));
  const activeCard = document.querySelector(`[data-scenario="${key}"]`);
  activeCard?.classList.add("running");

  try {
    await fetch(`${API_BASE}/api/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: key })
    });
  } catch (e) {
    console.error("[GlassBox] Process failed:", e);
    isRunning = false;
    activeCard?.classList.remove("running");
  }
}

async function runCustomIntent() {
  if (isRunning) return;
  try {
    const envelope = JSON.parse($customJson.value);
    document.querySelectorAll(".scenario-card").forEach(c => c.classList.remove("active", "running"));

    await fetch(`${API_BASE}/api/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope })
    });
  } catch {
    alert("Invalid JSON in custom intent editor");
  }
}

// ─── Pipeline Animation ───

let layerQueue = [];
let layerTimer = null;

function onPipelineStart(envelope) {
  isRunning = true;
  currentDecision = null;
  layerQueue = [];
  if (layerTimer) { clearTimeout(layerTimer); layerTimer = null; }
  clearLayerStates();
  $verdict.textContent = "";
  $verdict.className = "pipeline-verdict";

  $inspEmpty.classList.add("hidden");
  $inspContent.classList.remove("hidden");
  $inspSummary.innerHTML = `
    <div class="summary-row">
      <span class="summary-label">Status</span>
      <span class="summary-value" style="color: var(--signed)">⏳ Processing…</span>
    </div>
    <div class="summary-row">
      <span class="summary-label">Intent</span>
      <span class="summary-value">${envelope.intent?.action ?? "?"} ${envelope.intent?.quantity ?? "?"} ${envelope.intent?.ticker ?? "?"}</span>
    </div>
  `;
  $inspJson.innerHTML = "";
}

function onPipelineLayer(entry) {
  layerQueue.push(entry);
  if (!layerTimer) {
    processNextLayer();
  }
}

function processNextLayer() {
  if (layerQueue.length === 0) {
    layerTimer = null;
    return;
  }

  const entry = layerQueue.shift();
  animateLayer(entry);

  layerTimer = setTimeout(processNextLayer, LAYER_STAGGER_MS);
}

function animateLayer(entry) {
  const node = document.querySelector(`.layer-node[data-layer="${entry.layer}"]`);
  if (!node) return;

  node.classList.add("processing");

  setTimeout(() => {
    node.classList.remove("processing");

    const statusClass = getStatusClass(entry.status);
    node.classList.add(statusClass);

    const iconEl = node.querySelector(".status-icon");
    iconEl.textContent = getStatusEmoji(entry.status);

    const detailEl = node.querySelector(".layer-detail-text");
    detailEl.textContent = entry.detail ?? entry.status;
  }, 120);
}

function onPipelineComplete(decision) {
  currentDecision = decision;

  const waitMs = layerQueue.length * LAYER_STAGGER_MS + 500;
  setTimeout(() => {
    isRunning = false;

    $verdict.textContent = decision.allowed ? "✓ ALLOWED" : "✕ BLOCKED";
    $verdict.className = `pipeline-verdict ${decision.allowed ? "allowed" : "blocked"}`;

    document.querySelectorAll(".scenario-card.running").forEach(c => {
      c.classList.remove("running");
      c.classList.add("active");
    });

    renderInspector(decision);
    addAuditEntry(decision);
  }, waitMs);
}

function onPipelineError(error) {
  isRunning = false;
  $verdict.textContent = "⚠ ERROR";
  $verdict.className = "pipeline-verdict blocked";
  document.querySelectorAll(".scenario-card.running").forEach(c => c.classList.remove("running"));

  $inspSummary.innerHTML = `
    <div class="summary-row">
      <span class="summary-label">Error</span>
      <span class="summary-value blocked">${escapeHtml(error)}</span>
    </div>
  `;
}

function clearLayerStates() {
  allLayerNodes.forEach(node => {
    node.classList.remove("active", "pass", "blocked", "signed", "dryrun", "recorded", "processing");
    node.querySelector(".status-icon").textContent = "●";
    node.querySelector(".layer-detail-text").textContent = "";
  });
}

function getStatusClass(status) {
  const map = { "PASS": "pass", "BLOCKED": "blocked", "SIGNED": "signed", "DRY-RUN": "dryrun", "RECORDED": "recorded" };
  return map[status] ?? "active";
}

function getStatusEmoji(status) {
  const map = { "PASS": "✓", "BLOCKED": "✕", "SIGNED": "🔑", "DRY-RUN": "⚡", "RECORDED": "📝" };
  return map[status] ?? "●";
}

// ─── Inspector ───

function renderInspector(decision) {
  const statusClass = decision.allowed ? "allowed" : "blocked";
  const statusLabel = decision.allowed ? "ALLOWED" : "BLOCKED";
  const blockedBy = decision.blocked_by ? ` by ${decision.blocked_by}` : "";

  let html = `
    <div class="summary-row">
      <span class="summary-label">Verdict</span>
      <span class="summary-value ${statusClass}">${statusLabel}${blockedBy}</span>
    </div>
  `;

  if (decision.reasons?.length) {
    html += `
      <div class="summary-row" style="flex-direction: column; align-items: flex-start; gap: 3px;">
        <span class="summary-label">Reasons</span>
        ${decision.reasons.map(r => `<span class="summary-value blocked" style="font-size:10px;word-break:break-all;">${escapeHtml(r)}</span>`).join("")}
      </div>
    `;
  }

  if (decision.audit_hash) {
    html += `
      <div class="summary-row">
        <span class="summary-label">Audit Hash</span>
        <span class="summary-value" style="font-size:9px;color:var(--text-dim);">${decision.audit_hash.slice(0, 16)}…</span>
      </div>
    `;
  }

  if (decision.execution) {
    html += `
      <div class="summary-row">
        <span class="summary-label">Execution</span>
        <span class="summary-value" style="color:var(--dryrun);">${decision.execution.simulated ? "DRY-RUN" : decision.execution.broker ?? "executed"}</span>
      </div>
    `;
  }

  $inspSummary.innerHTML = html;
  $inspJson.innerHTML = syntaxHighlightJson(JSON.stringify(decision, null, 2));
}

function syntaxHighlightJson(json) {
  return escapeHtml(json)
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
    .replace(/:\s*"([^"]*)"(\s*[,\n\r}])/g, ': <span class="json-string">"$1"</span>$2')
    .replace(/:\s*(-?\d+\.?\d*)\b/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false)\b/g, ': <span class="json-bool">$1</span>')
    .replace(/:\s*(null)\b/g, ': <span class="json-null">$1</span>');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Audit Trail ───

function addAuditEntry(decision) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    allowed: decision.allowed,
    blocked_by: decision.blocked_by ?? null,
    reasons: decision.reasons ?? [],
    audit_hash: decision.audit_hash ?? null,
    layer_trace: decision.layer_trace ?? []
  };

  entry.description = decision.allowed
    ? `Trade approved through all 9 layers`
    : `Blocked at ${decision.blocked_by ?? "unknown"}: ${(decision.reasons ?? [])[0]?.slice(0, 60) ?? ""}`;

  auditHistory.unshift(entry);
  renderAuditTrail();
}

function renderAuditTrail() {
  const filtered = activeFilter === "all"
    ? auditHistory
    : auditHistory.filter(e => activeFilter === "allowed" ? e.allowed : !e.allowed);

  $auditList.innerHTML = "";
  if (filtered.length === 0) {
    $auditList.innerHTML = '<div class="audit-empty">No matching entries</div>';
    return;
  }

  for (const entry of filtered) {
    const el = document.createElement("div");
    el.className = "audit-entry";
    el.innerHTML = `
      <span class="audit-icon">${entry.allowed ? "✅" : "❌"}</span>
      <span class="audit-time">${entry.time}</span>
      <span class="audit-desc">${escapeHtml(entry.description)}</span>
      <span class="audit-blocked-by ${entry.allowed ? "allowed-tag" : "blocked-tag"}">${entry.allowed ? "PASS" : entry.blocked_by ?? "BLOCKED"}</span>
      <span class="audit-hash">${entry.audit_hash?.slice(0, 10) ?? ""}</span>
    `;
    $auditList.appendChild(el);
  }
}

// ─── Event Listeners ───

$toggleCustom.addEventListener("click", () => {
  $customEditor.classList.toggle("hidden");
});

$sendCustom.addEventListener("click", runCustomIntent);

$copyJson.addEventListener("click", () => {
  if (currentDecision) {
    navigator.clipboard.writeText(JSON.stringify(currentDecision, null, 2))
      .then(() => { $copyJson.textContent = "✓"; setTimeout(() => { $copyJson.textContent = "📋"; }, 1500); })
      .catch(() => {});
  }
});

$clearAudit.addEventListener("click", () => {
  auditHistory = [];
  $auditList.innerHTML = '<div class="audit-empty">No decisions yet — run a scenario above</div>';
});

document.querySelectorAll(".audit-filters .btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".audit-filters .btn").forEach(b => b.classList.remove("filter-active"));
    btn.classList.add("filter-active");
    activeFilter = btn.dataset.filter;
    renderAuditTrail();
  });
});

// ─── Init ───
connectSSE();
fetchScenarios();
fetchPolicy();
