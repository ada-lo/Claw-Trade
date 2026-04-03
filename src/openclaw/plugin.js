import { randomUUID } from "node:crypto";

import { createPipeline } from "../create-pipeline.js";

let cachedPipeline = null;

function mapToolEventToEnvelope(event) {
  const tool = event.tool_name ?? event.tool ?? event.name ?? "unknown";
  const args = event.args ?? event.arguments ?? {};
  const isTrade = tool === "alpaca.place_order";
  const isQuote = tool === "marketdata.quote";

  return {
    id: event.id ?? randomUUID(),
    actor_id: event.actor_id ?? event.agent_id ?? "openclaw-agent",
    session_id: event.session_id ?? event.conversation_id ?? "openclaw-session",
    created_at: event.created_at ?? new Date().toISOString(),
    nonce: event.nonce ?? randomUUID(),
    intent: isTrade
      ? {
          type: "trade",
          tool,
          action: args.side ?? args.action ?? "buy",
          ticker: args.symbol ?? args.ticker ?? "",
          asset_class: args.asset_class ?? "us_equity",
          quantity: Number(args.qty ?? args.quantity ?? 0),
          limit_price: Number(args.limit_price ?? args.price ?? 0)
        }
      : isQuote
        ? {
            type: "read_market_data",
            tool,
            ticker: args.symbol ?? args.ticker ?? ""
          }
        : {
            type: "unknown",
            tool
          },
    context: {
      channel: "openclaw",
      raw_inputs: [event.prompt ?? event.message ?? ""]
    },
    evidence: {
      sources: event.sources ?? event.context?.sources ?? []
    },
    state: {
      market_hours_open: event.state?.market_hours_open ?? true,
      current_daily_notional_usd: event.state?.current_daily_notional_usd ?? 0,
      current_portfolio_exposure_usd:
        event.state?.current_portfolio_exposure_usd ?? 0,
      prior_trade_count_1m: event.state?.prior_trade_count_1m ?? 0,
      focused_tickers: event.state?.focused_tickers ?? []
    }
  };
}

async function getPipeline() {
  if (!cachedPipeline) {
    cachedPipeline = await createPipeline();
  }
  return cachedPipeline;
}

export async function beforeToolCall(event) {
  const pipeline = await getPipeline();
  const envelope = mapToolEventToEnvelope(event);
  const decision = await pipeline.evaluateIntent(envelope);

  if (!decision.allowed) {
    await pipeline.auditDecision(decision, envelope);
    return {
      block: true,
      reason: decision.reasons.join(" "),
      blocked_by: decision.blocked_by
    };
  }

  return {
    block: false,
    security_context: {
      signed_intent: decision.signed_intent
    }
  };
}

export async function before_tool_call(event) {
  return beforeToolCall(event);
}

export async function executeApprovedIntent(payload) {
  const pipeline = await getPipeline();
  const signedIntent =
    payload.signed_intent ?? payload.security_context?.signed_intent;

  if (!signedIntent) {
    return {
      allowed: false,
      blocked_by: "execution_proxy",
      reasons: ["No signed intent provided to execution proxy."]
    };
  }

  const execution = await pipeline.executionProxy.execute(signedIntent);
  await pipeline.auditDecision(execution, signedIntent.payload?.envelope ?? null);
  return execution;
}

export function createOpenClawPlugin() {
  return {
    name: "armorclaw-financial-guard",
    beforeToolCall,
    before_tool_call,
    executeApprovedIntent
  };
}
