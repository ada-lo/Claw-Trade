function buildVerifierRequest(envelope, policy) {
  const intent = envelope.intent ?? {};
  const state = envelope.state ?? {};
  const riskLimits = policy.risk_limits ?? {};
  const market = policy.market ?? {};

  return {
    action: intent.action,
    ticker: intent.ticker,
    quantity: intent.quantity,
    limit_price: Number(intent.limit_price),
    daily_spent: Number(state.current_daily_notional_usd ?? 0),
    daily_limit: Number(riskLimits.max_daily_notional_usd ?? 0),
    allowed_tickers: market.allowed_tickers ?? []
  };
}

export class FormalVerifier {
  constructor({
    mode = "strict",
    url,
    fetchImpl = globalThis.fetch
  } = {}) {
    this.mode = mode;
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  async verify(envelope, policy) {
    const request = buildVerifierRequest(envelope, policy);

    if (!this.url) {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: ["Z3_VERIFIER_URL is not configured."]
      };
    }

    if (typeof this.fetchImpl !== "function") {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: ["HTTP fetch is unavailable for the formal verifier."]
      };
    }

    let response;
    try {
      response = await this.fetchImpl(`${this.url.replace(/\/+$/u, "")}/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(5000)
      });
    } catch (error) {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: [`Formal verifier HTTP request failed: ${error.message}`]
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: [`Formal verifier returned invalid JSON: ${error.message}`]
      };
    }

    if (!response.ok) {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: [
          `Formal verifier returned HTTP ${response.status}: ${payload.reason ?? "unknown error"}`
        ]
      };
    }

    if (typeof payload.allowed !== "boolean") {
      return {
        allowed: false,
        code: "formal_verifier_unavailable",
        reasons: ["Formal verifier response is missing the allowed boolean."]
      };
    }

    const reason = payload.reason ?? (
      payload.allowed
        ? "SAT: intent satisfies all policy constraints"
        : "UNSAT: formal verifier rejected the proposed action"
    );

    if (!payload.allowed) {
      return {
        allowed: false,
        code: "unsat",
        reason,
        reasons: [reason],
        unsat_core: [reason],
        request
      };
    }

    const orderNotional = Number(request.quantity) * Number(request.limit_price);
    return {
      allowed: true,
      reason,
      summary: {
        order_notional_usd: orderNotional,
        daily_spent_usd: request.daily_spent,
        daily_limit_usd: request.daily_limit,
        daily_notional_after_usd: request.daily_spent + orderNotional
      },
      request
    };
  }
}
