import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPipeline } from "../src/index.js";
import {
  buildAllowedTradeEnvelope,
  buildOversizedTradeEnvelope,
  buildSuspiciousInputEnvelope
} from "../src/demo-scenarios.js";

async function createTestPipeline() {
  const tempRoot = await mkdtemp(join(tmpdir(), "claw-trade-"));
  const pipeline = await createPipeline({
    EXECUTION_MODE: "dry-run",
    FORMAL_VERIFY_MODE: "js",
    AUDIT_LOG_PATH: join(tempRoot, "audit", "events.jsonl"),
    NONCE_STORE_PATH: join(tempRoot, "state", "nonces.json")
  });

  return { pipeline, tempRoot };
}

test("allows an in-policy paper-trade intent in dry-run mode", async () => {
  const { pipeline, tempRoot } = await createTestPipeline();
  const result = await pipeline.processIntent(buildAllowedTradeEnvelope());

  assert.equal(result.allowed, true);
  assert.equal(result.execution.simulated, true);

  const auditContents = await readFile(join(tempRoot, "audit", "events.jsonl"), "utf8");
  assert.match(auditContents, /"allowed":true/);
});

test("blocks oversized trade attempts before execution", async () => {
  const { pipeline } = await createTestPipeline();
  const result = await pipeline.processIntent(buildOversizedTradeEnvelope());

  assert.equal(result.allowed, false);
  assert.equal(result.blocked_by, "formal_verifier");
  assert.match(result.unsat_core.join(","), /single_order_limit|daily_limit|portfolio_exposure_limit/);
});

test("blocks prompt-injection style inputs in the data-trust layer", async () => {
  const { pipeline } = await createTestPipeline();
  const result = await pipeline.processIntent(buildSuspiciousInputEnvelope());

  assert.equal(result.allowed, false);
  assert.equal(result.blocked_by, "data_trust");
  assert.match(result.reasons[0], /Suspicious prompt-injection markers/);
});

test("blocks replayed signed intents with duplicate nonces", async () => {
  const { pipeline } = await createTestPipeline();
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
});

test("trips the behavioral monitor on runaway loops", async () => {
  const { pipeline } = await createTestPipeline();
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
});
