import { createPipeline } from "./create-pipeline.js";
import {
  buildAllowedTradeEnvelope,
  buildOversizedTradeEnvelope
} from "./demo-scenarios.js";

const scenario = process.argv[2] ?? "allowed";
const pipeline = await createPipeline({
  EXECUTION_MODE: process.env.EXECUTION_MODE ?? "dry-run",
  FORMAL_VERIFY_MODE: process.env.FORMAL_VERIFY_MODE ?? "fallback"
});

const envelope =
  scenario === "blocked"
    ? buildOversizedTradeEnvelope()
    : buildAllowedTradeEnvelope();

const result = await pipeline.processIntent(envelope);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
