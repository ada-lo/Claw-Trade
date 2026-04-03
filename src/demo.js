import { createPipeline } from "./create-pipeline.js";
import {
  buildAllowedTradeEnvelope,
  buildOversizedTradeEnvelope
} from "./demo-scenarios.js";

function formatTraceEntry(entry) {
  const iconByStatus = {
    PASS: "✅",
    SIGNED: "✅",
    "DRY-RUN": "✅",
    RECORDED: "✅",
    BLOCKED: "❌"
  };
  const icon = iconByStatus[entry.status] ?? "•";
  const suffix = entry.detail ? ` — ${entry.detail}` : "";
  return `${entry.layer} ${entry.name}: ${icon} ${entry.status}${suffix}`;
}

const scenario = process.argv[2] ?? "allowed";
const pipeline = await createPipeline({
  EXECUTION_MODE: process.env.EXECUTION_MODE ?? "dry-run",
  FORMAL_VERIFY_MODE: process.env.FORMAL_VERIFY_MODE ?? "strict"
});

const envelope =
  scenario === "blocked"
    ? buildOversizedTradeEnvelope()
    : buildAllowedTradeEnvelope();

const result = await pipeline.processIntent(envelope);
for (const entry of result.layer_trace ?? []) {
  process.stdout.write(`${formatTraceEntry(entry)}\n`);
}
process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
