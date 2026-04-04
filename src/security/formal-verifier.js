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
      if (this.mode === "lenient") {
        return this._localFallback(request, `Z3 unreachable: ${error.message}`);
      }
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

  _localFallback(request, context) {
    const orderNotional = Number(request.quantity) * Number(request.limit_price);
    const totalDaily = Number(request.daily_spent) + orderNotional;
    const dailyLimit = Number(request.daily_limit);
    const violations = [];

    if (dailyLimit > 0 && totalDaily > dailyLimit) {
      violations.push(
        `Daily notional $${totalDaily} exceeds limit $${dailyLimit}`
      );
    }

    if (
      Array.isArray(request.allowed_tickers) &&
      request.allowed_tickers.length > 0 &&
      !request.allowed_tickers.includes(request.ticker)
    ) {
      violations.push(
        `Ticker ${request.ticker} not in allowlist [${request.allowed_tickers.join(", ")}]`
      );
    }

    if (violations.length > 0) {
      return {
        allowed: false,
        code: "local_unsat",
        reason: violations.join("; "),
        reasons: violations,
        unsat_core: violations,
        request
      };
    }

    return {
      allowed: true,
      reason: `Local fallback SAT (${context})`,
      summary: {
        order_notional_usd: orderNotional,
        daily_spent_usd: request.daily_spent,
        daily_limit_usd: dailyLimit,
        daily_notional_after_usd: totalDaily
      },
      request
    };
  }
}
