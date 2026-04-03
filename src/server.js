import http from "node:http";

import { createPipeline } from "./create-pipeline.js";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const pipeline = await createPipeline();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        status: "ok",
        policy_profile: pipeline.policy.profile,
        execution_mode: pipeline.config.executionMode
      });
      return;
    }

    if (request.method === "POST" && request.url === "/evaluate") {
      const envelope = await readJson(request);
      const decision = await pipeline.evaluateIntent(envelope);
      sendJson(response, 200, decision);
      return;
    }

    if (request.method === "POST" && request.url === "/process") {
      const envelope = await readJson(request);
      const decision = await pipeline.processIntent(envelope);
      sendJson(response, decision.allowed ? 200 : 403, decision);
      return;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message
    });
  }
});

server.listen(pipeline.config.port, () => {
  process.stdout.write(
    JSON.stringify(
      {
        listening_on: pipeline.config.port,
        execution_mode: pipeline.config.executionMode
      },
      null,
      2
    )
  );
});
