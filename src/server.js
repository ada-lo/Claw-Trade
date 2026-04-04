import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { EventEmitter } from "node:events";

import { createPipeline } from "./create-pipeline.js";
import {
  buildAllowedTradeEnvelope,
  buildOversizedTradeEnvelope,
  buildSuspiciousInputEnvelope
} from "./demo-scenarios.js";

const GLASSBOX_DIR = resolve(import.meta.dirname, "glassbox");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

/* ─── Helpers ─── */

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    request.on("error", reject);
  });
}

async function serveStatic(request, response, urlPath) {
  const safePath = urlPath.replace(/\.\./g, "").replace(/^\/+/, "");
  const filePath = join(GLASSBOX_DIR, safePath || "index.html");
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) { sendJson(response, 404, { error: "Not found" }); return; }
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    const data = await readFile(filePath);
    response.writeHead(200, { "content-type": mime, "cache-control": "no-cache" });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

/* ─── Pipeline & Scenarios ─── */

const pipeline = await createPipeline();

// Event bus for SSE streaming
const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(50);

const scenarios = {
  allowed: {
    name: "Allowed Trade",
    description: "Buy 10 AAPL at $170 — within all policy limits",
    build: () => buildAllowedTradeEnvelope()
  },
  oversized: {
    name: "Oversized Trade",
    description: "Buy 100 AAPL at $170 with $9k spent — exceeds daily limit & shares cap",
    build: () => buildOversizedTradeEnvelope()
  },
  suspicious: {
    name: "Suspicious Input",
    description: "Contains prompt injection markers — blocked by DataTrust L1",
    build: () => buildSuspiciousInputEnvelope()
  }
};

/* ─── HTTP Server ─── */

const server = http.createServer(async (request, response) => {
  // CORS
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    response.end();
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // ─── SSE Stream ───
    if (request.method === "GET" && url.pathname === "/api/stream") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*"
      });

      // Send initial connection event
      response.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

      // Listen for pipeline events
      const onEvent = (data) => {
        if (!response.destroyed) {
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      pipelineEvents.on("event", onEvent);

      // Keepalive
      const keepalive = setInterval(() => {
        if (!response.destroyed) {
          response.write(": keepalive\n\n");
        }
      }, 15000);

      request.on("close", () => {
        pipelineEvents.off("event", onEvent);
        clearInterval(keepalive);
      });

      return;
    }

    // ─── API Routes ───
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        policy_profile: pipeline.policy.profile,
        execution_mode: pipeline.config.executionMode
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/policy") {
      sendJson(response, 200, pipeline.policy);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/scenarios") {
      const list = {};
      for (const [key, s] of Object.entries(scenarios)) {
        list[key] = { name: s.name, description: s.description, envelope: s.build() };
      }
      sendJson(response, 200, list);
      return;
    }

    // Process intent with real-time streaming via SSE
    if (request.method === "POST" && url.pathname === "/api/process") {
      const body = await readJson(request);
      const envelope = body.scenario
        ? scenarios[body.scenario]?.build()
        : body.envelope;

      if (!envelope) {
        sendJson(response, 400, { error: "No envelope or unknown scenario" });
        return;
      }

      // Emit start event to all SSE clients
      pipelineEvents.emit("event", { type: "pipeline:start", envelope });

      try {
        const decision = await pipeline.processIntent(envelope, {
          onLayer(entry) {
            pipelineEvents.emit("event", { type: "pipeline:layer", entry });
          }
        });

        const result = {
          allowed: decision.allowed,
          blocked_by: decision.blocked_by ?? null,
          reasons: decision.reasons ?? [],
          execution: decision.execution ?? null,
          audit_hash: decision.audit_record?.entry_hash ?? null,
          layer_trace: decision.layer_trace ?? []
        };

        pipelineEvents.emit("event", { type: "pipeline:complete", decision: result });
        sendJson(response, decision.allowed ? 200 : 403, result);
      } catch (error) {
        pipelineEvents.emit("event", { type: "pipeline:error", error: error.message });
        sendJson(response, 500, { error: error.message });
      }
      return;
    }

    // Relay endpoint: receives pipeline events from OpenClaw gateway plugin
    if (request.method === "POST" && url.pathname === "/api/glassbox-relay") {
      const event = await readJson(request);
      if (event.type) {
        pipelineEvents.emit("event", event);
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    // Legacy endpoints
    if (request.method === "POST" && url.pathname === "/evaluate") {
      const envelope = await readJson(request);
      const decision = await pipeline.evaluateIntent(envelope);
      sendJson(response, 200, decision);
      return;
    }

    if (request.method === "POST" && url.pathname === "/process") {
      const envelope = await readJson(request);
      const decision = await pipeline.processIntent(envelope);
      sendJson(response, decision.allowed ? 200 : 403, decision);
      return;
    }

    // ─── Static Files ───
    if (request.method === "GET") {
      await serveStatic(request, response, url.pathname);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(pipeline.config.port, () => {
  const port = pipeline.config.port;
  process.stdout.write(
    JSON.stringify({
      listening_on: port,
      execution_mode: pipeline.config.executionMode,
      glassbox_ui: `http://localhost:${port}/`
    }, null, 2)
  );
});
