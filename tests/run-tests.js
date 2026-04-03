import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPipeline } from "../src/index.js";
import {
  buildAllowedTradeEnvelope,
  buildOversizedTradeEnvelope,
  buildSuspiciousInputEnvelope
} from "../src/demo-scenarios.js";

function createFetchResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

async function createTestPipeline(fetchImpl) {
  const tempRoot = await mkdtemp(join(tmpdir(), "claw-trade-"));
  const pipeline = await createPipeline({
    EXECUTION_MODE: "dry-run",
    FORMAL_VERIFY_MODE: "strict",
    Z3_VERIFIER_URL: "http://verifier.test",
    AUDIT_LOG_PATH: join(tempRoot, "audit", "events.jsonl"),
    NONCE_STORE_PATH: join(tempRoot, "state", "nonces.json"),
    fetchImpl
  });

  return { pipeline, tempRoot };
}

const cases = [
  {
    name: "allows an in-policy paper-trade intent in dry-run mode",
    async run() {
      const { pipeline, tempRoot } = await createTestPipeline(async () =>
        createFetchResponse({
          allowed: true,
          reason: "SAT: intent satisfies all policy constraints"
        })
      );
      const result = await pipeline.processIntent(buildAllowedTradeEnvelope());

      assert.equal(result.allowed, true);
      assert.equal(result.execution.simulated, true);
      assert.equal(result.layer_trace[3].status, "PASS");

      const auditContents = await readFile(
        join(tempRoot, "audit", "events.jsonl"),
        "utf8"
      );
      assert.match(auditContents, /"allowed":true/);
    }
  },
  {
    name: "blocks oversized trade attempts before execution",
    async run() {
      const { pipeline } = await createTestPipeline(async () =>
        createFetchResponse({
          allowed: false,
          reason: "UNSAT: trade would exceed daily limit ($26,000 > $10,000)"
        })
      );
      const result = await pipeline.processIntent(buildOversizedTradeEnvelope());

      assert.equal(result.allowed, false);
      assert.equal(result.blocked_by, "formal_verifier");
      assert.match(result.unsat_core[0], /exceed daily limit/);
    }
  },
  {
    name: "blocks prompt-injection style inputs in the data-trust layer",
    async run() {
      const { pipeline } = await createTestPipeline(async () =>
        createFetchResponse({
          allowed: true,
          reason: "SAT: intent satisfies all policy constraints"
        })
      );
      const result = await pipeline.processIntent(buildSuspiciousInputEnvelope());

      assert.equal(result.allowed, false);
      assert.equal(result.blocked_by, "data_trust");
      assert.match(result.reasons[0], /Suspicious prompt-injection markers/);
    }
  },
  {
    name: "blocks replayed signed intents with duplicate nonces",
    async run() {
      const { pipeline } = await createTestPipeline(async () =>
        createFetchResponse({
          allowed: true,
          reason: "SAT: intent satisfies all policy constraints"
        })
      );
      const nonce = "replay-demo-nonce";

      const first = await pipeline.processIntent(
        buildAllowedTradeEnvelope({
          nonce
        })
      );
      const second = await pipeline.processIntent(
        buildAllowedTradeEnvelope({
          nonce
        })
      );

      assert.equal(first.allowed, true);
      assert.equal(second.allowed, false);
      assert.equal(second.blocked_by, "execution_proxy");
      assert.match(second.reasons[0], /Replay protection blocked duplicate nonce/);
    }
  },
  {
    name: "trips the behavioral monitor on runaway loops",
    async run() {
      const { pipeline } = await createTestPipeline(async () =>
        createFetchResponse({
          allowed: true,
          reason: "SAT: intent satisfies all policy constraints"
        })
      );
      let lastResult = null;

      for (let index = 0; index < 6; index += 1) {
        lastResult = await pipeline.processIntent(
          buildAllowedTradeEnvelope({
            nonce: `loop-${index}`,
            id: `intent-${index}`
          })
        );
      }

      assert.equal(lastResult.allowed, false);
      assert.equal(lastResult.blocked_by, "behavior_monitor");
    }
  },
  {
    name: "fails closed when the verifier is unreachable",
    async run() {
      const { pipeline } = await createTestPipeline(async () => {
        throw new Error("connect ECONNREFUSED verifier.test:5001");
      });
      const result = await pipeline.processIntent(buildAllowedTradeEnvelope());

      assert.equal(result.allowed, false);
      assert.equal(result.blocked_by, "formal_verifier");
      assert.match(result.reasons[0], /Formal verifier HTTP request failed/);
    }
  }
];

let passed = 0;
for (const testCase of cases) {
  try {
    await testCase.run();
    passed += 1;
    process.stdout.write(`PASS ${testCase.name}\n`);
  } catch (error) {
    process.stdout.write(`FAIL ${testCase.name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write(`\n${passed}/${cases.length} checks passed\n`);
