import { randomUUID } from "node:crypto";

import { createPipeline } from "../create-pipeline.js";

let cachedPipeline = null;

const TRADE_TOOL_NAME = "alpaca.place_order";
const QUOTE_TOOL_NAME = "marketdata.quote";

const TRADE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: "Ticker symbol to trade, for example AAPL."
    },
    side: {
      type: "string",
      enum: ["buy", "sell"],
      description: "Order side."
    },
    quantity: {
      type: "integer",
      minimum: 1,
      description: "Whole-share quantity."
    },
    limit_price: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Limit price in USD."
    },
    nonce: {
      type: "string",
      description: "Optional caller-supplied nonce for replay protection."
    },
    rationale: {
      type: "string",
      description: "Short explanation of why the trade is being proposed."
    },
    evidence_sources: {
      type: "array",
      description:
        "Optional supporting evidence sources. If omitted, the plugin adds an Alpaca quote source and an operator confirmation source.",
      items: {
        type: "object",
        properties: {
          provider: {
            type: "string"
          },
          uri: {
            type: "string"
          }
        },
        required: ["provider", "uri"]
      }
    },
    market_hours_open: {
      type: "boolean",
      description: "Override the market-hours state for deterministic checks."
    },
    current_daily_notional_usd: {
      type: "number",
      description: "Current daily notional already spent before this order."
    },
    current_portfolio_exposure_usd: {
      type: "number",
      description: "Current portfolio exposure before this order."
    },
    prior_trade_count_1m: {
      type: "integer",
      minimum: 0,
      description: "Observed trade count over the previous minute."
    },
    focused_tickers: {
      type: "array",
      description: "Tickers already in focus for the active strategy context.",
      items: {
        type: "string"
      }
    }
  },
  required: ["symbol", "side", "quantity", "limit_price"]
};

function normalizeNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeInteger(value, fallback = 0) {
  const parsed = normalizeNumber(value, fallback);
  return Number.isInteger(parsed) ? parsed : Math.trunc(parsed);
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeEvidenceSources(rawSources, { ticker, actorId }) {
  const provided = Array.isArray(rawSources)
    ? rawSources
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          provider: String(entry.provider ?? "").trim(),
          uri: String(entry.uri ?? "").trim()
        }))
        .filter((entry) => entry.provider && entry.uri)
    : [];

  const defaults = [];
  if (ticker) {
    defaults.push({
      provider: "alpaca",
      uri: `alpaca://quotes/${ticker}`
    });
  }
  defaults.push({
    provider: "manual_override",
    uri: `manual_override://operator/${actorId}`
  });

  const deduped = new Map();
  for (const entry of [...provided, ...defaults]) {
    const key = `${entry.provider}:${entry.uri}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}

function buildPromptSummary({ side, quantity, ticker, limitPrice, rationale }) {
  const base = `${side} ${quantity} share(s) of ${ticker} at $${limitPrice}`;
  if (typeof rationale === "string" && rationale.trim() !== "") {
    return `${base}. Rationale: ${rationale.trim()}`;
  }

  return base;
}

function mapToolEventToEnvelope(event, toolContext = {}) {
  const tool =
    event.toolName ?? event.tool_name ?? event.tool ?? event.name ?? "unknown";
  const args = event.params ?? event.args ?? event.arguments ?? {};
  const action = String(args.side ?? args.action ?? "buy").trim().toLowerCase();
  const ticker = String(args.symbol ?? args.ticker ?? "")
    .trim()
    .toUpperCase();
  const quantity = normalizeInteger(args.qty ?? args.quantity, 0);
  const limitPrice = normalizeNumber(args.limit_price ?? args.price, 0);
  const actorId =
    toolContext.agentId ??
    event.actor_id ??
    event.agent_id ??
    "openclaw-agent";
  const focusedTickers = asStringArray(
    args.focused_tickers ?? event.state?.focused_tickers
  );
  if (ticker && !focusedTickers.includes(ticker)) {
    focusedTickers.push(ticker);
  }

  const isTrade = tool === TRADE_TOOL_NAME;
  const isQuote = tool === QUOTE_TOOL_NAME;

  return {
    id: String(event.id ?? args.intent_id ?? randomUUID()),
    actor_id: actorId,
    session_id:
      toolContext.sessionId ??
      toolContext.sessionKey ??
      event.session_id ??
      event.conversation_id ??
      "openclaw-session",
    created_at: event.created_at ?? new Date().toISOString(),
    nonce: String(args.nonce ?? event.nonce ?? randomUUID()),
    intent: isTrade
      ? {
          type: "trade",
          tool,
          action,
          ticker,
          asset_class: String(args.asset_class ?? "us_equity"),
          quantity,
          limit_price: limitPrice
        }
      : isQuote
        ? {
            type: "read_market_data",
            tool,
            ticker
          }
        : {
            type: "unknown",
            tool
          },
    context: {
      channel: event.channel ?? "openclaw",
      raw_inputs: [
        buildPromptSummary({
          side: action,
          quantity,
          ticker,
          limitPrice,
          rationale: args.rationale ?? event.prompt ?? event.message
        })
      ]
    },
    evidence: {
      sources: normalizeEvidenceSources(args.evidence_sources ?? args.sources, {
        ticker,
        actorId
      })
    },
    state: {
      market_hours_open:
        typeof args.market_hours_open === "boolean"
          ? args.market_hours_open
          : event.state?.market_hours_open ?? true,
      current_daily_notional_usd: normalizeNumber(
        args.current_daily_notional_usd ??
          args.daily_spent ??
          event.state?.current_daily_notional_usd,
        0
      ),
      current_portfolio_exposure_usd: normalizeNumber(
        args.current_portfolio_exposure_usd ??
          event.state?.current_portfolio_exposure_usd,
        0
      ),
      prior_trade_count_1m: normalizeInteger(
        args.prior_trade_count_1m ?? event.state?.prior_trade_count_1m,
        0
      ),
      focused_tickers: focusedTickers
    }
  };
}

function toToolResult(summary, details = summary) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(summary, null, 2)
      }
    ],
    details
  };
}

async function defaultGetPipeline() {
  if (!cachedPipeline) {
    cachedPipeline = await createPipeline();
  }
  return cachedPipeline;
}

export async function beforeToolCall(event, toolContext = {}) {
  if ((event.toolName ?? event.tool_name ?? event.tool ?? event.name) !== TRADE_TOOL_NAME) {
    return {};
  }

  const pipeline = await defaultGetPipeline();
  const envelope = mapToolEventToEnvelope(event, toolContext);
  const decision = await pipeline.evaluateIntent(envelope);

  if (!decision.allowed) {
    await pipeline.auditDecision(decision, envelope);
    return {
      block: true,
      blockReason: decision.reasons.join(" ")
    };
  }

  return {};
}

export async function before_tool_call(event, toolContext = {}) {
  return beforeToolCall(event, toolContext);
}

export function createOpenClawTradeTool({
  toolContext = {},
  getPipeline = defaultGetPipeline
} = {}) {
  return {
    name: TRADE_TOOL_NAME,
    label: "ArmorClaw Paper Trade",
    description:
      "Submit a paper-trading order through the full 9-layer ArmorClaw security pipeline before it reaches the execution proxy.",
    parameters: TRADE_TOOL_SCHEMA,
    ownerOnly: true,
    async execute(_toolCallId, params) {
      const pipeline = await getPipeline();
      const envelope = mapToolEventToEnvelope(
        {
          toolName: TRADE_TOOL_NAME,
          params
        },
        toolContext
      );
      const decision = await pipeline.processIntent(envelope);

      return toToolResult(
        {
          allowed: decision.allowed,
          blocked_by: decision.blocked_by ?? null,
          reasons: decision.reasons ?? [],
          execution: decision.execution ?? null,
          audit_hash: decision.audit_record?.entry_hash ?? null,
          layer_trace: decision.layer_trace ?? []
        },
        decision
      );
    }
  };
}

export async function executeApprovedIntent(payload, { getPipeline = defaultGetPipeline } = {}) {
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
    createOpenClawTradeTool,
    executeApprovedIntent
  };
}

export { TRADE_TOOL_NAME };
