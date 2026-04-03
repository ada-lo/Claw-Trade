import { asArray } from "../common/object-path.js";

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function normalizeIntentEnvelope(envelope) {
  const normalized = structuredClone(envelope);

  normalized.context = normalized.context ?? {};
  normalized.context.raw_inputs = asArray(normalized.context.raw_inputs);
  normalized.evidence = normalized.evidence ?? {};
  normalized.evidence.sources = asArray(normalized.evidence.sources);
  normalized.state = normalized.state ?? {};

  if (
    normalized.intent?.type === "trade" &&
    typeof normalized.intent.notional_usd !== "number" &&
    isPositiveNumber(normalized.intent.quantity) &&
    isPositiveNumber(normalized.intent.limit_price)
  ) {
    normalized.intent.notional_usd =
      normalized.intent.quantity * normalized.intent.limit_price;
  }

  return normalized;
}

export function validateIntentEnvelope(envelope) {
  const normalized = normalizeIntentEnvelope(envelope);
  const errors = [];

  if (!normalized || typeof normalized !== "object") {
    return { valid: false, errors: ["Envelope must be an object."], envelope: normalized };
  }

  const requiredStringFields = [
    ["id", normalized.id],
    ["actor_id", normalized.actor_id],
    ["session_id", normalized.session_id],
    ["nonce", normalized.nonce]
  ];

  for (const [field, value] of requiredStringFields) {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${field} must be a non-empty string.`);
    }
  }

  if (!isIsoTimestamp(normalized.created_at)) {
    errors.push("created_at must be a valid ISO timestamp.");
  }

  if (!normalized.intent || typeof normalized.intent !== "object") {
    errors.push("intent must be an object.");
  } else {
    if (typeof normalized.intent.type !== "string" || normalized.intent.type.trim() === "") {
      errors.push("intent.type must be a non-empty string.");
    }

    if (typeof normalized.intent.tool !== "string" || normalized.intent.tool.trim() === "") {
      errors.push("intent.tool must be a non-empty string.");
    }

    if (normalized.intent.type === "trade") {
      if (!["buy", "sell"].includes(normalized.intent.action)) {
        errors.push("Trade intents require intent.action to be buy or sell.");
      }

      if (typeof normalized.intent.ticker !== "string" || normalized.intent.ticker.trim() === "") {
        errors.push("Trade intents require intent.ticker.");
      }

      if (
        typeof normalized.intent.asset_class !== "string" ||
        normalized.intent.asset_class.trim() === ""
      ) {
        errors.push("Trade intents require intent.asset_class.");
      }

      if (!Number.isInteger(normalized.intent.quantity) || normalized.intent.quantity <= 0) {
        errors.push("Trade intents require intent.quantity as a positive integer.");
      }

      if (!isPositiveNumber(normalized.intent.limit_price)) {
        errors.push("Trade intents require intent.limit_price as a positive number.");
      }
    }

    if (normalized.intent.type === "write_report") {
      if (asArray(normalized.intent.file_paths).length === 0) {
        errors.push("write_report intents require at least one file path.");
      }
    }
  }

  return { valid: errors.length === 0, errors, envelope: normalized };
}
