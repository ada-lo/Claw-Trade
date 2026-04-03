export { createPipeline } from "./create-pipeline.js";

export { buildAllowedTradeEnvelope, buildOversizedTradeEnvelope, buildSuspiciousInputEnvelope } from "./demo-scenarios.js";
export {
  TRADE_TOOL_NAME,
  createOpenClawPlugin,
  createOpenClawTradeTool,
  beforeToolCall,
  before_tool_call,
  executeApprovedIntent
} from "./openclaw/plugin.js";
