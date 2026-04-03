import { asArray } from "../common/object-path.js";

function toRegex(pattern, global = false) {
  let source = pattern;
  let flags = "i";

  if (source.startsWith("(?i)")) {
    source = source.slice(4);
  }

  if (global) {
    flags += "g";
  }

  return new RegExp(source, flags);
}

function sanitizeText(text, patterns) {
  return patterns.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    text
  );
}

export class DataTrustLayer {
  constructor(policy) {
    this.policy = policy;
    this.allowlistedProviders = new Set(
      asArray(policy.data_trust?.allowlisted_providers).map((value) =>
        String(value).toLowerCase()
      )
    );
    this.promptPatterns = asArray(
      policy.data_trust?.prompt_injection_patterns
    ).map((value) => toRegex(String(value)));
    this.redactionPatterns = asArray(
      policy.data_trust?.secret_redaction_patterns
    ).map((value) => toRegex(String(value), true));
  }

  evaluate(envelope) {
    const sources = asArray(envelope.evidence?.sources);
    const rawInputs = asArray(envelope.context?.raw_inputs).map((value) =>
      String(value)
    );
    const suspiciousMatches = [];

    for (const input of rawInputs) {
      for (const pattern of this.promptPatterns) {
        if (pattern.test(input)) {
          suspiciousMatches.push(pattern.source);
        }
      }
    }

    const trustedSources = sources.filter((source) =>
      this.allowlistedProviders.has(String(source.provider ?? "").toLowerCase())
    );
    const requiredConfirmations =
      this.policy.data_trust?.min_source_confirmations ?? 2;
    const reasons = [];

    if (suspiciousMatches.length > 0) {
      reasons.push(
        `Suspicious prompt-injection markers found: ${[
          ...new Set(suspiciousMatches)
        ].join(", ")}`
      );
    }

    if (
      envelope.intent?.type === "trade" &&
      trustedSources.length < requiredConfirmations
    ) {
      reasons.push(
        `Trade intent requires ${requiredConfirmations} trusted evidence sources, got ${trustedSources.length}.`
      );
    }

    const sanitizedEnvelope = structuredClone(envelope);
    sanitizedEnvelope.context = {
      ...(sanitizedEnvelope.context ?? {}),
      raw_inputs: rawInputs.map((value) => sanitizeText(value, this.redactionPatterns))
    };

    return {
      allowed: reasons.length === 0,
      reasons,
      trusted_sources_count: trustedSources.length,
      sanitized_envelope: sanitizedEnvelope
    };
  }
}
